import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock @aws-sdk/s3-request-presigner before service import
vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://r2.example.com/signed-upload-url'),
}));

// Mock @aws-sdk/client-s3
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(() => ({})),
  PutObjectCommand: vi.fn().mockImplementation((input: Record<string, unknown>) => ({ input })),
}));

// Mock node:fs/promises
vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  // JPEG magic bytes (0xFF 0xD8) for content-type detection
  readFile: vi.fn().mockResolvedValue(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])),
}));

import { UploadService } from './upload.service.js';

function createMockConfigService(overrides: Record<string, string> = {}) {
  const config: Record<string, string> = {
    R2_ACCOUNT_ID: 'test-account-id',
    R2_BUCKET_NAME: 'grabit-uploads',
    R2_PUBLIC_URL: 'https://cdn.heygrabit.com',
    R2_ACCESS_KEY_ID: 'test-access-key',
    R2_SECRET_ACCESS_KEY: 'test-secret-key',
    R2_UPLOAD_CACHE_CONTROL_ENABLED: 'true',
    API_URL: 'http://localhost:8080',
    ...overrides,
  };

  return {
    get: vi.fn((key: string, defaultValue?: string) => config[key] ?? defaultValue),
    getOrThrow: vi.fn((key: string) => {
      const val = config[key];
      if (val === undefined) throw new Error(`Missing config: ${key}`);
      return val;
    }),
  };
}

describe('UploadService', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('R2 mode (credentials configured)', () => {
    let service: UploadService;
    let mockConfigService: ReturnType<typeof createMockConfigService>;

    beforeEach(() => {
      mockConfigService = createMockConfigService();
      service = new UploadService(
        mockConfigService as unknown as ConstructorParameters<typeof UploadService>[0],
      );
    });

    it('should not be in local mode when R2_ACCOUNT_ID is set', () => {
      expect(service.isLocalMode).toBe(false);
    });

    it('should return uploadUrl, publicUrl, key, and mode for R2', async () => {
      const result = await service.generatePresignedUrl('posters', 'image/jpeg', 'jpg');

      expect(result).toHaveProperty('uploadUrl');
      expect(result).toHaveProperty('publicUrl');
      expect(result).toHaveProperty('key');
      expect(result.cacheControl).toBe('public, max-age=31536000, immutable');
      expect(result.mode).toBe('r2');

      expect(result.key).toMatch(/^posters\//);
      expect(result.key).toMatch(/\.jpg$/);

      expect(typeof result.uploadUrl).toBe('string');
      expect(result.uploadUrl.length).toBeGreaterThan(0);
    });

    it('should generate unique keys using UUID', async () => {
      const result1 = await service.generatePresignedUrl('posters', 'image/jpeg', 'jpg');
      const result2 = await service.generatePresignedUrl('posters', 'image/jpeg', 'jpg');

      expect(result1.key).not.toBe(result2.key);
    });

    it('should set correct ContentType on PutObjectCommand', async () => {
      const { PutObjectCommand } = await import('@aws-sdk/client-s3');

      await service.generatePresignedUrl('seat-maps', 'image/svg+xml', 'svg');

      expect(PutObjectCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          ContentType: 'image/svg+xml',
          CacheControl: 'public, max-age=31536000, immutable',
        }),
      );
    });

    it('should omit CacheControl when R2 upload cache control is disabled', async () => {
      const { PutObjectCommand } = await import('@aws-sdk/client-s3');
      vi.mocked(PutObjectCommand).mockClear();

      const disabledService = new UploadService(
        createMockConfigService({
          R2_UPLOAD_CACHE_CONTROL_ENABLED: 'false',
        }) as unknown as ConstructorParameters<typeof UploadService>[0],
      );

      const result = await disabledService.generatePresignedUrl(
        'posters',
        'image/jpeg',
        'jpg',
      );

      expect(result.cacheControl).toBeNull();
      expect(PutObjectCommand).toHaveBeenCalledWith(
        expect.not.objectContaining({
          CacheControl: expect.any(String),
        }),
      );
    });

    it('should construct publicUrl from R2_PUBLIC_URL config + key', async () => {
      const result = await service.generatePresignedUrl('banners', 'image/png', 'png');

      expect(result.publicUrl).toBe(`https://cdn.heygrabit.com/${result.key}`);
    });

    it('should reject unsupported upload folders', async () => {
      await expect(
        service.generatePresignedUrl('avatars', 'image/png', 'png'),
      ).rejects.toThrow('Unsupported upload folder');
    });

    it('should reject MIME types outside the folder allowlist', async () => {
      await expect(
        service.generatePresignedUrl('seat-maps', 'image/png', 'png'),
      ).rejects.toThrow('Unsupported upload content type');
    });

    it('should reject extensions outside the folder allowlist', async () => {
      await expect(
        service.generatePresignedUrl('posters', 'image/jpeg', 'svg'),
      ).rejects.toThrow('Unsupported upload extension');
    });

    it('should create S3Client with forcePathStyle: true for R2 compatibility', async () => {
      const { S3Client } = await import('@aws-sdk/client-s3');

      expect(S3Client).toHaveBeenCalledWith(
        expect.objectContaining({
          forcePathStyle: true,
          region: 'auto',
          endpoint: 'https://test-account-id.r2.cloudflarestorage.com',
        }),
      );
    });

    it('should disable auto-checksum so R2 CORS preflight passes (SDK v3 ≥ 3.729)', async () => {
      const { S3Client } = await import('@aws-sdk/client-s3');

      expect(S3Client).toHaveBeenCalledWith(
        expect.objectContaining({
          requestChecksumCalculation: 'WHEN_REQUIRED',
          responseChecksumValidation: 'WHEN_REQUIRED',
        }),
      );
    });
  });

  describe('Local mode (R2 credentials not configured)', () => {
    let service: UploadService;
    let mockConfigService: ReturnType<typeof createMockConfigService>;

    beforeEach(() => {
      mockConfigService = createMockConfigService({
        R2_ACCOUNT_ID: '',
      });
      service = new UploadService(
        mockConfigService as unknown as ConstructorParameters<typeof UploadService>[0],
      );
    });

    it('should be in local mode when R2_ACCOUNT_ID is empty', () => {
      expect(service.isLocalMode).toBe(true);
    });

    it('should return mode local with local upload URLs', async () => {
      const result = await service.generatePresignedUrl('posters', 'image/jpeg', 'jpg');

      expect(result.mode).toBe('local');
      expect(result.cacheControl).toBe('public, max-age=31536000, immutable');
      expect(result.uploadUrl).toMatch(
        /^http:\/\/localhost:8080\/api\/v1\/admin\/upload\/local\/posters\//,
      );
      expect(result.publicUrl).toBe(result.uploadUrl);
      expect(result.key).toMatch(/^posters\//);
      expect(result.key).toMatch(/\.jpg$/);
    });

    it('should not call S3Client or getSignedUrl in local mode', async () => {
      const { S3Client } = await import('@aws-sdk/client-s3');
      const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');

      vi.mocked(S3Client).mockClear();
      vi.mocked(getSignedUrl).mockClear();

      await service.generatePresignedUrl('posters', 'image/jpeg', 'jpg');

      // S3Client should not have been called again after construction
      expect(S3Client).not.toHaveBeenCalled();
      expect(getSignedUrl).not.toHaveBeenCalled();
    });

    it('should save file to local filesystem', async () => {
      const { writeFile, mkdir } = await import('node:fs/promises');

      const buffer = Buffer.from('test-image-data');
      const url = await service.saveLocalFile('posters/test.jpg', buffer);

      expect(mkdir).toHaveBeenCalled();
      expect(writeFile).toHaveBeenCalled();
      expect(url).toContain('/api/v1/admin/upload/local/posters/test.jpg');
    });

    it('should read file from local filesystem', async () => {
      const result = await service.getLocalFile('posters/test.jpg');

      expect(result).not.toBeNull();
      expect(result!.contentType).toBe('image/jpeg');
      expect(Buffer.isBuffer(result!.buffer)).toBe(true);
    });

    it('should detect content type from magic bytes', async () => {
      const { readFile } = await import('node:fs/promises');

      // PNG magic bytes
      vi.mocked(readFile).mockResolvedValueOnce(Buffer.from([0x89, 0x50, 0x4e, 0x47]) as never);
      const pngResult = await service.getLocalFile('posters/test.png');
      expect(pngResult!.contentType).toBe('image/png');

      // GIF magic bytes (even with .png extension)
      vi.mocked(readFile).mockResolvedValueOnce(Buffer.from([0x47, 0x49, 0x46, 0x38]) as never);
      const gifResult = await service.getLocalFile('posters/mislabeled.png');
      expect(gifResult!.contentType).toBe('image/gif');
    });

    it('should return null when file does not exist', async () => {
      const { readFile } = await import('node:fs/promises');
      vi.mocked(readFile).mockRejectedValueOnce(new Error('ENOENT'));

      const result = await service.getLocalFile('posters/nonexistent.jpg');
      expect(result).toBeNull();
    });
  });

  describe('Local mode with undefined R2_ACCOUNT_ID', () => {
    it('should be in local mode when R2_ACCOUNT_ID is undefined', () => {
      const mockConfig = {
        get: vi.fn((key: string, defaultValue?: string) => {
          const config: Record<string, string> = {
            R2_BUCKET_NAME: '',
            R2_PUBLIC_URL: '',
            R2_ACCESS_KEY_ID: '',
            R2_SECRET_ACCESS_KEY: '',
            API_URL: 'http://localhost:8080',
          };
          return config[key] ?? defaultValue;
        }),
        getOrThrow: vi.fn(),
      };

      const service = new UploadService(
        mockConfig as unknown as ConstructorParameters<typeof UploadService>[0],
      );
      expect(service.isLocalMode).toBe(true);
    });
  });
});

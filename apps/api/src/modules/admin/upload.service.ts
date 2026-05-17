import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  type PutObjectCommandInput,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const IMMUTABLE_ASSET_CACHE_CONTROL = 'public, max-age=31536000, immutable';

const R2_UPLOAD_POLICIES = {
  posters: {
    contentTypes: ['image/jpeg', 'image/png', 'image/webp'] as const,
    extensions: ['jpg', 'jpeg', 'png', 'webp'] as const,
  },
  'performance-detail': {
    contentTypes: ['image/jpeg', 'image/png', 'image/webp'] as const,
    extensions: ['jpg', 'jpeg', 'png', 'webp'] as const,
  },
  banners: {
    contentTypes: ['image/jpeg', 'image/png', 'image/webp'] as const,
    extensions: ['jpg', 'jpeg', 'png', 'webp'] as const,
  },
  castings: {
    contentTypes: ['image/jpeg', 'image/png', 'image/webp'] as const,
    extensions: ['jpg', 'jpeg', 'png', 'webp'] as const,
  },
  'seat-maps': {
    contentTypes: ['image/svg+xml'] as const,
    extensions: ['svg'] as const,
  },
} as const;

type R2UploadFolder = keyof typeof R2_UPLOAD_POLICIES;

@Injectable()
export class UploadService {
  private readonly s3: S3Client | null;
  private readonly bucketName: string;
  private readonly r2PublicUrl: string;
  private readonly r2UploadCacheControlEnabled: boolean;
  readonly isLocalMode: boolean;
  private readonly logger = new Logger(UploadService.name);

  constructor(private readonly config: ConfigService) {
    const accountId = config.get<string>('R2_ACCOUNT_ID', '');
    this.bucketName = config.get<string>('R2_BUCKET_NAME', '') as string;
    this.r2PublicUrl = config.get<string>('R2_PUBLIC_URL', '') as string;
    this.r2UploadCacheControlEnabled = this.parseBooleanConfig(
      'R2_UPLOAD_CACHE_CONTROL_ENABLED',
      false,
    );

    this.isLocalMode = !accountId;

    if (this.isLocalMode) {
      this.s3 = null;
      this.logger.warn(
        'R2_ACCOUNT_ID not configured — running in local file storage mode',
      );
    } else {
      this.s3 = new S3Client({
        region: 'auto',
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        forcePathStyle: true,
        // SDK v3 ≥ 3.729 부터 PutObject 에 x-amz-checksum-crc32 /
        // x-amz-sdk-checksum-algorithm 헤더가 자동 부착됨 → presigned PUT 이
        // simple request 에서 preflight 필요 요청으로 바뀌어 R2 CORS 가 막음.
        // 'WHEN_REQUIRED' 로 명시 지정이 있을 때만 체크섬을 계산.
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
        credentials: {
          accessKeyId: config.get<string>('R2_ACCESS_KEY_ID', '') as string,
          secretAccessKey: config.get<string>(
            'R2_SECRET_ACCESS_KEY',
            '',
          ) as string,
        },
      });
    }
  }

  async generatePresignedUrl(
    folder: string,
    contentType: string,
    extension: string,
  ): Promise<{
    uploadUrl: string;
    publicUrl: string;
    key: string;
    mode: 'local' | 'r2';
    cacheControl: string | null;
  }> {
    const policy = this.resolveUploadPolicy(folder, contentType, extension);
    const key = `${policy.folder}/${randomUUID()}.${policy.extension}`;

    if (this.isLocalMode) {
      const apiBase = this.config.get<string>(
        'API_URL',
        'http://localhost:8080',
      );
      return {
        uploadUrl: `${apiBase}/api/v1/admin/upload/local/${key}`,
        publicUrl: `${apiBase}/api/v1/admin/upload/local/${key}`,
        key,
        mode: 'local' as const,
        cacheControl: IMMUTABLE_ASSET_CACHE_CONTROL,
      };
    }

    const cacheControl = this.r2UploadCacheControlEnabled
      ? IMMUTABLE_ASSET_CACHE_CONTROL
      : null;
    const commandInput: PutObjectCommandInput = {
      Bucket: this.bucketName,
      Key: key,
      ContentType: policy.contentType,
    };

    if (cacheControl) {
      commandInput.CacheControl = cacheControl;
    }

    const command = new PutObjectCommand(commandInput);
    const uploadUrl = await getSignedUrl(this.s3!, command, { expiresIn: 600 });
    return {
      uploadUrl,
      publicUrl: `${this.normalizePublicUrlBase()}/${key}`,
      key,
      mode: 'r2' as const,
      cacheControl,
    };
  }

  async saveLocalFile(key: string, buffer: Buffer): Promise<string> {
    const filePath = this.validateLocalPath(key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, buffer);
    const apiBase = this.config.get<string>(
      'API_URL',
      'http://localhost:8080',
    );
    return `${apiBase}/api/v1/admin/upload/local/${key}`;
  }

  async getLocalFile(
    key: string,
  ): Promise<{ buffer: Buffer; contentType: string } | null> {
    const filePath = this.validateLocalPath(key);
    try {
      const buffer = await fs.readFile(filePath);
      return { buffer, contentType: this.detectContentType(buffer, key) };
    } catch {
      return null;
    }
  }

  private validateLocalPath(key: string): string {
    const uploadDir = path.resolve(path.join(process.cwd(), 'uploads'));
    const filePath = path.resolve(path.join(uploadDir, key));
    if (!filePath.startsWith(uploadDir + path.sep) && filePath !== uploadDir) {
      throw new BadRequestException('Invalid file path');
    }
    return filePath;
  }

  private detectContentType(buffer: Buffer, key: string): string {
    // Detect by magic bytes (file content may not match extension)
    if (buffer.length >= 2) {
      if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'image/jpeg';
      if (buffer[0] === 0x89 && buffer[1] === 0x50) return 'image/png';
      if (buffer[0] === 0x47 && buffer[1] === 0x49) return 'image/gif';
      if (buffer.length >= 12 && buffer[0] === 0x52 && buffer[1] === 0x49 &&
          buffer[8] === 0x57 && buffer[9] === 0x45) return 'image/webp';
    }
    // SVG is text-based, fall back to extension
    if (key.endsWith('.svg')) return 'image/svg+xml';
    return 'application/octet-stream';
  }

  private resolveUploadPolicy(
    folder: string,
    contentType: string,
    extension: string,
  ): { folder: R2UploadFolder; contentType: string; extension: string } {
    const normalizedFolder = folder.trim();
    const policy = R2_UPLOAD_POLICIES[normalizedFolder as R2UploadFolder];

    if (!policy) {
      throw new BadRequestException('Unsupported upload folder');
    }

    const normalizedContentType = contentType.trim().toLowerCase();
    const normalizedExtension = extension.trim().toLowerCase().replace(/^\./, '');

    if (!(policy.contentTypes as readonly string[]).includes(normalizedContentType)) {
      throw new BadRequestException('Unsupported upload content type');
    }

    if (!(policy.extensions as readonly string[]).includes(normalizedExtension)) {
      throw new BadRequestException('Unsupported upload extension');
    }

    return {
      folder: normalizedFolder as R2UploadFolder,
      contentType: normalizedContentType,
      extension: normalizedExtension,
    };
  }

  private normalizePublicUrlBase(): string {
    const base = this.r2PublicUrl.trim().replace(/\/+$/, '');
    if (!base) {
      throw new BadRequestException('R2 public URL is not configured');
    }
    return base;
  }

  private parseBooleanConfig(key: string, defaultValue: boolean): boolean {
    const rawValue = this.config.get<string>(key, String(defaultValue));
    return ['1', 'true', 'yes', 'on'].includes(
      (rawValue ?? String(defaultValue)).trim().toLowerCase(),
    );
  }
}

import { afterEach, describe, expect, it, vi } from 'vitest';

import { uploadPresignedAsset } from '../admin-upload';

describe('uploadPresignedAsset', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends Cache-Control for R2 uploads', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    await uploadPresignedAsset({
      uploadUrl: 'https://r2.example.com/upload',
      file: new File(['image'], 'poster.jpg', { type: 'image/jpeg' }),
      contentType: 'image/jpeg',
      mode: 'r2',
      cacheControl: 'public, max-age=31536000, immutable',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://r2.example.com/upload',
      expect.objectContaining({
        method: 'PUT',
        headers: {
          'Content-Type': 'image/jpeg',
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      }),
    );
  });

  it('throws when upload PUT returns a non-2xx status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }));

    await expect(
      uploadPresignedAsset({
        uploadUrl: 'https://r2.example.com/upload',
        file: new File(['image'], 'poster.jpg', { type: 'image/jpeg' }),
        contentType: 'image/jpeg',
        mode: 'r2',
      }),
    ).rejects.toThrow('Upload failed with HTTP 403');
  });
});


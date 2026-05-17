type UploadMode = 'local' | 'r2';

type UploadPresignedAssetInput = {
  uploadUrl: string;
  file: File;
  contentType: string;
  mode: UploadMode;
  cacheControl?: string | null;
};

export async function uploadPresignedAsset({
  uploadUrl,
  file,
  contentType,
  mode,
  cacheControl,
}: UploadPresignedAssetInput): Promise<void> {
  const headers: Record<string, string> = {
    'Content-Type': contentType,
  };

  if (mode === 'r2' && cacheControl) {
    headers['Cache-Control'] = cacheControl;
  }

  const response = await fetch(uploadUrl, {
    method: 'PUT',
    body: file,
    headers,
    ...(mode === 'local' ? { credentials: 'include' as const } : {}),
  });

  if (!response.ok) {
    throw new Error(`Upload failed with HTTP ${response.status}`);
  }
}


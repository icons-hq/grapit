const LOCAL_RETURN_ORIGIN = 'https://heygrabit.local';

export function resolveAuthReturnTo(value: string | null | undefined): string | null {
  const normalized = normalizeAuthReturnTo(value);
  // Dot-segment removal can turn a same-site looking input (`/.//evil.test`) into a
  // protocol-relative URL. Validate the normalized output again and require it to be
  // a fixed point so every caller navigates to exactly the checked same-site path.
  if (normalized === null || normalizeAuthReturnTo(normalized) !== normalized) {
    return null;
  }
  return normalized;
}

function normalizeAuthReturnTo(value: string | null | undefined): string | null {
  if (!value || value.length > 2048 || /[\\\u0000-\u001f\u007f]/.test(value)) {
    return null;
  }

  const trimmed = value.trim();
  if (!isSameSiteRelativePath(trimmed) || trimmed.includes('\0')) {
    return null;
  }

  try {
    const parsed = new URL(trimmed, LOCAL_RETURN_ORIGIN);
    if (parsed.origin !== LOCAL_RETURN_ORIGIN) {
      return null;
    }
    const pathname = decodeURIComponent(parsed.pathname);
    if (/%(?:2f|5c|25)/i.test(parsed.pathname) || /[\\\u0000-\u001f\u007f]/.test(pathname)) return null;
    if (/^\/(?:en\/|ko\/|th\/|zh-CN\/)?auth(?:\/|$)/i.test(pathname)) return null;
    const credentialKeys = /^(?:access_?token|refresh_?token|registration_?token|password|otp|token|qr_?token|jti)$/i;
    if ([...parsed.searchParams.keys(), ...new URLSearchParams(parsed.hash.slice(1)).keys()].some((key) => credentialKeys.test(key))) return null;
    const normalized = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    return isSameSiteRelativePath(normalized) ? normalized : null;
  } catch {
    return null;
  }
}

function isSameSiteRelativePath(value: string): boolean {
  return value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\');
}

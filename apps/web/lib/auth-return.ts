const LOCAL_RETURN_ORIGIN = 'https://heygrabit.local';

export function resolveSafeReturnTo(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.includes('\0')) {
    return null;
  }

  try {
    const parsed = new URL(trimmed, LOCAL_RETURN_ORIGIN);
    if (parsed.origin !== LOCAL_RETURN_ORIGIN) {
      return null;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

export function resolveSafeReturnToFromSearch(search: string): string | null {
  return resolveSafeReturnTo(new URLSearchParams(search).get('returnTo'));
}

'use client';

export function navigateToLocalizedPath(pathname: string) {
  if (typeof window === 'undefined') return;

  window.location.assign(pathname);
}

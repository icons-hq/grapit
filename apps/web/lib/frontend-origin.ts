export function getFrontendOrigin(): string | undefined {
  if (typeof window === 'undefined') return undefined;

  return window.location.origin;
}

const KEY = 'grabit-signup-announcement-v1';
const CHANGED = 'grabit:announcement-changed';
export function readAnnouncement() {
  try { const value = localStorage.getItem(KEY); return value && Number.isFinite(Date.parse(value)) ? value : null; } catch { return null; }
}
export function subscribeAnnouncement(listener: () => void) {
  window.addEventListener('storage', listener); window.addEventListener(CHANGED, listener);
  return () => { window.removeEventListener('storage', listener); window.removeEventListener(CHANGED, listener); };
}
export function saveAnnouncement(value: string) {
  try { localStorage.setItem(KEY, value); } catch { /* the active form still works */ }
  window.dispatchEvent(new Event(CHANGED));
}

'use client';
import { record } from '@rrweb/record';
import { ANALYTICS_REPLAY_MAX_BYTES, ANALYTICS_REPLAY_SESSION_BYTES, sanitizeReplayEvent, type ReplayEvent } from '@grabit/shared';
import { getAnalyticsRecordingContext, flushAnalytics } from './analytics-client';
import { apiUrl } from './api-url';

/** A recording is scoped to one route/auth state. Inputs and all text are masked before emit. */
function startRecording() {
  const context = getAnalyticsRecordingContext();
  if (!context || context.path === '/auth' || context.path === '/legal') return () => {};
  const recordingId = crypto.randomUUID(); let events: ReplayEvent[] = []; let bytes = 0; let sentBytes = 0;
  let sending = false; let stopped = false;
  let pending: { id: string; events: ReplayEvent[]; bytes: number } | null = null;
  flushAnalytics();
  const flush = async () => {
    if (sending || (!pending && !events.length)) return;
    const current = getAnalyticsRecordingContext();
    if (!current || current.sessionId !== context.sessionId || current.pageId !== context.pageId) { events = []; bytes = 0; pending = null; return; }
    if (!pending) { pending = { id: crypto.randomUUID(), events, bytes }; events = []; bytes = 0; }
    const batch = pending;
    sending = true;
    try {
      const body = JSON.stringify({ ...context, recordingId, id: batch.id, events: batch.events });
      const response = await fetch(apiUrl('/api/v1/analytics/replay'), { method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer',
        headers: { 'Content-Type': 'application/json' }, body, keepalive: body.length < 50000, signal: AbortSignal.timeout(8000) });
      if (response.ok && (await response.json() as { stored?: boolean }).stored) { sentBytes += batch.bytes; pending = null; }
    } catch { /* bounded memory retry; recording never blocks the page */ }
    finally { sending = false; }
  };
  const stop = record({
    emit(raw) {
      if (stopped || sentBytes > ANALYTICS_REPLAY_SESSION_BYTES) return;
      const current = getAnalyticsRecordingContext();
      if (!current || current.sessionId !== context.sessionId || current.pageId !== context.pageId) return;
      const event = sanitizeReplayEvent(raw); if (!event) return;
      const size = new Blob([JSON.stringify(event)]).size;
      if (bytes + size > ANALYTICS_REPLAY_MAX_BYTES - 2048 || events.length >= 190) { void flush(); return; }
      events.push(event); bytes += size;
      if (bytes > 200000 || events.length >= 150) void flush();
    },
    maskAllInputs: true, maskTextSelector: '*',
    blockSelector: '[data-analytics-private], [data-analytics-consent], iframe, canvas, video, audio',
    inlineStylesheet: true, inlineImages: false, recordCanvas: false, collectFonts: false,
    sampling: { mousemove: 150, scroll: 200, input: 'last' },
    checkoutEveryNms: 60000,
  });
  const interval = window.setInterval(() => { void flush(); }, 5000);
  const visibility = () => { if (document.visibilityState === 'hidden') void flush(); };
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('pagehide', visibility);
  return () => { stopped = true; stop?.(); clearInterval(interval); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('pagehide', visibility); void flush(); };
}

export function startAnalyticsReplay() {
  let key = ''; let stop: (() => void) | undefined;
  const sync = () => {
    const current = getAnalyticsRecordingContext();
    const next = current ? `${current.sessionId}:${current.pageId}` : '';
    if (next === key) return;
    stop?.(); key = next; stop = next ? startRecording() : undefined;
  };
  sync(); const interval = window.setInterval(sync, 1000);
  return () => { clearInterval(interval); stop?.(); };
}

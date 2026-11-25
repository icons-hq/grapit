import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkZoneDdos } from './zone-ddos-monitor.js';

describe('zone DDoS notification source', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  it.each([[[], 'checked'], [[{ datetime: '2026-11-25T01:00:00Z' }], 'mitigated']] as const)(
    'logs the scoped result', async (events, expected) => {
      const read = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { viewer: { zones: [{ firewallEventsAdaptive: events }] } } }) });
      vi.stubGlobal('fetch', read);
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      await checkZoneDdos(JSON.stringify({ zone: 'fixture', token: 'fixture-only' }), 1000);
      const body = JSON.parse(read.mock.calls[0]![1].body);
      expect(body.variables).toMatchObject({ zone: 'fixture', filter: { source: 'l7ddos' } });
      expect(JSON.parse(log.mock.calls[0]![0])).toMatchObject({ event: 'grabit.zone_ddos_' + expected, zone: 'heygrabit.com' });
    },
  );
  it('keeps a provider read error separate from an attack and from payment worker failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('unavailable')));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await checkZoneDdos('{"zone":"fixture","token":"fixture-only"}', 1000);
    expect(JSON.parse(log.mock.calls[0]![0]).event).toBe('grabit.zone_ddos_monitor_error');
  });
});

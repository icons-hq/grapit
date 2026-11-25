const SECURITY_EVENTS_QUERY = `query($zone: string!, $filter: FirewallEventsAdaptiveFilter_InputObject!) {
  viewer { zones(filter: {zoneTag: $zone}) {
    firewallEventsAdaptive(limit: 1, filter: $filter, orderBy: [datetime_DESC]) { datetime }
  }}
}`;

export async function checkZoneDdos(config: string | undefined, timeoutMs: number): Promise<void> {
  if (!config) return;
  // Cloudflare can sample these events. This independently observes this zone;
  // the account-wide notification remains the authoritative mitigation alert.
  let event: string;
  try {
    const { zone, token } = JSON.parse(config) as { zone: string; token: string };
    const now = Date.now();
    const response = await fetch('https://api.cloudflare.com/client/v4/graphql', {
      method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      signal: AbortSignal.timeout(Math.max(1, Math.min(timeoutMs, 5000))),
      body: JSON.stringify({ query: SECURITY_EVENTS_QUERY, variables: { zone, filter: {
        source: 'l7ddos', datetime_geq: new Date(now - 15 * 60_000).toISOString(), datetime_lt: new Date(now).toISOString(),
      } } }),
    });
    if (!response.ok) throw new Error('Cannot read zone security events');
    const value = await response.json() as { errors?: unknown[]; data?: { viewer?: { zones?: { firewallEventsAdaptive?: { datetime: string }[] }[] } } };
    const observations = value.data?.viewer?.zones?.[0]?.firewallEventsAdaptive;
    if (value.errors?.length || !Array.isArray(observations)) throw new Error('No zone analytics result');
    event = observations.length ? 'grabit.zone_ddos_mitigated' : 'grabit.zone_ddos_checked';
  } catch {
    event = 'grabit.zone_ddos_monitor_error';
  }
  console.log(JSON.stringify({ severity: event === 'grabit.zone_ddos_checked' ? 'INFO' : 'WARNING', event, zone: 'heygrabit.com' }));
}

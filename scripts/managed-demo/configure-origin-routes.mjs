import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

// Keep the Google-only analytics transport while admitting ticketing traffic
// only from the production Worker. Both apps discard the routing credential on entry.
const project = 'grapit-491806';
const base = 'https://compute.googleapis.com/compute/v1/projects/' + project + '/global';
const mapName = 'grabit-api-urlmap';
const routeHeader = 'x-grabit-origin-secret';
const readGcloud = (...args) => execFileSync('gcloud', args, { encoding: 'utf8' }).trim();
const access = readGcloud('auth', 'print-access-token');
const routeKey = readGcloud('secrets', 'versions', 'access', 'latest', '--secret=grabit-origin-route-key', '--project=' + project);
if (!/^[a-f0-9]{64}$/.test(routeKey)) throw new Error('Invalid origin routing credential');
const redirect = { hostRedirect: 'heygrabit.com', pathRedirect: '/', stripQuery: true, redirectResponseCode: 'SEE_OTHER' };
const service = tier => base + '/backendServices/grabit-' + tier + '-backend';
const protectedMatcher = tier => ({
  name: tier + '-matcher', defaultUrlRedirect: redirect,
  routeRules: [{
    priority: 1, service: service(tier),
    matchRules: [{ prefixMatch: '/', headerMatches: [{ headerName: routeHeader, exactMatch: routeKey }] }],
  }],
});

async function api(method, url, body) {
  const response = await fetch(url, {
    method, headers: { authorization: 'Bearer ' + access, 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  if (!response.ok) throw new Error((data.error?.message ?? ('Google HTTP ' + response.status)).replaceAll(routeKey, '[redacted]'));
  return data;
}

const mapUrl = base + '/urlMaps/' + mapName;
const live = await api('GET', mapUrl);
const hosts = [
  { hosts: ['api.heygrabit.com', 'api.origin.heygrabit.com'], pathMatcher: 'api-matcher' },
  { hosts: ['heygrabit.com', 'www.heygrabit.com', 'web.origin.heygrabit.com'], pathMatcher: 'web-matcher' },
  { hosts: ['analytics.origin.heygrabit.com'], pathMatcher: 'analytics-matcher' },
];
const expectedHosts = new Set(hosts.flatMap(rule => rule.hosts));
if (live.hostRules?.some(rule => rule.hosts.some(host => !expectedHosts.has(host))) ||
    live.pathMatchers?.some(matcher => !hosts.some(rule => rule.pathMatcher === matcher.name))) {
  throw new Error('An unrecognized route shares this map. Preserve it explicitly before changing ticketing.');
}
const analyticsPaths = ['/api/v1/analytics', '/api/v1/admin/analytics'];
const resource = {
  name: mapName, fingerprint: live.fingerprint, defaultUrlRedirect: redirect, hostRules: hosts,
  pathMatchers: [protectedMatcher('api'), protectedMatcher('web'), {
    name: 'analytics-matcher', defaultUrlRedirect: redirect,
    routeRules: [{
      priority: 1, service: service('api'),
      matchRules: analyticsPaths.flatMap(path => [{ fullPathMatch: path }, { prefixMatch: path + '/' }]),
      headerAction: { requestHeadersToRemove: ['x-grabit-edge-secret', 'x-grabit-client-ip'] },
    }],
  }],
};
const validation = await api('POST', mapUrl + '/validate', { loadBalancingScheme: 'EXTERNAL_MANAGED', resource });
if (!validation.result?.loadSucceeded || validation.result?.testPassed === false) {
  throw new Error('Routing validation failed: ' + JSON.stringify(validation.result?.loadErrors || validation.result?.testFailures).replaceAll(routeKey, '[redacted]'));
}
console.log('Google validated the protected Web/API routes and the analytics-only host.');
if (process.argv.includes('--apply')) {
  let op = await api('PUT', mapUrl, resource);
  for (let attempt = 0; op.status !== 'DONE' && attempt < 100; attempt++) {
    await delay(1500);
    op = await api('GET', base + '/operations/' + op.name);
  }
  if (op.status !== 'DONE' || op.error) throw new Error('Origin route update failed or timed out.');
  console.log('Protected origin routes applied.');
}

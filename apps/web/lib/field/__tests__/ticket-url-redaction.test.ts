import { afterEach, describe, expect, it } from 'vitest';
import {
  readFieldTicketParam,
  redactSensitiveUrlParams,
  scrubFieldTicketFromLocation,
  scrubSensitiveUrlParams,
  searchWithoutFieldTicketParams,
} from '../ticket-url-redaction';

const RAW = 'raw-ticket-credential-0123456789';

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('field ticket URL handling', () => {
  it('reads ticket first and falls back to the legacy token parameter', () => {
    expect(readFieldTicketParam(new URLSearchParams({ ticket: ` ${RAW} ` }))).toBe(RAW);
    expect(readFieldTicketParam(new URLSearchParams({ token: RAW }))).toBe(RAW);
    expect(readFieldTicketParam(new URLSearchParams({ showtimeId: 'st-1' }))).toBe('');
  });

  it('drops ticket and token from a search string but keeps other parameters', () => {
    expect(searchWithoutFieldTicketParams(`?ticket=${RAW}&showtimeId=st-1&token=${RAW}`)).toBe('?showtimeId=st-1');
    expect(searchWithoutFieldTicketParams(`ticket=${RAW}`)).toBe('');
  });

  it('removes the credential from the address bar and history entry in place', () => {
    window.history.replaceState(null, '', `/field/check-in?ticket=${RAW}&showtimeId=st-1#top`);
    const before = window.history.length;

    expect(scrubFieldTicketFromLocation()).toBe(true);
    expect(window.location.pathname).toBe('/field/check-in');
    expect(window.location.search).toBe('?showtimeId=st-1');
    expect(window.location.hash).toBe('#top');
    expect(window.location.href).not.toContain(RAW);
    expect(window.history.length).toBe(before);
    expect(scrubFieldTicketFromLocation()).toBe(false);
  });
});

describe('telemetry redaction', () => {
  it('masks plain and percent-encoded ticket/token parameters', () => {
    expect(redactSensitiveUrlParams(`https://heygrabit.com/field/check-in?ticket=${RAW}&showtimeId=st-1`))
      .toBe('https://heygrabit.com/field/check-in?ticket=[Filtered]&showtimeId=st-1');
    expect(redactSensitiveUrlParams(`/auth?returnTo=%2Ffield%2Fcheck-in%3Fticket%3D${RAW}%26showtimeId%3Dst-1`))
      .toBe('/auth?returnTo=%2Ffield%2Fcheck-in%3Fticket%3D[Filtered]%26showtimeId%3Dst-1');
    expect(redactSensitiveUrlParams(`token=${RAW}`)).toBe('token=[Filtered]');
    expect(redactSensitiveUrlParams('/reservations?accessToken=keep')).toBe('/reservations?accessToken=keep');
  });

  it('scrubs request, breadcrumbs and spans of a Sentry event', () => {
    const event = {
      request: {
        url: `https://heygrabit.com/field/check-in?ticket=${RAW}`,
        query_string: [['ticket', RAW], ['showtimeId', 'st-1']] as [string, string][],
      },
      breadcrumbs: [
        { category: 'navigation', data: { from: `/field/check-in?ticket=${RAW}&showtimeId=st-1`, to: '/field/check-in?showtimeId=st-1' } },
      ],
      spans: [{ description: `GET /field/check-in?ticket=${RAW}`, data: { 'url.full': `https://heygrabit.com/field/check-in?token=${RAW}` } }],
      extra: { ticket: RAW },
    };

    const scrubbed = scrubSensitiveUrlParams(event);

    expect(JSON.stringify(scrubbed)).not.toContain(RAW);
    expect(scrubbed.request.query_string[1]).toEqual(['showtimeId', 'st-1']);
    expect(scrubbed.breadcrumbs[0]?.data.to).toBe('/field/check-in?showtimeId=st-1');
  });

  it('leaves SDK internals such as captured scopes untouched', () => {
    class FakeScope {
      lastUrl = `/field/check-in?ticket=${RAW}`;
    }
    const scope = new FakeScope();
    const event = { sdkProcessingMetadata: { capturedSpanScope: scope, note: `?ticket=${RAW}` }, request: { url: `/x?ticket=${RAW}` } };

    scrubSensitiveUrlParams(event);

    expect(scope.lastUrl).toContain(RAW);
    expect(event.sdkProcessingMetadata.note).toContain(RAW);
    expect(event.request.url).toBe('/x?ticket=[Filtered]');
  });

  it('masks a query string kept as a plain string', () => {
    expect(scrubSensitiveUrlParams({ request: { query_string: `ticket=${RAW}&showtimeId=st-1` } }))
      .toEqual({ request: { query_string: 'ticket=[Filtered]&showtimeId=st-1' } });
  });
});

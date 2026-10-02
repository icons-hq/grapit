import { describe, expect, it } from 'vitest';

import {
  isConnectionLossDatabaseError,
  isTransientDatabaseError,
} from './transient-db-error.js';

describe('isTransientDatabaseError', () => {
  it.each([
    ['deadlock', Object.assign(new Error('deadlock detected'), { code: '40P01' })],
    ['serialization failure', Object.assign(new Error('could not serialize'), { code: '40001' })],
    ['admin shutdown (failover)', Object.assign(new Error('terminating connection'), { code: '57P01' })],
    ['connection reset', Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' })],
    ['pool acquire timeout', new Error('timeout exceeded when trying to connect')],
    ['dropped connection', new Error('Connection terminated unexpectedly')],
    [
      'drizzle-wrapped pool timeout',
      new Error('Failed query: select 1', { cause: new Error('timeout exceeded when trying to connect') }),
    ],
    [
      'drizzle-wrapped deadlock',
      new Error('Failed query', { cause: Object.assign(new Error('deadlock'), { code: '40P01' }) }),
    ],
  ])('retries %s', (_label, error) => {
    expect(isTransientDatabaseError(error)).toBe(true);
  });

  it.each([
    ['unique violation', Object.assign(new Error('duplicate key'), { code: '23505' })],
    ['undefined column', Object.assign(new Error('column does not exist'), { code: '42703' })],
    ['plain error', new Error('db write failed')],
    ['non-error value', 'boom'],
    ['undefined', undefined],
  ])('does not retry %s', (_label, error) => {
    expect(isTransientDatabaseError(error)).toBe(false);
  });
});

describe('isConnectionLossDatabaseError', () => {
  it.each([
    ['connection reset', Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' })],
    ['dropped connection', new Error('Connection terminated unexpectedly')],
    ['admin shutdown (failover)', Object.assign(new Error('terminating connection'), { code: '57P01' })],
    ['connection failure', Object.assign(new Error('connection failure'), { code: '08006' })],
    [
      'drizzle-wrapped dropped connection',
      new Error('Failed query: commit', { cause: new Error('Connection terminated unexpectedly') }),
    ],
  ])('treats %s as a possibly committed transaction', (_label, error) => {
    expect(isConnectionLossDatabaseError(error)).toBe(true);
  });

  it.each([
    ['pool acquire timeout', new Error('timeout exceeded when trying to connect')],
    ['connect timeout', new Error('Connection terminated due to connection timeout')],
    ['refused connection', Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })],
    ['too many connections', Object.assign(new Error('too many clients'), { code: '53300' })],
    ['deadlock', Object.assign(new Error('deadlock detected'), { code: '40P01' })],
    ['plain error', new Error('db write failed')],
  ])('treats %s as never committed', (_label, error) => {
    expect(isConnectionLossDatabaseError(error)).toBe(false);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { coalesceFreshReads, FreshReadBatcher } from './fresh-read-batcher.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('FreshReadBatcher', () => {
  it('bounds each query and returns only the value belonging to its caller', async () => {
    const load = vi.fn(async (keys: readonly string[]) => new Map(keys.map((key) => [key, `value:${key}`])));
    const reader = new FreshReadBatcher(load, 2);
    await expect(Promise.all(['a', 'b', 'a', 'c', 'd', 'e'].map((key) => reader.read(key))))
      .resolves.toEqual(['value:a', 'value:b', 'value:a', 'value:c', 'value:d', 'value:e']);
    expect(load.mock.calls.map(([keys]) => keys)).toEqual([['a', 'b'], ['c', 'd'], ['e']]);
  });

  it('puts a same-key read arriving after a query starts into a newer snapshot', async () => {
    const started = deferred<void>();
    const firstSnapshot = deferred<ReadonlyMap<string, string>>();
    const load = vi.fn(async () => {
      if (load.mock.calls.length === 1) { started.resolve(); return firstSnapshot.promise; }
      return new Map([['buyer', 'withdrawn']]);
    });
    const reader = new FreshReadBatcher(load);
    const first = reader.read('buyer');
    await started.promise;
    const afterWithdrawal = reader.read('buyer');
    firstSnapshot.resolve(new Map([['buyer', 'active']]));
    await expect(first).resolves.toBe('active');
    await expect(afterWithdrawal).resolves.toBe('withdrawn');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('does not cache a missing record or a previously returned record', async () => {
    let current: string | undefined;
    const reader = new FreshReadBatcher<string, string>(async () =>
      new Map(current === undefined ? [] : [['token', current]]));
    await expect(reader.read('token')).resolves.toBeUndefined();
    current = 'valid';
    await expect(reader.read('token')).resolves.toBe('valid');
    current = undefined;
    await expect(reader.read('token')).resolves.toBeUndefined();
  });

  it('rejects a failed batch and still drains requests that arrived during it', async () => {
    const started = deferred<void>();
    const firstSnapshot = deferred<ReadonlyMap<string, string>>();
    const failure = new Error('database unavailable');
    const load = vi.fn(async () => {
      if (load.mock.calls.length === 1) { started.resolve(); return firstSnapshot.promise; }
      return new Map([['buyer', 'reconnected']]);
    });
    const reader = new FreshReadBatcher(load);
    const failed = expect(reader.read('buyer')).rejects.toBe(failure);
    await started.promise;
    const retry = reader.read('buyer');
    firstSnapshot.reject(failure);
    await failed;
    await expect(retry).resolves.toBe('reconnected');
  });
});

describe('coalesceFreshReads', () => {
  it('lets unrelated keys complete while one read is blocked, without retaining values', async () => {
    const slow = deferred<string>();
    const started = deferred<void>();
    const load = vi.fn(async (key: string) => {
      if (key === 'slow') { started.resolve(); return slow.promise; }
      return key;
    });
    const read = coalesceFreshReads(load);
    const blocked = read('slow');
    await started.promise;
    await expect(read('fast')).resolves.toBe('fast');
    await expect(read('fast')).resolves.toBe('fast');
    slow.resolve('finished');
    await expect(blocked).resolves.toBe('finished');
    expect(load.mock.calls.map(([key]) => key)).toEqual(['slow', 'fast', 'fast']);
  });

  it('groups same-turn callers, but re-reads callers arriving during the query', async () => {
    const snapshot = deferred<undefined>();
    const started = deferred<void>();
    let present = false;
    const load = vi.fn(async () => {
      if (!present) { started.resolve(); return snapshot.promise; }
      return 'new value';
    });
    const read = coalesceFreshReads(load);
    const first = read('key');
    const sameTurn = read('key');
    await started.promise;
    present = true;
    const newer = read('key');
    snapshot.resolve(undefined);
    await expect(Promise.all([first, sameTurn, newer])).resolves.toEqual([undefined, undefined, 'new value']);
    expect(load).toHaveBeenCalledTimes(2);
  });
});

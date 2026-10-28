type Waiter<Value> = {
  resolve: (value: Value | undefined) => void;
  reject: (reason: unknown) => void;
};

/**
 * Combine a burst of reads without caching authority or customer data.
 * A batch is removed from the pending map BEFORE its query starts. Even a
 * read of the same key arriving during that query joins a later DB snapshot.
 * One bounded query runs at a time, leaving pool slots for other operations.
 */
export class FreshReadBatcher<Key, Value> {
  private readonly pending = new Map<Key, Waiter<Value>[]>();
  private scheduled = false;
  private running = false;

  constructor(
    private readonly load: (keys: readonly Key[]) => Promise<ReadonlyMap<Key, Value>>,
    private readonly maxBatchSize = 128,
  ) {
    if (!Number.isInteger(maxBatchSize) || maxBatchSize < 1) {
      throw new Error('A positive batch size is required');
    }
  }

  read(key: Key): Promise<Value | undefined> {
    const result = new Promise<Value | undefined>((resolve, reject) => {
      const waiters = this.pending.get(key) ?? [];
      waiters.push({ resolve, reject });
      this.pending.set(key, waiters);
    });
    this.schedule();
    return result;
  }

  private schedule(): void {
    if (this.scheduled || this.running || this.pending.size === 0) return;
    this.scheduled = true;
    // Collect the current I/O turn; no TTL or artificial millisecond window.
    setImmediate(() => { void this.flush(); });
  }

  private async flush(): Promise<void> {
    this.scheduled = false;
    this.running = true;
    const batch = new Map<Key, Waiter<Value>[]>();
    for (const [key, waiters] of this.pending) {
      batch.set(key, waiters);
      this.pending.delete(key);
      if (batch.size >= this.maxBatchSize) break;
    }
    try {
      const values = await this.load([...batch.keys()]);
      for (const [key, waiters] of batch) {
        const value = values.get(key);
        for (const waiter of waiters) waiter.resolve(value);
      }
    } catch (error) {
      for (const waiters of batch.values()) {
        for (const waiter of waiters) waiter.reject(error);
      }
    } finally {
      this.running = false;
      this.schedule();
    }
  }
}

/**
 * Coalesce identical reads while keeping different keys independent. Reuses
 * the batcher's freshness rule but leaves an existing single-key query intact.
 * Entries live only while callers are awaiting them, with no result cache.
 */
export function coalesceFreshReads<Key, Value>(load: (key: Key) => Promise<Value>) {
  const entries = new Map<Key, {
    batch: FreshReadBatcher<Key, { value: Value }>;
    callers: number;
  }>();
  return async (key: Key): Promise<Value> => {
    let entry = entries.get(key);
    if (!entry) {
      entry = {
        batch: new FreshReadBatcher<Key, { value: Value }>(async () => new Map([[key, { value: await load(key) }]])),
        callers: 0,
      };
      entries.set(key, entry);
    }
    entry.callers += 1;
    try {
      const result = await entry.batch.read(key);
      if (!result) throw new Error('Fresh read did not return its requested key');
      return result.value;
    } finally {
      entry.callers -= 1;
      if (entry.callers === 0) entries.delete(key);
    }
  };
}

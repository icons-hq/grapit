/**
 * PostgreSQL/pg-pool failures after which the same transaction can be retried
 * safely: the server rolled the transaction back (serialization/deadlock,
 * cancelled statement) or the connection never ran it / died with it.
 *
 * A connection that dies during COMMIT may still have committed, so callers
 * must re-read the committed state before retrying.
 */
const TRANSIENT_SQLSTATES = new Set([
  '40001', // serialization_failure
  '40P01', // deadlock_detected
  '55P03', // lock_not_available (lock_timeout)
  '57014', // query_canceled (statement_timeout)
  '57P01', // admin_shutdown
  '57P02', // crash_shutdown
  '57P03', // cannot_connect_now
  '53300', // too_many_connections
  '08000', // connection_exception
  '08001', // sqlclient_unable_to_establish_sqlconnection
  '08003', // connection_does_not_exist
  '08004', // sqlserver_rejected_establishment_of_sqlconnection
  '08006', // connection_failure
]);

const TRANSIENT_NODE_ERROR_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EPIPE',
  'EAI_AGAIN',
]);

const TRANSIENT_MESSAGE_FRAGMENTS = [
  'timeout exceeded when trying to connect',
  'connection terminated unexpectedly',
  'connection terminated due to connection timeout',
  'client has encountered a connection error and is not queryable',
];

const MAX_CAUSE_DEPTH = 4;

export function isTransientDatabaseError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && current; depth += 1) {
    const candidate = current as { code?: unknown; message?: unknown; cause?: unknown };
    if (typeof candidate.code === 'string') {
      if (TRANSIENT_SQLSTATES.has(candidate.code) || TRANSIENT_NODE_ERROR_CODES.has(candidate.code)) {
        return true;
      }
    }
    if (typeof candidate.message === 'string') {
      const message = candidate.message.toLowerCase();
      if (TRANSIENT_MESSAGE_FRAGMENTS.some((fragment) => message.includes(fragment))) {
        return true;
      }
    }
    current = candidate.cause;
  }
  return false;
}

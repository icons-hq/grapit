import type { FieldCheckInOutcome } from './schemas/field-operations.schema';
import { fieldCheckInOutcomeSchema } from './schemas/field-operations.schema';

export const FIELD_CHECK_IN_PATH = '/field/check-in';
export const FIELD_CHECK_IN_TICKET_PARAM = 'ticket';
export const LEGACY_FIELD_CHECK_IN_TOKEN_PARAM = 'token';

export interface FieldCheckInTokenInput {
  token?: string | null;
  qrUrl?: string | null;
}

function clean(value: string | null | undefined): string {
  return value?.trim() ?? '';
}

export function buildFieldCheckInUrl(token: string, publicWebOrigin: string): string {
  const url = new URL(FIELD_CHECK_IN_PATH, publicWebOrigin);
  url.searchParams.set(FIELD_CHECK_IN_TICKET_PARAM, token);
  return url.toString();
}

export function parseFieldCheckInToken(input: FieldCheckInTokenInput): string {
  const directToken = clean(input.token);
  if (directToken) {
    return directToken;
  }

  const qrUrl = clean(input.qrUrl);
  if (!qrUrl) {
    return '';
  }

  try {
    const url = new URL(qrUrl);
    return (
      clean(url.searchParams.get(FIELD_CHECK_IN_TICKET_PARAM)) ||
      clean(url.searchParams.get(LEGACY_FIELD_CHECK_IN_TOKEN_PARAM))
    );
  } catch {
    return '';
  }
}

export function normalizeFieldCheckInOutcome(
  value: string | null | undefined,
): FieldCheckInOutcome | null {
  const normalized = clean(value).replaceAll('-', '_');

  if (normalized === 'processed') {
    return 'entered';
  }
  if (normalized === 'refunded') {
    return 'refunded_cancelled';
  }

  const parsed = fieldCheckInOutcomeSchema.safeParse(normalized);
  return parsed.success ? parsed.data : null;
}

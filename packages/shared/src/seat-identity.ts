import type {
  FloorAwareSeatSelection,
  SeatSelection,
} from './types/booking.types';

export const DEFAULT_SEAT_FLOOR_KEY = '1F';
export const DEFAULT_SEAT_FLOOR_LABEL = '1층';

export interface SeatIdentity {
  floorKey: string;
  floorLabel: string;
  seatId: string;
  seatKey: string;
}

export interface SeatIdentityDefaults {
  defaultFloorKey?: string;
  defaultFloorLabel?: string;
}

export type SeatIdentityInput = {
  seatId: string;
  floorKey?: string | null;
  floorLabel?: string | null;
  seatKey?: string | null;
};

function clean(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function splitSeatKey(value: string | undefined): {
  floorKey: string;
  seatId: string;
} | null {
  if (!value) return null;

  const separatorIndex = value.indexOf(':');
  if (separatorIndex <= 0) return null;

  return {
    floorKey: value.slice(0, separatorIndex),
    seatId: value.slice(separatorIndex + 1),
  };
}

export function normalizeSeatIdentity(
  input: SeatIdentityInput,
  defaults: SeatIdentityDefaults = {},
): SeatIdentity {
  const defaultFloorKey = clean(defaults.defaultFloorKey) ?? DEFAULT_SEAT_FLOOR_KEY;
  const defaultFloorLabel =
    clean(defaults.defaultFloorLabel) ?? DEFAULT_SEAT_FLOOR_LABEL;
  const rawSeatKey = clean(input.seatKey);
  const rawSeatId = clean(input.seatId) ?? '';
  const seatKeyParts = splitSeatKey(rawSeatKey);
  const seatIdParts = splitSeatKey(rawSeatId);
  const floorKey =
    clean(input.floorKey) ??
    seatKeyParts?.floorKey ??
    seatIdParts?.floorKey ??
    defaultFloorKey;
  const seatId = seatKeyParts?.seatId ?? seatIdParts?.seatId ?? rawSeatId;

  return {
    floorKey,
    floorLabel:
      clean(input.floorLabel) ??
      (floorKey === defaultFloorKey ? defaultFloorLabel : floorKey),
    seatId,
    seatKey: `${floorKey}:${seatId}`,
  };
}

export function toFloorAwareSeatSelection<TSeat extends SeatSelection>(
  seat: TSeat | FloorAwareSeatSelection,
  defaults: SeatIdentityDefaults = {},
): TSeat & FloorAwareSeatSelection {
  const identity = normalizeSeatIdentity(seat, defaults);

  return {
    ...seat,
    seatId: identity.seatId,
    floorKey: identity.floorKey,
    floorLabel: identity.floorLabel,
    seatKey: identity.seatKey,
  } as TSeat & FloorAwareSeatSelection;
}

export function encodeSeatRuntimeId(seatIdOrKey: string): string {
  return encodeURIComponent(normalizeSeatIdentity({ seatId: seatIdOrKey }).seatKey);
}

export function decodeSeatRuntimeId(runtimeSeatId: string): string {
  return decodeURIComponent(runtimeSeatId);
}

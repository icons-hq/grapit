import { createHash } from 'node:crypto';

export interface MergeCandidateUser {
  id: string;
  name: string;
  phone: string;
  birthDate: string;
  isPhoneVerified: boolean;
  accountStatus: string;
}

export interface ReservationCounts {
  total: number;
  confirmed: number;
}

export interface DuplicateGroupInput {
  groupKey: string;
  users: MergeCandidateUser[];
  reservationCounts: Record<string, ReservationCounts>;
}

export type ManualReviewReason =
  | 'identity_evidence_incomplete'
  | 'multiple_confirmed_owners'
  | 'multiple_reservation_owners'
  | 'no_reservation_owner';

export type MergeClassification =
  | {
      kind: 'safe';
      groupKey: string;
      targetUserId: string;
      sourceUserIds: string[];
    }
  | {
      kind: 'manual_review';
      groupKey: string;
      reason: ManualReviewReason;
      userIds: string[];
    };

export function normalizeMergePhone(phone: string): string {
  return phone.replace(/\D/g, '');
}

export function normalizeMergeName(name: string): string {
  return name.trim().replace(/\s/g, '').toLowerCase();
}

export function buildMergeGroupKey(
  user: Pick<MergeCandidateUser, 'phone' | 'birthDate' | 'name'>,
): string {
  return [
    normalizeMergePhone(user.phone),
    user.birthDate,
    normalizeMergeName(user.name),
  ].join('|');
}

export function classifyDuplicateGroup(
  input: DuplicateGroupInput,
): MergeClassification {
  const eligibleUsers = input.users.filter(isEligibleForAutoMerge);
  if (eligibleUsers.length !== input.users.length) {
    return manualReview(input, 'identity_evidence_incomplete');
  }

  const confirmedOwners = eligibleUsers.filter(
    (user) => (input.reservationCounts[user.id]?.confirmed ?? 0) > 0,
  );
  if (confirmedOwners.length > 1) {
    return manualReview(input, 'multiple_confirmed_owners');
  }
  if (confirmedOwners.length === 1) {
    return safeMerge(input.groupKey, eligibleUsers, confirmedOwners[0].id);
  }

  const reservationOwners = eligibleUsers.filter(
    (user) => (input.reservationCounts[user.id]?.total ?? 0) > 0,
  );
  if (reservationOwners.length > 1) {
    return manualReview(input, 'multiple_reservation_owners');
  }
  if (reservationOwners.length === 1) {
    return safeMerge(input.groupKey, eligibleUsers, reservationOwners[0].id);
  }

  return manualReview(input, 'no_reservation_owner');
}

export function maskMergeIdentity(
  user: Pick<MergeCandidateUser, 'name' | 'phone' | 'birthDate'>,
): { name: string; phone: string; birthDate: string } {
  const phoneDigits = normalizeMergePhone(user.phone);
  return {
    name: maskName(user.name),
    phone: `${phoneDigits.slice(0, 4)}****${phoneDigits.slice(-4)}`,
    birthDate: `${user.birthDate.slice(0, 4)}-**-**`,
  };
}

export function hashJson(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function isEligibleForAutoMerge(user: MergeCandidateUser): boolean {
  return user.accountStatus === 'active' && user.isPhoneVerified;
}

function safeMerge(
  groupKey: string,
  users: MergeCandidateUser[],
  targetUserId: string,
): Extract<MergeClassification, { kind: 'safe' }> {
  return {
    kind: 'safe',
    groupKey,
    targetUserId,
    sourceUserIds: users
      .map((user) => user.id)
      .filter((userId) => userId !== targetUserId)
      .sort(),
  };
}

function manualReview(
  input: DuplicateGroupInput,
  reason: ManualReviewReason,
): Extract<MergeClassification, { kind: 'manual_review' }> {
  return {
    kind: 'manual_review',
    groupKey: input.groupKey,
    reason,
    userIds: input.users.map((user) => user.id).sort(),
  };
}

function maskName(name: string): string {
  const compactName = name.replace(/\s/g, '');
  if (compactName.length <= 1) {
    return compactName;
  }
  if (compactName.length === 2) {
    return `${compactName[0]}*`;
  }
  return `${compactName[0]}*${compactName[compactName.length - 1]}`;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`)
      .join(',')}}`;
  }

  return JSON.stringify(value) ?? 'null';
}

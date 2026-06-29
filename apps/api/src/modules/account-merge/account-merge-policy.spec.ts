import { describe, expect, it } from 'vitest';
import {
  buildMergeGroupKey,
  classifyDuplicateGroup,
  hashJson,
  maskMergeIdentity,
  normalizeMergeName,
  normalizeMergePhone,
  type MergeCandidateUser,
} from './account-merge-policy.js';

const baseUser: MergeCandidateUser = {
  id: 'user-1',
  name: ' 홍  길동 ',
  phone: '+82 10-1234-5678',
  birthDate: '1995-05-15',
  isPhoneVerified: true,
  accountStatus: 'active',
};

describe('account merge policy', () => {
  it('normalizes identity evidence for historical duplicate grouping', () => {
    expect(normalizeMergePhone('+82 10-1234-5678')).toBe('821012345678');
    expect(normalizeMergeName(' 홍  길동 ')).toBe('홍길동');
    expect(buildMergeGroupKey(baseUser)).toBe('821012345678|1995-05-15|홍길동');
  });

  it('classifies one confirmed owner as an automatic safe merge group', () => {
    const result = classifyDuplicateGroup({
      groupKey: 'group-1',
      users: [
        { ...baseUser, id: 'source-1' },
        { ...baseUser, id: 'target-1' },
      ],
      reservationCounts: {
        'source-1': { total: 0, confirmed: 0 },
        'target-1': { total: 2, confirmed: 1 },
      },
    });

    expect(result).toEqual({
      kind: 'safe',
      groupKey: 'group-1',
      targetUserId: 'target-1',
      sourceUserIds: ['source-1'],
    });
  });

  it('uses the only confirmed reservation owner as target before unconfirmed reservation ownership', () => {
    const result = classifyDuplicateGroup({
      groupKey: 'group-2',
      users: [
        { ...baseUser, id: 'confirmed-owner' },
        { ...baseUser, id: 'unconfirmed-owner' },
      ],
      reservationCounts: {
        'confirmed-owner': { total: 1, confirmed: 1 },
        'unconfirmed-owner': { total: 1, confirmed: 0 },
      },
    });

    expect(result).toMatchObject({
      kind: 'safe',
      targetUserId: 'confirmed-owner',
      sourceUserIds: ['unconfirmed-owner'],
    });
  });

  it('requires manual review when identity evidence is incomplete', () => {
    const result = classifyDuplicateGroup({
      groupKey: 'group-3',
      users: [
        { ...baseUser, id: 'active-verified' },
        { ...baseUser, id: 'inactive', accountStatus: 'withdrawn' },
        { ...baseUser, id: 'unverified', isPhoneVerified: false },
      ],
      reservationCounts: {
        'active-verified': { total: 0, confirmed: 0 },
        inactive: { total: 0, confirmed: 0 },
        unverified: { total: 0, confirmed: 0 },
      },
    });

    expect(result).toEqual({
      kind: 'manual_review',
      groupKey: 'group-3',
      reason: 'identity_evidence_incomplete',
      userIds: ['active-verified', 'inactive', 'unverified'],
    });
  });

  it('requires manual review when multiple accounts own confirmed reservations', () => {
    const result = classifyDuplicateGroup({
      groupKey: 'group-4',
      users: [
        { ...baseUser, id: 'user-a' },
        { ...baseUser, id: 'user-b' },
      ],
      reservationCounts: {
        'user-a': { total: 1, confirmed: 1 },
        'user-b': { total: 2, confirmed: 2 },
      },
    });

    expect(result).toEqual({
      kind: 'manual_review',
      groupKey: 'group-4',
      reason: 'multiple_confirmed_owners',
      userIds: ['user-a', 'user-b'],
    });
  });

  it('uses the only reservation owner as target when no reservations are confirmed', () => {
    const result = classifyDuplicateGroup({
      groupKey: 'group-5',
      users: [
        { ...baseUser, id: 'source-1' },
        { ...baseUser, id: 'target-1' },
      ],
      reservationCounts: {
        'source-1': { total: 0, confirmed: 0 },
        'target-1': { total: 2, confirmed: 0 },
      },
    });

    expect(result).toEqual({
      kind: 'safe',
      groupKey: 'group-5',
      targetUserId: 'target-1',
      sourceUserIds: ['source-1'],
    });
  });

  it('requires manual review when multiple accounts own only unconfirmed reservations', () => {
    const result = classifyDuplicateGroup({
      groupKey: 'group-6',
      users: [
        { ...baseUser, id: 'user-a' },
        { ...baseUser, id: 'user-b' },
      ],
      reservationCounts: {
        'user-a': { total: 1, confirmed: 0 },
        'user-b': { total: 1, confirmed: 0 },
      },
    });

    expect(result).toEqual({
      kind: 'manual_review',
      groupKey: 'group-6',
      reason: 'multiple_reservation_owners',
      userIds: ['user-a', 'user-b'],
    });
  });

  it('does not automatically merge groups without reservations', () => {
    const result = classifyDuplicateGroup({
      groupKey: 'group-7',
      users: [
        { ...baseUser, id: 'user-a' },
        { ...baseUser, id: 'user-b' },
      ],
      reservationCounts: {
        'user-a': { total: 0, confirmed: 0 },
        'user-b': { total: 0, confirmed: 0 },
      },
    });

    expect(result).toEqual({
      kind: 'manual_review',
      groupKey: 'group-7',
      reason: 'no_reservation_owner',
      userIds: ['user-a', 'user-b'],
    });
  });

  it('sorts source user ids for safe merge reports', () => {
    const result = classifyDuplicateGroup({
      groupKey: 'group-8',
      users: [
        { ...baseUser, id: 'source-z' },
        { ...baseUser, id: 'target-1' },
        { ...baseUser, id: 'source-a' },
      ],
      reservationCounts: {
        'source-z': { total: 0, confirmed: 0 },
        'target-1': { total: 1, confirmed: 1 },
        'source-a': { total: 0, confirmed: 0 },
      },
    });

    expect(result).toMatchObject({
      kind: 'safe',
      targetUserId: 'target-1',
      sourceUserIds: ['source-a', 'source-z'],
    });
  });

  it('masks identity and hashes reports deterministically', () => {
    expect(maskMergeIdentity(baseUser)).toEqual({
      name: '홍*동',
      phone: '8210****5678',
      birthDate: '1995-**-**',
    });
    expect(hashJson({ b: 1, a: 2 })).toBe(hashJson({ a: 2, b: 1 }));
  });
});

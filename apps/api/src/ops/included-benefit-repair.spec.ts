import { describe, expect, it } from 'vitest';

import { parseIncludedBenefitRepairArgs } from './included-benefit-repair.js';

const SHOWTIME_ID = '3d66b3d3-61f3-427c-9fda-1a5eece511c5';
const OPERATOR_ID = '00000000-0000-4000-8000-0000000000a1';
const HASH = 'a'.repeat(64);

describe('included-benefit-repair CLI arguments', () => {
  it('keeps dry-run free of operator inputs', () => {
    expect(parseIncludedBenefitRepairArgs(['dry-run', SHOWTIME_ID]))
      .toEqual({ mode: 'dry-run', showtimeId: SHOWTIME_ID });
    expect(() => parseIncludedBenefitRepairArgs(['dry-run', SHOWTIME_ID, HASH])).toThrow(/^Usage:/);
  });

  it('requires an operator and a reason for apply so the run is auditable', () => {
    expect(parseIncludedBenefitRepairArgs([
      'apply', SHOWTIME_ID, HASH, '--operator-user-id', OPERATOR_ID, '--reason', '  CS-1234 누락 포스터 복구 승인  ',
    ])).toEqual({
      mode: 'apply',
      showtimeId: SHOWTIME_ID,
      expectedHash: HASH,
      operatorUserId: OPERATOR_ID,
      reason: 'CS-1234 누락 포스터 복구 승인',
    });
    expect(() => parseIncludedBenefitRepairArgs(['apply', SHOWTIME_ID, HASH]))
      .toThrow('BENEFIT_REPAIR_OPERATOR_REQUIRED');
    expect(() => parseIncludedBenefitRepairArgs(['apply', SHOWTIME_ID, HASH, '--operator-user-id', OPERATOR_ID]))
      .toThrow('BENEFIT_REPAIR_REASON_REQUIRED');
    expect(() => parseIncludedBenefitRepairArgs([
      'apply', SHOWTIME_ID, HASH, '--operator-user-id', OPERATOR_ID, '--reason', '짧음',
    ])).toThrow('BENEFIT_REPAIR_REASON_REQUIRED');
  });

  it('rejects malformed hashes, showtimes and unknown or repeated flags', () => {
    const valid = ['--operator-user-id', OPERATOR_ID, '--reason', 'CS-1234 누락 포스터 복구 승인'];
    expect(() => parseIncludedBenefitRepairArgs(['apply', SHOWTIME_ID, 'invalid', ...valid])).toThrow(/^Usage:/);
    expect(() => parseIncludedBenefitRepairArgs(['apply', 'not-a-uuid', HASH, ...valid])).toThrow(/^Usage:/);
    expect(() => parseIncludedBenefitRepairArgs(['apply', SHOWTIME_ID, HASH, ...valid, '--force', 'yes']))
      .toThrow(/^Usage:/);
    expect(() => parseIncludedBenefitRepairArgs(['apply', SHOWTIME_ID, HASH, ...valid, '--reason', 'second reason text']))
      .toThrow(/^Usage:/);
  });
});

import { describe, it, expect } from 'vitest';
import {
  getE164Country,
  parseE164,
} from './phone.util.js';

describe('parseE164', () => {
  it('한국 로컬 포맷(하이픈 포함) → E.164', () => {
    expect(parseE164('010-1234-5678')).toBe('+821012345678');
  });

  it('한국 로컬 포맷(하이픈 없음) → E.164', () => {
    expect(parseE164('01012345678')).toBe('+821012345678');
  });

  it('E.164 한국 번호 passthrough', () => {
    expect(parseE164('+821012345678')).toBe('+821012345678');
  });

  it('E.164 태국 번호 passthrough', () => {
    expect(parseE164('+66812345678')).toBe('+66812345678');
  });

  it('E.164 중국 번호 passthrough', () => {
    expect(parseE164('+8613912345678')).toBe('+8613912345678');
  });

  it('잘못된 번호 → 에러 throw', () => {
    expect(() => parseE164('invalid')).toThrow(
      '올바른 휴대폰 번호를 입력해주세요',
    );
  });

  // Review #8 CN edge cases
  it('[Review #8] 0086 prefix → E.164 +86', () => {
    expect(parseE164('008613912345678')).toBe('+8613912345678');
  });

  it('[Review #8] full-width digit 입력 → ASCII로 변환 후 정상 파싱', () => {
    // U+FF0B = + (full-width), U+FF18 = 8, U+FF16 = 6, ...
    const fullWidthInput = '\uFF0B\uFF18\uFF16\uFF11\uFF13\uFF19\uFF11\uFF12\uFF13\uFF14\uFF15\uFF16\uFF17\uFF18';
    expect(parseE164(fullWidthInput)).toBe('+8613912345678');
  });

  it('[Review #8] 공백 포함 번호 → E.164', () => {
    expect(parseE164('+ 86 139 1234 5678')).toBe('+8613912345678');
  });

  // [WR-05] `00` prefix misparse guard
  it('[WR-05] KR 국제전화 식별번호 00700xxx 같은 비-intl-prefix 00 prefix는 reject', () => {
    // Without the isValid() guard, `00700xxx` was stripped to `+700xxx` and
    // libphonenumber may accept it as an obscure country shape. Reject.
    expect(() => parseE164('007001234567')).toThrow(
      '올바른 휴대폰 번호를 입력해주세요',
    );
  });

  it('[WR-05] 정상 0086 prefix는 여전히 통과 (regression)', () => {
    expect(parseE164('008613912345678')).toBe('+8613912345678');
  });
});

describe('E.164 country detection', () => {
  it.each([
    ['Korea', '+821012345678', 'KR'],
    ['United States', '+14155552671', 'US'],
    ['Thailand', '+66812345678', 'TH'],
    ['Taiwan', '+886912345678', 'TW'],
    ['Hong Kong', '+85251234567', 'HK'],
    ['Vietnam', '+84982291899', 'VN'],
  ])('detects %s', (_label, phone, country) => {
    expect(getE164Country(phone)).toBe(country);
  });
});

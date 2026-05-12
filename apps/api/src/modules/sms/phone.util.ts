import { parsePhoneNumberWithError, ParseError } from 'libphonenumber-js/min';

/**
 * Full-width ASCII 변환 (U+FF0B -> +, U+FF10~U+FF19 -> 0~9)
 * [Review #8] 중국 번호 입력 시 full-width digit 사용 가능성 대응
 */
function normalizeFullWidth(input: string): string {
  return input
    .replace(/\uFF0B/g, '+')
    .replace(/[\uFF10-\uFF19]/g, (ch) =>
      String.fromCharCode(ch.charCodeAt(0) - 0xfee0),
    );
}

/**
 * 전화번호를 E.164 포맷으로 정규화한다.
 * - 한국 로컬 포맷 (010-xxxx-xxxx) fast path
 * - 국제 E.164 포맷 passthrough
 * - 0086 prefix -> +86 변환 [Review #8]
 * - full-width digit -> ASCII 변환 [Review #8]
 * - 공백/하이픈/괄호 제거
 */
export function parseE164(input: string): string {
  // 1. full-width -> ASCII 변환
  const normalized = normalizeFullWidth(input);
  // 2. 공백/하이픈/괄호 제거
  const cleaned = normalized.replace(/[\s\-()]/g, '');
  // 3. 0086 prefix -> +86 변환 [Review #8]
  const withPlus = cleaned.startsWith('00')
    ? `+${cleaned.slice(2)}`
    : cleaned;

  // 4. 한국 로컬 포맷 fast path (010-1234-5678 or 01012345678)
  const digits = withPlus.replace(/[^+\d]/g, '');
  if (/^01[016789]\d{7,8}$/.test(digits)) {
    return `+82${digits.slice(1)}`;
  }

  // 5. E.164 파싱
  // [WR-05] The unconditional `00` -> `+` rewrite above lets inputs like
  // "00700xxx" (KR international dialing prefix 00700 for carrier routing)
  // slip through as "+700xxx", which libphonenumber may accept as another
  // country. Guard against that by requiring the parsed number to be valid
  // (isValid() checks length + national-number format per country).
  try {
    const toParse = digits.startsWith('+') ? digits : `+${digits}`;
    const parsed = parsePhoneNumberWithError(toParse);
    if (!parsed.isValid()) {
      throw new Error('올바른 휴대폰 번호를 입력해주세요');
    }
    return parsed.number;
  } catch (err: unknown) {
    if (err instanceof ParseError) {
      throw new Error('올바른 휴대폰 번호를 입력해주세요');
    }
    throw err;
  }
}

export function getE164Country(e164: string): string | undefined {
  try {
    return parsePhoneNumberWithError(e164).country;
  } catch {
    return undefined;
  }
}

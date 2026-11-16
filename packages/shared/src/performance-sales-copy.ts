// These lines were previously copied into free-form sales information. The
// storefront now renders its own policy for every performance and locale.
export function stripStandardCancellationCopy(text: string | null): string | null {
  if (!text) return text;
  const stripped = text
    .replace(/^[ \t]*-?[ \t]*예매 당일 이후 취소 시 예매수수료는 (?:원칙적으로 )?환불되지 않습니다\.[ \t]*\r?\n?/gm, '')
    .replace(/^[ \t]*\|?[ \t]*취소일[ \t]*\|[ \t]*취소[ \t]*수수료[ \t]*\|?[ \t]*\r?\n(?:[ \t]*\|?[ \t]*(?:예매 당일|예매 후|관람일)[^\r\n|]*\|[^\r\n]*\r?\n?)+/gm, '')
    .replace(/^[ \t]*※ 취소수수료 적용 기준 및 예외 \(한국시간 기준\)[ \t]*\r?\n?/gm, '')
    .replace(/^[ \t]*1\. 예매 당일에는 취소 가능 기한 내에서 취소수수료가 없으며,[^\r\n]*우선 적용됩니다\.[ \t]*\r?\n?/gm, '')
    .replace(/^[ \t]*2\. 일반 취소는 관람일 전날 23:59까지 가능합니다\. 관람 당일에는 예매 당일이라도 일반 취소할 수 없습니다\.[ \t]*\r?\n?/gm, '')
    .replace(/^[ \t]*3\. 유료 추가 구매가 있으면 위 표의 ‘티켓 금액’은[^\r\n]*예매수수료는 계산 기준에서 제외합니다\.[ \t]*\r?\n?/gm, '');
  return stripped === text ? text : stripped.trim() || null;
}

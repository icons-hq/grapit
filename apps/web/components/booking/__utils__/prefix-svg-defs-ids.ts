import { sanitizeParsedSvg } from '@/lib/svg/safety';

const XLINK_NS = 'http://www.w3.org/1999/xlink';

/** Presentation attributes that can reference a `<defs>` element with `url(#id)`. */
const URL_REFERENCE_ATTRIBUTES = [
  'fill',
  'stroke',
  'filter',
  'clip-path',
  'mask',
  'marker-start',
  'marker-mid',
  'marker-end',
  'style',
] as const;

const LOCAL_URL_REFERENCE_PATTERN = /url\(\s*(['"]?)#([^'")\s]+)\1\s*\)/g;

function isParseError(doc: Document): boolean {
  return doc.documentElement.tagName === 'parsererror'
    || doc.querySelector('parsererror') !== null;
}

function rewriteUrlReferences(value: string, idMap: ReadonlyMap<string, string>): string {
  // A replacer function, never a replacement string: `$` patterns in an id must stay text.
  return value.replace(LOCAL_URL_REFERENCE_PATTERN, (match, quote: string, id: string) => {
    const nextId = idMap.get(id);
    return nextId === undefined ? match : `url(${quote}#${nextId}${quote})`;
  });
}

function rewriteHref(el: Element, namespace: string | null, idMap: ReadonlyMap<string, string>) {
  const value = el.getAttributeNS(namespace, 'href');
  if (!value?.startsWith('#')) return;
  const nextId = idMap.get(value.slice(1));
  if (nextId !== undefined) {
    el.setAttributeNS(namespace, namespace === XLINK_NS ? 'xlink:href' : 'href', `#${nextId}`);
  }
}

/**
 * W-2: 같은 페이지의 두 SVG 인스턴스(메인 좌석맵 + MiniMap)가 `<defs>` ID를 공유하지 않도록
 * `<defs>` 안의 ID와 그 참조에 접두사를 붙인다.
 *
 * 모든 치환은 파싱한 DOM의 속성 값에서 한다(audit #49). 직렬화된 문자열에 정규식 치환을 하면
 * 공격자가 정한 ID 안의 `$\``, `$'`, `$&` 같은 치환 패턴이 문서 일부를 속성 값 안으로 복제해,
 * HTML 재파싱 때 따옴표 경계가 무너지고 SVG 밖으로 마크업이 빠져나간다.
 *
 * - 치환 대상: `fill`·`stroke`·`filter`·`clip-path`·`mask`·`marker-*`·`style` 속성의 `url(#id)`,
 *   `href`·`xlink:href`의 `#id`. 텍스트·주석은 건드리지 않는다.
 * - 결과는 `image/svg+xml`로 다시 파싱해 `sanitizeParsedSvg`를 한 번 더 통과시킨 뒤 직렬화한다.
 * - 파싱·정리에 실패하면 원본이 아니라 빈 문자열(빈 MiniMap)을 돌려준다.
 *
 * @param svgString - 메인 좌석맵이 이미 sanitize·직렬화한 SVG 문자열
 * @param prefix - ID 접두사 (예: 'mini-')
 * @returns `<defs>` ID가 없으면 입력 그대로, 있으면 접두사를 붙이고 다시 정리한 SVG 문자열
 */
export function prefixSvgDefsIds(svgString: string, prefix: string): string {
  if (!svgString.includes('<defs')) return svgString;
  try {
    const doc = new DOMParser().parseFromString(svgString, 'image/svg+xml');
    if (isParseError(doc)) return '';

    const idMap = new Map<string, string>();
    doc.querySelectorAll('defs [id]').forEach((el) => {
      const oldId = el.getAttribute('id');
      if (!oldId || idMap.has(oldId)) return;
      idMap.set(oldId, `${prefix}${oldId}`);
    });
    if (idMap.size === 0) return svgString;

    doc.querySelectorAll('defs [id]').forEach((el) => {
      const nextId = idMap.get(el.getAttribute('id') ?? '');
      if (nextId !== undefined) el.setAttribute('id', nextId);
    });
    const elements = [doc.documentElement, ...Array.from(doc.documentElement.querySelectorAll('*'))];
    for (const el of elements) {
      for (const name of URL_REFERENCE_ATTRIBUTES) {
        const value = el.getAttribute(name);
        if (value?.includes('url(')) {
          const next = rewriteUrlReferences(value, idMap);
          if (next !== value) el.setAttribute(name, next);
        }
      }
      rewriteHref(el, null, idMap);
      rewriteHref(el, XLINK_NS, idMap);
    }

    // Defense in depth: what MiniMap injects is exactly what the sanitizer accepted.
    const serialized = new XMLSerializer().serializeToString(doc.documentElement);
    const checked = new DOMParser().parseFromString(serialized, 'image/svg+xml');
    if (isParseError(checked) || !sanitizeParsedSvg(checked)) return '';
    return new XMLSerializer().serializeToString(checked.documentElement);
  } catch {
    return '';
  }
}

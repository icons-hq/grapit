import { describe, it, expect } from 'vitest';

/**
 * reviews revision MED #6 Option B: dynamic import 방식.
 *
 * Wave 0 단계에서 `apps/web/components/booking/__utils__/prefix-svg-defs-ids.ts` 모듈은
 * 아직 존재하지 않는다 (Plan 12-03 Task 1에서 생성). 정적 top-level import를 사용하면
 * TypeScript strict 설정에 따라 Wave 0 typecheck가 실패할 수 있다.
 *
 * 각 it() 안에서 `await import(...)`을 사용하면:
 *   1. typecheck 단계: dynamic import는 런타임 검사이므로 모듈 부재로 실패하지 않음
 *   2. vitest 실행 시: Wave 0에서 모듈 부재 → import 실패 → 케이스 RED (예상 동작)
 *   3. Plan 12-03 Task 1 완료 시: 모듈 존재 → 케이스 GREEN 전환
 */

describe('prefixSvgDefsIds (W-2: SVG <defs> ID 충돌 방지)', () => {
  it('<defs> 없는 SVG는 원본 그대로 반환', async () => {
    // @ts-ignore -- Wave 0 Option B: module authored in Plan 12-03 Task 1 (W-2 helper).
    //   ts-ignore (not ts-expect-error) so 12-03 merge does not retroactively fail typecheck.
    const { prefixSvgDefsIds } = await import('../prefix-svg-defs-ids');
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200"><rect data-seat-id="A-1" x="10" y="10" width="32" height="32"/></svg>';
    const result = prefixSvgDefsIds(svg, 'mini-');
    expect(result).toBe(svg);
  });

  it('<defs> 안 ID 1개 → ID에 prefix 부여 + url(#) 일괄 치환', async () => {
    // @ts-ignore -- Wave 0 Option B: module authored in Plan 12-03 Task 1 (W-2 helper).
    //   ts-ignore (not ts-expect-error) so 12-03 merge does not retroactively fail typecheck.
    const { prefixSvgDefsIds } = await import('../prefix-svg-defs-ids');
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200">' +
      '<defs><linearGradient id="grad1"><stop offset="0%" stop-color="#fff"/></linearGradient></defs>' +
      '<rect x="0" y="0" width="100" height="100" fill="url(#grad1)"/>' +
      '</svg>';
    const result = prefixSvgDefsIds(svg, 'mini-');
    expect(result).toContain('id="mini-grad1"');
    expect(result).toContain('url(#mini-grad1)');
    expect(result).not.toContain('id="grad1"');
    expect(result).not.toContain('url(#grad1)');
  });

  it('<defs> 안 ID 다수 → 모두 치환', async () => {
    // @ts-ignore -- Wave 0 Option B: module authored in Plan 12-03 Task 1 (W-2 helper).
    //   ts-ignore (not ts-expect-error) so 12-03 merge does not retroactively fail typecheck.
    const { prefixSvgDefsIds } = await import('../prefix-svg-defs-ids');
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200">' +
      '<defs>' +
      '<linearGradient id="g1"><stop offset="0%"/></linearGradient>' +
      '<linearGradient id="g2"><stop offset="100%"/></linearGradient>' +
      '<pattern id="pat1"><circle cx="5" cy="5" r="2"/></pattern>' +
      '</defs>' +
      '<rect fill="url(#g1)"/><rect fill="url(#g2)"/><rect fill="url(#pat1)"/>' +
      '</svg>';
    const result = prefixSvgDefsIds(svg, 'mini-');
    expect(result).toContain('id="mini-g1"');
    expect(result).toContain('id="mini-g2"');
    expect(result).toContain('id="mini-pat1"');
    expect(result).toContain('url(#mini-g1)');
    expect(result).toContain('url(#mini-g2)');
    expect(result).toContain('url(#mini-pat1)');
  });

  it('ID에 정규식 메타문자가 포함되어도 escape되어 정상 치환 (gradient.1)', async () => {
    // @ts-ignore -- Wave 0 Option B: module authored in Plan 12-03 Task 1 (W-2 helper).
    //   ts-ignore (not ts-expect-error) so 12-03 merge does not retroactively fail typecheck.
    const { prefixSvgDefsIds } = await import('../prefix-svg-defs-ids');
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200">' +
      '<defs><linearGradient id="gradient.1"><stop offset="0%"/></linearGradient></defs>' +
      '<rect fill="url(#gradient.1)"/>' +
      '</svg>';
    const result = prefixSvgDefsIds(svg, 'mini-');
    expect(result).toContain('id="mini-gradient.1"');
    expect(result).toContain('url(#mini-gradient.1)');
  });

  it('parse 실패 (잘못된 XML)면 원본 대신 빈 MiniMap을 쓴다', async () => {
    // @ts-ignore -- Wave 0 Option B: module authored in Plan 12-03 Task 1 (W-2 helper).
    //   ts-ignore (not ts-expect-error) so 12-03 merge does not retroactively fail typecheck.
    const { prefixSvgDefsIds } = await import('../prefix-svg-defs-ids');
    const malformed = '<svg><defs><linearGradient id="g1"';
    const result = prefixSvgDefsIds(malformed, 'mini-');
    expect(result).toBe('');
  });
});

const SVG_NS = 'http://www.w3.org/2000/svg';

/** MiniMap 경로와 같다: prefix 결과를 HTML parser(innerHTML)로 넣는다. */
function injectLikeMiniMap(markup: string) {
  const host = document.createElement('div');
  host.innerHTML = markup;
  return host;
}

describe('prefixSvgDefsIds DOM-only rewrite (audit #49 MiniMap)', () => {
  it.each(['g$`', "g$'", 'g$&'])(
    'keeps the markup inside SVG when a defs id contains the replacement pattern %s',
    async (id) => {
      const { prefixSvgDefsIds } = await import('../prefix-svg-defs-ids');
      // The main seat map serializes this already; quotes in text nodes stay raw in XML.
      const doc = new DOMParser().parseFromString(
        `<svg xmlns="${SVG_NS}"><defs><linearGradient/></defs><rect/><text/></svg>`,
        'image/svg+xml',
      );
      doc.querySelector('linearGradient')!.setAttribute('id', id);
      doc.querySelector('rect')!.setAttribute('fill', `url(#${id})`);
      doc.querySelector('rect')!.setAttribute('data-seat-id', 'A-1');
      doc.querySelector('text')!.textContent = 'x" data-a="1" y="';
      const mainMapHtml = doc.documentElement.outerHTML;

      const host = injectLikeMiniMap(prefixSvgDefsIds(mainMapHtml, 'mini-'));
      const elements = Array.from(host.querySelectorAll('*'));

      expect(elements.filter((el) => el.namespaceURI !== SVG_NS)).toEqual([]);
      expect(elements.flatMap((el) => Array.from(el.attributes)
        .filter((attr) => attr.name.toLowerCase().startsWith('on')))).toEqual([]);
      expect(host.querySelectorAll('svg')).toHaveLength(1);
      expect(host.querySelectorAll('[data-seat-id="A-1"]')).toHaveLength(1);
      expect(host.querySelector('text')?.textContent).toBe('x" data-a="1" y="');
    },
  );

  it('rewrites href references and style url(#id) on the DOM, not text or comments', async () => {
    const { prefixSvgDefsIds } = await import('../prefix-svg-defs-ids');
    const svg =
      `<svg xmlns="${SVG_NS}" viewBox="0 0 10 10">` +
      '<defs><clipPath id="c"><rect/></clipPath><marker id="m"/></defs>' +
      '<path clip-path="url(&quot;#c&quot;)" marker-end="url(#m)"/>' +
      '<text>url(#c)</text>' +
      '</svg>';

    const result = prefixSvgDefsIds(svg, 'mini-');
    const doc = new DOMParser().parseFromString(result, 'image/svg+xml');

    expect(doc.querySelector('clipPath')?.getAttribute('id')).toBe('mini-c');
    expect(doc.querySelector('marker')?.getAttribute('id')).toBe('mini-m');
    expect(doc.querySelector('path')?.getAttribute('clip-path')).toBe('url("#mini-c")');
    expect(doc.querySelector('path')?.getAttribute('marker-end')).toBe('url(#mini-m)');
    expect(doc.querySelector('text')?.textContent).toBe('url(#c)');
  });

  it('runs the result through the SVG sanitizer again', async () => {
    const { prefixSvgDefsIds } = await import('../prefix-svg-defs-ids');
    const svg =
      `<svg xmlns="${SVG_NS}"><defs><linearGradient id="g"/></defs>` +
      '<rect fill="url(#g)" onclick="alert(1)"/><foreignObject/></svg>';

    const result = prefixSvgDefsIds(svg, 'mini-');

    expect(result).toContain('url(#mini-g)');
    expect(result).not.toMatch(/onclick|foreignObject/i);
  });
});

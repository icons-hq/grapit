import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { hasUnsafeSvgPayload, sanitizeParsedSvg } from './safety';

const SVG_NS = 'http://www.w3.org/2000/svg';

function parseSvg(markup: string) {
  return new DOMParser().parseFromString(markup, 'image/svg+xml');
}

/**
 * 좌석맵 viewer·관리자 tier editor와 같은 경로:
 * XML 파싱 → sanitize → outerHTML(XML 직렬화) → innerHTML(HTML 재파싱).
 */
function renderLikeSeatMap(markup: string) {
  const doc = parseSvg(markup);
  const usable = sanitizeParsedSvg(doc);
  const html = doc.documentElement.outerHTML;
  const host = document.createElement('div');
  host.innerHTML = html;
  return { usable, html, host };
}

function htmlNamespaceElements(host: Element) {
  return Array.from(host.querySelectorAll('*')).filter(
    (element) => element.namespaceURI !== SVG_NS,
  );
}

function readSeedSvg(name: string) {
  return readFileSync(resolve(__dirname, '../../public/seed', name), 'utf8');
}

describe('sanitizeParsedSvg (audit #49 mXSS)', () => {
  it.each([
    [
      'abrupt comment close',
      '<svg xmlns="http://www.w3.org/2000/svg"><!--> <img src=x onerror=alert(1)> --><rect data-seat-id="A-1"/></svg>',
    ],
    [
      'empty comment dash close',
      '<svg xmlns="http://www.w3.org/2000/svg"><!--->  <img src=x onerror=alert(1)> --><rect data-seat-id="A-1"/></svg>',
    ],
    [
      'processing instruction',
      '<svg xmlns="http://www.w3.org/2000/svg"><?x > <img src=x onerror=alert(1)>?><rect data-seat-id="A-1"/></svg>',
    ],
    [
      'cdata in text',
      '<svg xmlns="http://www.w3.org/2000/svg"><text><![CDATA[ > <img src=x onerror=alert(1)> ]]></text><rect data-seat-id="A-1"/></svg>',
    ],
    [
      'html breakout tags',
      '<svg xmlns="http://www.w3.org/2000/svg"><img/><p/><meta http-equiv="refresh" content="0;url=https://evil.example"/><rect data-seat-id="A-1"/></svg>',
    ],
    [
      'breakout tag in another default namespace',
      '<svg xmlns="http://www.w3.org/2000/svg"><img xmlns="urn:evil" srcset="https://evil.example/x.png"/><rect data-seat-id="A-1"/></svg>',
    ],
    [
      'html integration point children',
      '<svg xmlns="http://www.w3.org/2000/svg"><title><a>link</a><svg><rect/></svg>seat map</title><rect data-seat-id="A-1"/></svg>',
    ],
  ])('%s payload does not become an HTML element after re-parsing', (_name, markup) => {
    const { usable, html, host } = renderLikeSeatMap(markup);

    expect(usable).toBe(true);
    expect(html).not.toMatch(/<!--|<\?|<!\[CDATA\[/);
    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('meta')).toBeNull();
    expect(host.querySelector('[onerror]')).toBeNull();
    expect(htmlNamespaceElements(host)).toEqual([]);
    expect(host.querySelector('[data-seat-id="A-1"]')?.namespaceURI).toBe(SVG_NS);
  });

  it('keeps CDATA text as escaped text and title/desc as text only', () => {
    const { host } = renderLikeSeatMap(
      '<svg xmlns="http://www.w3.org/2000/svg"><title>좌석 <a>배치도</a></title><text><![CDATA[A < B]]></text></svg>',
    );

    expect(host.querySelector('title')?.textContent).toBe('좌석 ');
    expect(host.querySelector('title')?.children).toHaveLength(0);
    expect(host.querySelector('text')?.textContent).toBe('A < B');
  });

  it('removes SMIL animation, script-capable elements and URL-bearing attributes', () => {
    const { host } = renderLikeSeatMap(`
      <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" onload="alert(1)">
        <a href="https://evil.example" xlink:href="javascript:alert(1)">
          <set attributeName="href" to="java&#9;script:alert(1)"/>
          <animate attributeName="href" values="javascript:alert(1)"/>
          <rect data-seat-id="A-1" onclick="alert(1)" fill="url(https://evil.example/p.svg#x)" />
        </a>
        <image href="https://evil.example/x.png"/>
        <foreignObject><div xmlns="http://www.w3.org/1999/xhtml">x</div></foreignObject>
        <script>alert(1)</script>
        <style>#outside-seat-map{display:none!important}</style>
        <use href="#seat"/>
        <rect data-seat-id="A-2" style="fill:u\\rl(https://evil.example)" cursor="url(https://evil.example/c.cur), pointer"/>
      </svg>
    `);

    for (const selector of ['set', 'animate', 'image', 'foreignObject', 'script', 'style']) {
      expect(host.querySelector(selector)).toBeNull();
    }
    expect(host.querySelector('a')).not.toBeNull();
    expect(host.innerHTML).not.toMatch(/javascript:|evil\.example|onload|onclick|href=/i);
    const seatA2 = host.querySelector('[data-seat-id="A-2"]');
    expect(seatA2?.hasAttribute('style')).toBe(false);
    expect(seatA2?.hasAttribute('cursor')).toBe(false);
  });

  it('keeps seat-map attributes, local paint references and data attributes', () => {
    const doc = parseSvg(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" data-stage="top" role="img" aria-labelledby="t">
        <title id="t">seat map</title>
        <defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient></defs>
        <g class="seat-cell vip" transform="translate(1 2)">
          <rect data-seat-id='A-"1\\vip' data-seat-key="1F:A-1" data-tier-name="VIP" data-category="EXCLUDED"
            x="1" y="2" width="10" height="8" rx="2" fill="url(#g)" fill-opacity="0.16" stroke="#CBD5E1" stroke-width="0.7"/>
          <text class="seat-number" x="6" y="7" text-anchor="middle" font-family="sans-serif" font-size="5">1</text>
        </g>
      </svg>
    `);

    expect(sanitizeParsedSvg(doc)).toBe(true);
    const rect = doc.querySelector('rect')!;
    expect(rect.getAttribute('data-seat-id')).toBe('A-"1\\vip');
    expect(rect.getAttribute('data-seat-key')).toBe('1F:A-1');
    expect(rect.getAttribute('data-tier-name')).toBe('VIP');
    expect(rect.getAttribute('data-category')).toBe('EXCLUDED');
    expect(rect.getAttribute('fill')).toBe('url(#g)');
    expect(rect.getAttribute('fill-opacity')).toBe('0.16');
    expect(doc.documentElement.getAttribute('data-stage')).toBe('top');
    expect(doc.documentElement.getAttribute('viewBox')).toBe('0 0 100 100');
    expect(doc.documentElement.getAttribute('aria-labelledby')).toBe('t');
    expect(doc.querySelector('g')?.getAttribute('class')).toBe('seat-cell vip');
    expect(doc.querySelector('text')?.getAttribute('font-size')).toBe('5');
    expect(doc.querySelector('linearGradient stop')?.getAttribute('stop-color')).toBe('#fff');
  });

  it('removes id/class names and url(#...) references outside the safe name rule', () => {
    const doc = parseSvg(`
      <svg xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="ok_1.a:b-c"/>
          <linearGradient id="g$'"/>
          <linearGradient id="has space"/>
          <linearGradient id="1starts-with-digit"/>
          <linearGradient id="${'a'.repeat(129)}"/>
        </defs>
        <rect data-seat-id="A-1" class="seat-cell vip" fill="url(#ok_1.a:b-c)" stroke="url('#ok_1.a:b-c')"/>
        <rect data-seat-id="A-2" class="seat $x" fill="url(#g$')" stroke="url(#has space)"/>
      </svg>
    `);

    expect(sanitizeParsedSvg(doc)).toBe(true);
    expect(Array.from(doc.querySelectorAll('linearGradient')).map((el) => el.getAttribute('id')))
      .toEqual(['ok_1.a:b-c', null, null, null, null]);
    const [kept, dropped] = Array.from(doc.querySelectorAll('rect'));
    expect(kept!.getAttribute('class')).toBe('seat-cell vip');
    expect(kept!.getAttribute('fill')).toBe('url(#ok_1.a:b-c)');
    expect(kept!.getAttribute('stroke')).toBe("url('#ok_1.a:b-c')");
    expect(dropped!.hasAttribute('class')).toBe(false);
    expect(dropped!.hasAttribute('fill')).toBe(false);
    expect(dropped!.hasAttribute('stroke')).toBe(false);
    expect(dropped!.getAttribute('data-seat-id')).toBe('A-2');
  });

  it('removes image functions with string arguments from presentation attributes', () => {
    const doc = parseSvg(`
      <svg xmlns="http://www.w3.org/2000/svg">
        <rect data-seat-id="A-1" cursor="image-set('https://tracker.example/c.png' 1x), pointer"
          mask="image('https://tracker.example/m.png')" fill="cross-fade('https://tracker.example/a.png', red)"
          filter="url(#f)" stroke="#111"/>
      </svg>
    `);

    expect(sanitizeParsedSvg(doc)).toBe(true);
    const rect = doc.querySelector('rect')!;
    expect(rect.hasAttribute('cursor')).toBe(false);
    expect(rect.hasAttribute('mask')).toBe(false);
    expect(rect.hasAttribute('fill')).toBe(false);
    expect(rect.getAttribute('filter')).toBe('url(#f)');
    expect(rect.getAttribute('stroke')).toBe('#111');
  });

  // 'İ'(U+0130)는 toLowerCase()에서 2 code unit이 된다. 소문자 문자열의 index로 원문을 자르면
  // 26개 패딩만큼 검사 창이 URL 인자 안쪽 `#a)`로 밀려 외부 url()이 지역 참조처럼 통과했다.
  const DOTTED_I_PADDING = 'İ'.repeat(26);
  const PADDED_EXTERNAL_CURSOR = `/*${DOTTED_I_PADDING}*/url(https://evil.example/c.png#a), auto`;

  it.each(['cursor', 'mask', 'fill'])(
    'removes %s whose external url() hides behind length-changing lowercase padding',
    (attribute) => {
      const doc = parseSvg(`
        <svg xmlns="http://www.w3.org/2000/svg">
          <defs><linearGradient id="grad"/></defs>
          <rect data-seat-id="A-1" ${attribute}="${PADDED_EXTERNAL_CURSOR}" stroke="url(#grad)"/>
        </svg>
      `);

      expect(sanitizeParsedSvg(doc)).toBe(true);
      const rect = doc.querySelector('rect')!;
      expect(rect.hasAttribute(attribute)).toBe(false);
      expect(rect.getAttribute('stroke')).toBe('url(#grad)');
      expect(doc.documentElement.outerHTML).not.toMatch(/evil\.example/);
    },
  );

  it('scans url() on the original value even without a CSS comment around the padding', () => {
    const doc = parseSvg(`
      <svg xmlns="http://www.w3.org/2000/svg">
        <rect data-seat-id="A-1" cursor="'${DOTTED_I_PADDING}' url(https://evil.example/c.png#a), auto"
          fill="url(#grad)" mask="URL( '#grad' )"/>
      </svg>
    `);

    expect(sanitizeParsedSvg(doc)).toBe(true);
    const rect = doc.querySelector('rect')!;
    expect(rect.hasAttribute('cursor')).toBe(false);
    expect(rect.getAttribute('fill')).toBe('url(#grad)');
    expect(rect.getAttribute('mask')).toBe("URL( '#grad' )");
  });

  it('removes CSS comments from presentation attributes', () => {
    const doc = parseSvg(`
      <svg xmlns="http://www.w3.org/2000/svg">
        <rect data-seat-id="A-1" fill="/* tint */ url(#grad)" stroke="#111"/>
      </svg>
    `);

    expect(sanitizeParsedSvg(doc)).toBe(true);
    const rect = doc.querySelector('rect')!;
    expect(rect.hasAttribute('fill')).toBe(false);
    expect(rect.getAttribute('stroke')).toBe('#111');
  });

  it('neutralizes documents whose root is not an SVG <svg> element', () => {
    const doc = parseSvg(
      '<html xmlns="http://www.w3.org/1999/xhtml"><body><img src="x" onerror="alert(1)"/></body></html>',
    );

    expect(sanitizeParsedSvg(doc)).toBe(false);
    expect(doc.documentElement.childNodes).toHaveLength(0);
    expect(doc.documentElement.attributes).toHaveLength(0);
  });

  it('preserves every seat and seat attribute of the seeded seat maps', () => {
    for (const name of ['sample-seat-map.svg', 'donghae-girl-rules-20260718-seat-map.svg']) {
      const raw = readSeedSvg(name);
      const original = parseSvg(raw);
      const sanitized = parseSvg(raw);

      expect(sanitizeParsedSvg(sanitized)).toBe(true);

      const originalSeats = Array.from(original.querySelectorAll('[data-seat-id]'));
      const sanitizedSeats = Array.from(sanitized.querySelectorAll('[data-seat-id]'));
      expect(sanitizedSeats.length).toBe(originalSeats.length);
      expect(sanitizedSeats.length).toBeGreaterThan(0);
      sanitizedSeats.forEach((seat, index) => {
        const before = originalSeats[index]!;
        for (const attr of Array.from(before.attributes)) {
          expect(seat.getAttribute(attr.name)).toBe(attr.value);
        }
      });
      expect(sanitized.querySelectorAll('text').length).toBe(original.querySelectorAll('text').length);
    }
  });
});

describe('hasUnsafeSvgPayload (upload check)', () => {
  it.each([
    ['<svg xmlns="http://www.w3.org/2000/svg"><!--> <img src=x onerror=alert(1)> --></svg>'],
    ['<svg xmlns="http://www.w3.org/2000/svg"><?x > <img src=x onerror=alert(1)>?></svg>'],
    ['<!--> <img src=x onerror=alert(1)> --><svg xmlns="http://www.w3.org/2000/svg"/>'],
    ['<svg xmlns="http://www.w3.org/2000/svg"><text><![CDATA[ > <img src=x> ]]></text></svg>'],
    ['<svg xmlns="http://www.w3.org/2000/svg"><img/></svg>'],
    ['<svg xmlns="http://www.w3.org/2000/svg"><p xmlns="urn:evil"/></svg>'],
    ['<svg xmlns="http://www.w3.org/2000/svg"><a><set attributeName="href" to="java&#9;script:alert(1)"/></a></svg>'],
    ['<svg xmlns="http://www.w3.org/2000/svg"><rect fill="url(https://evil.example/p.svg#x)"/></svg>'],
    ['<svg xmlns="http://www.w3.org/2000/svg"><rect style="fill:u\\rl(https://evil.example)"/></svg>'],
    ['<svg xmlns="http://www.w3.org/2000/svg"><rect data-x="java&#10;script:alert(1)"/></svg>'],
    ['<svg xmlns="http://www.w3.org/2000/svg"><rect cursor="image-set(\'https://evil.example/c.png\' 1x), auto"/></svg>'],
    ['<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"><g inkscape:onload="alert(1)"/></svg>'],
    ['<svg xmlns="http://www.w3.org/2000/svg" xmlns:x="urn:x"><g x:label="javascript:alert(1)"/></svg>'],
    ['<html xmlns="http://www.w3.org/1999/xhtml"><body/></html>'],
    ...['cursor', 'mask', 'fill'].map((attribute) => [
      `<svg xmlns="http://www.w3.org/2000/svg"><rect ${attribute}="/*${'İ'.repeat(26)}*/url(https://evil.example/c.png#a), auto"/></svg>`,
    ]),
  ])('rejects %s', (markup) => {
    expect(hasUnsafeSvgPayload(parseSvg(markup))).toBe(true);
  });

  it('accepts design-tool exports with harmless comments, metadata and namespaced attributes', () => {
    const doc = parseSvg(`<?xml version="1.0" encoding="UTF-8"?>
<!-- Generator: Adobe Illustrator 27.0.0, SVG Export Plug-In . SVG Version: 6.00 Build 0) -->
<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"
  xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" viewBox="0 0 100 100" xml:space="preserve">
  <metadata><rdf:RDF><rdf:Bag><rdf:li>seat</rdf:li></rdf:Bag></rdf:RDF></metadata>
  <!-- Stage -->
  <g inkscape:label="seats"><rect data-seat-id="A-1" x="1" y="1" width="5" height="5" fill="url(#g)"/></g>
  <text>STAGE</text>
</svg>`);

    expect(hasUnsafeSvgPayload(doc)).toBe(false);
  });

  it('accepts an Inkscape export whose namespaced attributes carry Windows paths', () => {
    const doc = parseSvg(`<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
  xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"
  xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd"
  viewBox="0 0 100 100" sodipodi:docname="seat-map.svg"
  inkscape:export-filename="C:\\Users\\designer\\Desktop\\seat map.png" inkscape:export-xdpi="96">
  <sodipodi:namedview id="namedview1" inkscape:current-layer="layer1"/>
  <g id="layer1" inkscape:label="Seats" inkscape:groupmode="layer">
    <rect id="Frame 1" data-seat-id="A-1" x="1" y="1" width="5" height="5"/>
  </g>
</svg>`);

    expect(hasUnsafeSvgPayload(doc)).toBe(false);
    // The renderer drops what the upload check let through.
    expect(sanitizeParsedSvg(doc)).toBe(true);
    expect(doc.documentElement.getAttributeNS('http://www.inkscape.org/namespaces/inkscape', 'export-filename')).toBeNull();
    expect(doc.querySelector('[data-seat-id="A-1"]')?.hasAttribute('id')).toBe(false);
  });

  it('accepts the seeded sample seat map', () => {
    expect(hasUnsafeSvgPayload(parseSvg(readSeedSvg('sample-seat-map.svg')))).toBe(false);
  });
});

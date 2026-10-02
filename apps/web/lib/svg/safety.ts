/**
 * 좌석맵 SVG 안전 처리.
 *
 * 좌석맵 SVG는 `DOMParser(image/svg+xml)`로 XML 파싱한 뒤 `outerHTML`(XML 직렬화)로 문자열을 만들고,
 * `dangerouslySetInnerHTML`로 HTML parser에 다시 넣는다. XML과 HTML parser는 같은 문자열을 다르게
 * 해석하므로(mXSS) blocklist로 위험 요소만 지우는 방식은 안전하지 않다. 예:
 * - `<!--> <img onerror> -->`: XML에서는 주석이지만 HTML에서는 `<!-->`에서 주석이 끝나 `<img>`가 살아난다.
 * - `<?x > <img onerror>?>`: HTML은 `<?`를 bogus comment로 보고 첫 `>`에서 끝낸다.
 * - `<img/>`, `<p/>` 같은 HTML breakout 태그: SVG foreign content를 빠져나가 이후 형제가 HTML 요소가 된다.
 * - `<title>`/`<desc>`: HTML integration point라 자식 요소가 HTML로 파싱된다.
 *
 * 그래서 렌더링 경로(`sanitizeParsedSvg`)는 allowlist로 정리한다.
 * - 루트는 SVG namespace의 `<svg>`여야 한다.
 * - Comment·Processing Instruction은 제거하고 CDATA는 텍스트 노드로 바꾼다(직렬화 때 escape된다).
 * - SVG namespace의 허용 요소만 남기고, `title`/`desc`에는 텍스트만 남긴다.
 * - 허용 속성만 남기고 URL을 싣는 속성, 이벤트 핸들러, 외부 `url(...)` 참조, CSS escape를 제거한다.
 *
 * 업로드 검사(`hasUnsafeSvgPayload`)는 보안상 위험한 내용만 거부한다. 디자인 툴이 넣는 메타데이터
 * (`<metadata>`, `inkscape:*` 속성, 생성기 주석 등)는 업로드를 막지 않고 렌더링 때 조용히 제거된다.
 * presigned PUT이나 외부 svgUrl로 업로드 검사를 우회해도 렌더링 sanitizer가 마지막 경계다.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
const XHTML_NS = 'http://www.w3.org/1999/xhtml';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';
const XMLNS_NS = 'http://www.w3.org/2000/xmlns/';

// Node.nodeType 값. 테스트·다른 realm의 Document에서도 동작하도록 전역 Node 상수에 의존하지 않는다.
const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const CDATA_SECTION_NODE = 4;
const PROCESSING_INSTRUCTION_NODE = 7;
const COMMENT_NODE = 8;

/** 렌더링에 남길 SVG 요소(localName 소문자). 애니메이션·외부 리소스·foreignObject·style·script는 없다. */
const ALLOWED_SVG_ELEMENTS = new Set([
  'svg',
  'g',
  'defs',
  'symbol',
  'use',
  'switch',
  'a',
  'title',
  'desc',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'path',
  'text',
  'tspan',
  'textpath',
  'lineargradient',
  'radialgradient',
  'stop',
  'pattern',
  'clippath',
  'mask',
  'marker',
  'filter',
  'feblend',
  'fecolormatrix',
  'fecomponenttransfer',
  'fecomposite',
  'feconvolvematrix',
  'fediffuselighting',
  'fedisplacementmap',
  'fedistantlight',
  'fedropshadow',
  'feflood',
  'fefunca',
  'fefuncb',
  'fefuncg',
  'fefuncr',
  'fegaussianblur',
  'femerge',
  'femergenode',
  'femorphology',
  'feoffset',
  'fepointlight',
  'fespecularlighting',
  'fespotlight',
  'fetile',
  'feturbulence',
]);

/** HTML integration point. 자식 요소가 HTML로 다시 파싱되므로 텍스트만 남긴다. */
const TEXT_ONLY_SVG_ELEMENTS = new Set(['title', 'desc']);

/** 렌더링에 남길 속성(이름 소문자). `data-*`, `aria-*`는 별도로 허용한다. */
const ALLOWED_SVG_ATTRIBUTES = new Set([
  // core·접근성
  'id',
  'class',
  'style',
  'lang',
  'role',
  'tabindex',
  'focusable',
  'version',
  'baseprofile',
  // 좌표·도형
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'fx',
  'fy',
  'fr',
  'width',
  'height',
  'd',
  'points',
  'pathlength',
  'transform',
  'transform-origin',
  'transform-box',
  'viewbox',
  'preserveaspectratio',
  // 칠·외곽선·표시
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-dasharray',
  'stroke-dashoffset',
  'paint-order',
  'vector-effect',
  'opacity',
  'visibility',
  'display',
  'overflow',
  'color',
  'color-interpolation',
  'color-interpolation-filters',
  'color-rendering',
  'shape-rendering',
  'text-rendering',
  'image-rendering',
  'mix-blend-mode',
  'isolation',
  'pointer-events',
  'cursor',
  'enable-background',
  'clip',
  'clip-path',
  'clip-rule',
  'clippathunits',
  'mask',
  'maskunits',
  'maskcontentunits',
  'filter',
  'filterunits',
  'primitiveunits',
  'marker-start',
  'marker-mid',
  'marker-end',
  'markerwidth',
  'markerheight',
  'markerunits',
  'refx',
  'refy',
  'orient',
  // 텍스트
  'font-family',
  'font-size',
  'font-size-adjust',
  'font-stretch',
  'font-style',
  'font-variant',
  'font-weight',
  'letter-spacing',
  'word-spacing',
  'text-anchor',
  'text-decoration',
  'dominant-baseline',
  'alignment-baseline',
  'baseline-shift',
  'writing-mode',
  'direction',
  'unicode-bidi',
  'dx',
  'dy',
  'rotate',
  'textlength',
  'lengthadjust',
  'startoffset',
  'method',
  'spacing',
  'side',
  // gradient·pattern
  'gradientunits',
  'gradienttransform',
  'spreadmethod',
  'offset',
  'stop-color',
  'stop-opacity',
  'patternunits',
  'patterncontentunits',
  'patterntransform',
  // filter primitive
  'in',
  'in2',
  'result',
  'stddeviation',
  'mode',
  'operator',
  'k1',
  'k2',
  'k3',
  'k4',
  'type',
  'values',
  'tablevalues',
  'slope',
  'intercept',
  'amplitude',
  'exponent',
  'flood-color',
  'flood-opacity',
  'lighting-color',
  'surfacescale',
  'specularconstant',
  'specularexponent',
  'diffuseconstant',
  'kernelunitlength',
  'kernelmatrix',
  'divisor',
  'bias',
  'targetx',
  'targety',
  'edgemode',
  'preservealpha',
  'order',
  'radius',
  'scale',
  'xchannelselector',
  'ychannelselector',
  'basefrequency',
  'numoctaves',
  'seed',
  'stitchtiles',
  'azimuth',
  'elevation',
  'z',
  'pointsatx',
  'pointsaty',
  'pointsatz',
  'limitingconeangle',
  // conditional processing (switch)
  'systemlanguage',
  'requiredfeatures',
  'requiredextensions',
]);

/** 실행·외부 문서 삽입·런타임 속성 변경(SMIL)이 가능한 요소. 업로드에서 거부한다. */
const BLOCKED_SVG_TAG_NAMES = new Set([
  'script',
  'style',
  'foreignobject',
  'iframe',
  'object',
  'embed',
  'audio',
  'video',
  'canvas',
  // SMIL은 `<set attributeName="href" to="java&#9;script:...">`처럼 렌더링 뒤에 속성을 바꾼다.
  'animate',
  'animatecolor',
  'animatemotion',
  'animatetransform',
  'set',
  'discard',
]);

/**
 * HTML parser가 SVG foreign content 안에서 만나면 foreign content를 빠져나가는 태그
 * (HTML Standard "parsing main inforeign"). 이 이름의 요소가 접두사 없이 직렬화되면 HTML 요소가 된다.
 */
const HTML_BREAKOUT_TAG_NAMES = new Set([
  'b',
  'big',
  'blockquote',
  'body',
  'br',
  'center',
  'code',
  'dd',
  'div',
  'dl',
  'dt',
  'em',
  'embed',
  'font',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'head',
  'hr',
  'i',
  'img',
  'li',
  'listing',
  'menu',
  'meta',
  'nobr',
  'ol',
  'p',
  'pre',
  'ruby',
  's',
  'small',
  'span',
  'strong',
  'strike',
  'sub',
  'sup',
  'table',
  'tt',
  'u',
  'ul',
  'var',
]);

/** URL을 싣거나 문서를 삽입하는 속성(localName 기준이라 `xlink:href`도 포함). */
const URL_ATTRIBUTE_NAMES = new Set([
  'href',
  'src',
  'srcset',
  'srcdoc',
  'action',
  'formaction',
  'poster',
  'background',
  'ping',
]);

/** 값에 백슬래시가 있어도 CSS로 해석되지 않는 속성. */
const NON_CSS_ATTRIBUTE_NAMES = new Set(['id', 'class', 'lang', 'role']);

const SCRIPTABLE_URL_SCHEMES = ['javascript:', 'vbscript:'];

// style 속성에서 외부 리소스를 불러오거나 escape로 검사를 우회할 수 있는 CSS 구문.
const UNSAFE_STYLE_PATTERN =
  /url\s*\(|image-set\s*\(|image\s*\(|cross-fade\s*\(|element\s*\(|src\s*\(|expression\s*\(|@import|behavior\s*:|binding\s*:|\\/i;

// 주석·PI·CDATA 안의 `<`·`>`는 HTML 재파싱에서 마크업으로 되살아날 수 있다.
const MARKUP_LIKE_PATTERN = /[<>]/;

function lowerLocalName(node: Element | Attr) {
  return node.localName.toLowerCase();
}

function isSvgRootElement(el: Element | null): el is Element {
  return Boolean(el) && el!.namespaceURI === SVG_NS && lowerLocalName(el!) === 'svg';
}

function isAllowedSvgElement(el: Element) {
  return el.namespaceURI === SVG_NS && ALLOWED_SVG_ELEMENTS.has(lowerLocalName(el));
}

function isDangerousSvgElement(el: Element) {
  const name = lowerLocalName(el);
  if (BLOCKED_SVG_TAG_NAMES.has(name)) return true;
  if (el.namespaceURI === XHTML_NS) return true;
  // 접두사 없이 직렬화되는 breakout 이름은 namespace와 관계없이 HTML 요소로 되살아난다.
  return HTML_BREAKOUT_TAG_NAMES.has(name) && !el.prefix;
}

function containsScriptableUrl(value: string) {
  // URL parser는 tab·개행·제어문자를 제거하므로 `java&#9;script:`도 javascript: URL이 된다.
  const normalized = value.replace(/[\u0000- \u007f-\u009f]+/g, '').toLowerCase();
  return SCRIPTABLE_URL_SCHEMES.some((scheme) => normalized.includes(scheme));
}

function hasNonLocalUrlReference(value: string) {
  const lower = value.toLowerCase();
  let index = lower.indexOf('url(');
  while (index !== -1) {
    const target = lower.slice(index + 4).replace(/^[\s'"]+/, '');
    if (!target.startsWith('#')) return true;
    index = lower.indexOf('url(', index + 4);
  }
  return false;
}

function isUnsafeSvgAttribute(attr: Attr) {
  const name = lowerLocalName(attr);
  const value = attr.value;

  if (name.startsWith('on')) return true;
  if (URL_ATTRIBUTE_NAMES.has(name)) return true;
  if (containsScriptableUrl(value)) return true;
  if (name === 'style') return UNSAFE_STYLE_PATTERN.test(value);

  const isInertDataAttribute =
    !attr.namespaceURI &&
    (name.startsWith('data-') || name.startsWith('aria-') || NON_CSS_ATTRIBUTE_NAMES.has(name));
  if (isInertDataAttribute) return false;

  // 표현 속성은 CSS 값으로 파싱된다. 외부 url() 참조와 CSS escape(`u\rl(`)를 막는다.
  return hasNonLocalUrlReference(value) || value.includes('\\');
}

function isAllowedSvgAttribute(attr: Attr) {
  if (attr.namespaceURI === XMLNS_NS) return true;
  if (attr.namespaceURI === XML_NS) {
    return attr.localName === 'space' || attr.localName === 'lang';
  }
  if (attr.namespaceURI) return false;

  const name = lowerLocalName(attr);
  return (
    name.startsWith('data-') ||
    name.startsWith('aria-') ||
    ALLOWED_SVG_ATTRIBUTES.has(name)
  );
}

function sanitizeAttributes(el: Element) {
  for (const attr of Array.from(el.attributes)) {
    if (!isAllowedSvgAttribute(attr) || isUnsafeSvgAttribute(attr)) {
      el.removeAttributeNode(attr);
    }
  }
}

function neutralizeElement(el: Element) {
  while (el.firstChild) {
    el.removeChild(el.firstChild);
  }
  for (const attr of Array.from(el.attributes)) {
    el.removeAttributeNode(attr);
  }
}

/**
 * 파싱된 SVG 문서를 렌더링 가능한 안전한 형태로 제자리에서 정리한다.
 *
 * @returns 루트가 SVG `<svg>`이면 true. 아니면 루트를 비워 무력화하고 false를 돌려준다
 *   (호출부는 false일 때 렌더링하지 않는다).
 */
export function sanitizeParsedSvg(doc: Document): boolean {
  const root = doc.documentElement;
  if (!root) return false;
  if (!isSvgRootElement(root)) {
    neutralizeElement(root);
    return false;
  }

  // 재귀 대신 명시적 stack을 써서 깊게 중첩된 입력에서도 call stack이 넘치지 않게 한다.
  const stack: Element[] = [root];
  while (stack.length > 0) {
    const el = stack.pop()!;
    sanitizeAttributes(el);
    const textOnly = TEXT_ONLY_SVG_ELEMENTS.has(lowerLocalName(el));

    for (const child of Array.from(el.childNodes)) {
      switch (child.nodeType) {
        case TEXT_NODE:
          break;
        case CDATA_SECTION_NODE:
          el.replaceChild(doc.createTextNode((child as CharacterData).data), child);
          break;
        case ELEMENT_NODE:
          if (!textOnly && isAllowedSvgElement(child as Element)) {
            stack.push(child as Element);
          } else {
            el.removeChild(child);
          }
          break;
        default:
          // Comment, Processing Instruction 등 렌더링에 필요 없는 노드는 모두 제거한다.
          el.removeChild(child);
      }
    }
  }

  return true;
}

function hasMarkupLikeNodeData(node: Node) {
  if (node.nodeType === PROCESSING_INSTRUCTION_NODE) {
    const pi = node as ProcessingInstruction;
    return MARKUP_LIKE_PATTERN.test(`${pi.target} ${pi.data}`);
  }
  if (node.nodeType === COMMENT_NODE || node.nodeType === CDATA_SECTION_NODE) {
    return MARKUP_LIKE_PATTERN.test((node as CharacterData).data);
  }
  return false;
}

/**
 * 업로드 전에 보안상 위험한 SVG를 거부한다. 렌더링 sanitizer가 조용히 지우는 무해한 메타데이터는
 * 거부하지 않는다.
 */
export function hasUnsafeSvgPayload(doc: Document): boolean {
  const root = doc.documentElement;
  if (!isSvgRootElement(root)) return true;

  for (const node of Array.from(doc.childNodes)) {
    if (hasMarkupLikeNodeData(node)) return true;
  }

  const stack: Node[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.nodeType === ELEMENT_NODE) {
      const el = node as Element;
      if (isDangerousSvgElement(el)) return true;
      for (const attr of Array.from(el.attributes)) {
        if (isUnsafeSvgAttribute(attr)) return true;
      }
      for (const child of Array.from(el.childNodes)) {
        stack.push(child);
      }
      continue;
    }

    if (hasMarkupLikeNodeData(node)) return true;
  }

  return false;
}

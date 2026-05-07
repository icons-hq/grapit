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
]);

const BLOCKED_SVG_ATTR_NAMES = new Set(['href', 'xlink:href', 'src']);

function isBlockedSvgElement(el: Element) {
  return BLOCKED_SVG_TAG_NAMES.has(el.localName.toLowerCase());
}

function isUnsafeSvgAttribute(attr: Attr) {
  const name = attr.name.toLowerCase();
  const value = attr.value.trim().toLowerCase();
  const unsafeStyle =
    name === 'style' && /(?:url\s*\(|expression\s*\()/i.test(attr.value);

  return (
    name.startsWith('on') ||
    BLOCKED_SVG_ATTR_NAMES.has(name) ||
    value.includes('javascript:') ||
    unsafeStyle
  );
}

export function sanitizeParsedSvg(doc: Document) {
  for (const el of Array.from(doc.querySelectorAll('*'))) {
    if (isBlockedSvgElement(el)) {
      el.remove();
      continue;
    }

    for (const attr of Array.from(el.attributes)) {
      if (isUnsafeSvgAttribute(attr)) {
        el.removeAttribute(attr.name);
      }
    }
  }
}

export function hasUnsafeSvgPayload(doc: Document) {
  for (const el of Array.from(doc.querySelectorAll('*'))) {
    if (isBlockedSvgElement(el)) return true;

    for (const attr of Array.from(el.attributes)) {
      if (isUnsafeSvgAttribute(attr)) return true;
    }
  }

  return false;
}

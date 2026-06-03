import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const layoutSource = readFileSync(
  join(process.cwd(), 'app/layout.tsx'),
  'utf8',
);

describe('root layout translation controls', () => {
  it('disables browser auto-translation so React-owned auth DOM is not mutated', () => {
    expect(layoutSource).toContain('translate="no"');
    expect(layoutSource).toContain('notranslate');
    expect(layoutSource).toMatch(
      /other:\s*\{\s*google:\s*['"]notranslate['"],?\s*\}/s,
    );
  });
});

import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const sharedLocalesSource = readFileSync(
  new URL('../../../packages/shared/src/constants/locales.ts', import.meta.url),
  'utf8',
);

test.describe('Phase 26 M1 direct deploy smoke', () => {
  test('records active locale scope before M1 can pass', () => {
    expect(extractSupportedLocales(sharedLocalesSource)).toEqual([
      'ko',
      'en',
      'th',
      'zh-CN',
      'ja',
    ]);
  });
});

function extractSupportedLocales(source: string): string[] {
  const match = source.match(/SUPPORTED_LOCALES\s*=\s*\[(?<items>[^\]]+)\]/);
  expect(match?.groups?.items, 'SUPPORTED_LOCALES source literal').toBeTruthy();
  return match!.groups!.items
    .split(',')
    .map((item) => item.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}

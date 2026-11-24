import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { AutomaticTranslationLabel } from '../automatic-translation-label';

describe('AutomaticTranslationLabel', () => {
  it('renders Korean automatic translation review copy by default', () => {
    render(<AutomaticTranslationLabel />);

    expect(screen.getByText('자동 번역 검수본')).toBeInTheDocument();
  });

  it.each([
    ['en', 'Reviewed machine translation'],
    ['th', 'คำแปลอัตโนมัติที่ตรวจทานแล้ว'],
    ['zh-CN', '已经审校的机器翻译'],
    ['unknown', '자동 번역 검수본'],
  ])('renders the label for %s', (locale, expectedCopy) => {
    render(<AutomaticTranslationLabel locale={locale} />);

    expect(screen.getByText(expectedCopy)).toBeInTheDocument();
  });
});

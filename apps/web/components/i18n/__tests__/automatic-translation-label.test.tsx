import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { AutomaticTranslationLabel } from '../automatic-translation-label';

describe('AutomaticTranslationLabel', () => {
  it('renders Korean automatic translation review copy by default', () => {
    render(<AutomaticTranslationLabel />);

    expect(screen.getByText('자동 번역 검수본')).toBeInTheDocument();
    expect(screen.getByText('Reviewed machine translation')).toBeInTheDocument();
  });

  it.each([
    ['en', 'Reviewed machine translation'],
    ['th', 'Reviewed machine translation'],
    ['zh-CN', 'Reviewed machine translation'],
    ['ja', 'Reviewed machine translation'],
    ['unknown', 'Reviewed machine translation'],
  ])('renders English fallback copy for %s', (locale, expectedCopy) => {
    render(<AutomaticTranslationLabel locale={locale} />);

    expect(screen.getByText('자동 번역 검수본')).toBeInTheDocument();
    expect(screen.getByText(expectedCopy)).toBeInTheDocument();
  });
});

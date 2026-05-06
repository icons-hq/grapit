import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';

import { PhoneInput } from '../phone-input';

describe('PhoneInput launch locale labels', () => {
  const localeCases = [
    ['ko', '국가 선택: 대한민국'],
    ['en', 'Phone number country: South Korea'],
    ['th', 'ประเทศของหมายเลขโทรศัพท์: เกาหลีใต้'],
    ['zh-CN', '电话号码国家/地区：中国韩国'],
    ['zh-TW', '電話號碼國家/地區：韓國'],
  ] as const;

  it.each(localeCases)('uses %s labels for the country selector', (locale, accessibleName) => {
    render(<PhoneInput locale={locale} value="" onChange={() => {}} />);

    expect(screen.getByRole('button', { name: accessibleName })).toBeInTheDocument();
  });

  it('keeps unsupported countries searchable and selectable when localized', async () => {
    const user = userEvent.setup();

    render(<PhoneInput locale="en" value="" onChange={() => {}} />);

    await user.click(screen.getByRole('button', { name: /Phone number country/ }));
    await user.type(screen.getByPlaceholderText('Search country...'), 'Iceland');

    const icelandOption = screen.getByText('Iceland').closest('[cmdk-item]');
    expect(icelandOption).not.toBeNull();
    expect(within(icelandOption as HTMLElement).getByText('+354')).toBeInTheDocument();

    await user.click(icelandOption as HTMLElement);

    expect(screen.getByRole('button', { name: 'Phone number country: Iceland' })).toBeInTheDocument();
  });

  it('preserves the existing min-height and popover trigger behavior for long Thai labels', () => {
    render(<PhoneInput locale="th" value="" onChange={() => {}} />);

    const trigger = screen.getByRole('button', {
      name: 'ประเทศของหมายเลขโทรศัพท์: เกาหลีใต้',
    });

    expect(trigger).toHaveClass('h-11');
    expect(trigger).toHaveAttribute('data-slot', 'popover-trigger');
  });

  it('keeps the original Korean fallback when locale is omitted', () => {
    render(<PhoneInput value="" onChange={() => {}} />);

    expect(screen.getByRole('button', { name: '국가 선택: 대한민국' })).toBeInTheDocument();
  });
});

import { beforeAll, describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';

import { PhoneInput } from '../phone-input';

describe('PhoneInput launch locale labels', () => {
  beforeAll(() => {
    class TestResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }

    Object.defineProperty(globalThis, 'ResizeObserver', {
      value: TestResizeObserver,
      writable: true,
    });

    Element.prototype.scrollIntoView = function scrollIntoView() {};
  });

  const localeCases = [
    ['ko', '국가 선택: 대한민국 +82'],
    ['en', 'Phone number country: South Korea +82'],
    ['th', 'ประเทศ: ไทย +66'],
    ['zh-CN', '国家: 韩国 +82'],
    ['zh-TW', '國家/地區: 韓國 +82'],
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

    const icelandOption = screen
      .getAllByText('Iceland')
      .find((element) => element.closest('[cmdk-item]'))
      ?.closest('[cmdk-item]');
    expect(icelandOption).not.toBeNull();
    expect(within(icelandOption as HTMLElement).getByText('+354')).toBeInTheDocument();

    await user.click(icelandOption as HTMLElement);

    expect(screen.getByRole('button', { name: 'Phone number country: Iceland +354' })).toBeInTheDocument();
  });

  it('preserves the existing min-height and popover trigger behavior for long Thai labels', () => {
    render(<PhoneInput locale="th" value="" onChange={() => {}} />);

    const trigger = screen.getByRole('button', {
      name: 'ประเทศ: ไทย +66',
    });

    expect(trigger).toHaveClass('h-11');
    expect(trigger).toHaveAttribute('data-slot', 'popover-trigger');
    expect(trigger).toHaveTextContent('+66');
  });

  it('keeps the original Korean fallback when locale is omitted', () => {
    render(<PhoneInput value="" onChange={() => {}} />);

    expect(screen.getByRole('button', { name: '국가 선택: 대한민국 +82' })).toBeInTheDocument();
  });
});

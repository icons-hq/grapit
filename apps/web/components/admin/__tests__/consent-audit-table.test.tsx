import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import {
  ConsentAuditTable,
  type ConsentAuditFilters,
  type ConsentAuditRow,
} from '../consent-audit-table';

const rows: ConsentAuditRow[] = [
  {
    id: '00000000-0000-4000-8000-000000000001',
    itemKey: 'cross_border_transfer',
    version: '2026-04-28',
    language: 'ko',
    maskedUser: {
      id: 'user_123',
      email: 'su***@example.com',
      phone: '+82********78',
    },
    maskedIp: '203.0.113.0',
    timestamp: '2026-05-06T03:20:00.000Z',
    sourceFlow: 'signup',
    accepted: true,
  },
];

const legacyLocaleLabel = String.fromCharCode(0x65e5, 0x672c, 0x8a9e);

function renderTable(overrides?: {
  auditRows?: ConsentAuditRow[];
  isLoading?: boolean;
  isError?: boolean;
  onSearch?: (filters: ConsentAuditFilters) => void;
  onRowOpen?: (row: ConsentAuditRow) => void;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  defaultWindowFrom?: string | null;
}) {
  const onSearch = overrides?.onSearch ?? vi.fn();
  const onRowOpen = overrides?.onRowOpen ?? vi.fn();
  const onLoadMore = vi.fn();

  render(
    <ConsentAuditTable
      auditRows={overrides?.auditRows ?? rows}
      isLoading={overrides?.isLoading ?? false}
      isError={overrides?.isError ?? false}
      onSearch={onSearch}
      onRowOpen={onRowOpen}
      hasMore={overrides?.hasMore}
      isLoadingMore={overrides?.isLoadingMore}
      onLoadMore={onLoadMore}
      defaultWindowFrom={overrides?.defaultWindowFrom}
    />,
  );

  return { onSearch, onRowOpen, onLoadMore };
}

describe('ConsentAuditTable', () => {
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
      value: () => false,
      configurable: true,
    });
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      value: () => {},
      configurable: true,
    });
    Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
      value: () => {},
      configurable: true,
    });
    Element.prototype.scrollIntoView = function scrollIntoView() {};
  });

  it('submits every COMP-02 filter for user, item, version, language, timestamp range, and IP', async () => {
    const user = userEvent.setup();
    const { onSearch } = renderTable();

    await user.type(screen.getByLabelText('사용자 ID 또는 이메일'), 'admin@example.com');
    await user.selectOptions(screen.getByLabelText('동의 항목'), 'cross_border_transfer');
    await user.type(screen.getByLabelText('버전'), '2026-04-28');
    await user.type(screen.getByLabelText('IP 주소'), '203.0.113.10');
    fireEvent.change(screen.getByLabelText('시작 시각'), {
      target: { value: '2026-05-01T00:00' },
    });
    fireEvent.change(screen.getByLabelText('종료 시각'), {
      target: { value: '2026-05-06T23:59' },
    });

    const languageTrigger = screen.getByRole('combobox', { name: '언어' });
    await user.click(languageTrigger);
    await user.click(await screen.findByRole('option', { name: '한국어' }));

    await user.click(screen.getByRole('button', { name: '조회' }));

    expect(onSearch).toHaveBeenCalledWith({
      user: 'admin@example.com',
      item: 'cross_border_transfer',
      version: '2026-04-28',
      language: 'ko',
      from: '2026-05-01T00:00',
      to: '2026-05-06T23:59',
      ip: '203.0.113.10',
    });
  });

  it('exposes the active Chinese consent filter without a Japanese launch option', async () => {
    const user = userEvent.setup();
    renderTable();

    await user.click(screen.getByRole('combobox', { name: '언어' }));

    expect(await screen.findByRole('option', { name: '简体中文' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: legacyLocaleLabel })).not.toBeInTheDocument();
  });

  it('renders masked audit evidence and does not reveal raw PII', () => {
    renderTable();

    expect(screen.getByRole('cell', { name: '개인정보 국외 이전' })).toBeInTheDocument();
    expect(screen.getByText('2026-04-28')).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '한국어' })).toBeInTheDocument();
    expect(screen.getByText('su***@example.com')).toBeInTheDocument();
    expect(screen.getByText('+82********78')).toBeInTheDocument();
    expect(screen.getByText('203.0.113.0')).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '회원가입' })).toBeInTheDocument();
    expect(screen.queryByText('sujin@example.com')).not.toBeInTheDocument();
    expect(screen.queryByText('203.0.113.123')).not.toBeInTheDocument();
  });

  it('opens row detail with click, Enter, and Space activation', () => {
    const { onRowOpen } = renderTable();
    const row = screen.getByRole('button', {
      name: /cross_border_transfer 동의 감사 상세 보기/,
    });

    fireEvent.click(row);
    fireEvent.keyDown(row, { key: 'Enter' });
    fireEvent.keyDown(row, { key: ' ' });

    expect(onRowOpen).toHaveBeenCalledTimes(3);
    expect(onRowOpen).toHaveBeenLastCalledWith(rows[0]);
  });

  it('shows stable loading skeleton rows', () => {
    renderTable({ auditRows: [], isLoading: true });

    expect(screen.getByText('동의 감사 이력을 불러오는 중입니다')).toBeInTheDocument();
    expect(screen.getAllByTestId('consent-audit-skeleton-row')).toHaveLength(5);
  });

  it('shows empty state when no audit rows match filters', () => {
    renderTable({ auditRows: [] });

    expect(screen.getByText('조회된 동의 감사 이력이 없습니다')).toBeInTheDocument();
    expect(screen.getByText('필터 조건을 조정해 다시 조회하세요')).toBeInTheDocument();
  });

  it('offers the next page only while the server reports more rows', async () => {
    const user = userEvent.setup();
    const { onLoadMore } = renderTable({ hasMore: true });

    await user.click(screen.getByRole('button', { name: '더 보기' }));
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('disables the next page button while it loads', () => {
    renderTable({ hasMore: true, isLoadingMore: true });
    expect(screen.getByRole('button', { name: '불러오는 중…' })).toBeDisabled();
  });

  it('hides the next page button on the last page', () => {
    renderTable({ hasMore: false });
    expect(screen.queryByRole('button', { name: '더 보기' })).not.toBeInTheDocument();
  });

  it('explains the default lookback window applied to an unbounded query', () => {
    renderTable({ defaultWindowFrom: '2026-09-23T00:00:00.000Z' });

    const notice = screen.getByRole('status');
    expect(notice).toHaveTextContent('시작 시각을 지정하지 않아 2026-09-23 09:00:00부터 7일 범위의 기록만 조회했습니다.');
    // With only an end time the window ends at that time, not now: the notice
    // must not claim the period was unset or that it covers the latest days.
    expect(notice).not.toHaveTextContent('기간을 지정하지 않아');
    expect(notice).not.toHaveTextContent('최근');
  });

  it('shows accessible error state', () => {
    renderTable({ auditRows: [], isError: true });

    const alert = screen.getByRole('alert');
    expect(within(alert).getByText('정보를 불러오지 못했습니다. 새로고침 후 다시 시도하고, 반복되면 운영자에게 문의하세요.')).toBeInTheDocument();
  });
});

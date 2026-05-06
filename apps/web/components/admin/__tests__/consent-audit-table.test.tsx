import { render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  ConsentAuditTable,
  type ConsentAuditFilters,
  type ConsentAuditRow,
} from '../consent-audit-table';

const rows: ConsentAuditRow[] = [
  {
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

function renderTable(overrides?: {
  auditRows?: ConsentAuditRow[];
  isLoading?: boolean;
  isError?: boolean;
  onSearch?: (filters: ConsentAuditFilters) => void;
  onRowOpen?: (row: ConsentAuditRow) => void;
}) {
  const onSearch = overrides?.onSearch ?? vi.fn();
  const onRowOpen = overrides?.onRowOpen ?? vi.fn();

  render(
    <ConsentAuditTable
      auditRows={overrides?.auditRows ?? rows}
      isLoading={overrides?.isLoading ?? false}
      isError={overrides?.isError ?? false}
      onSearch={onSearch}
      onRowOpen={onRowOpen}
    />,
  );

  return { onSearch, onRowOpen };
}

describe('ConsentAuditTable', () => {
  it('submits every COMP-02 filter for user, item, version, language, timestamp range, and IP', async () => {
    const user = userEvent.setup();
    const { onSearch } = renderTable();

    await user.type(screen.getByLabelText('사용자 ID 또는 이메일'), 'admin@example.com');
    await user.type(screen.getByLabelText('동의 항목'), 'cross_border_transfer');
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

  it('renders masked audit evidence and does not reveal raw PII', () => {
    renderTable();

    expect(screen.getByText('cross_border_transfer')).toBeInTheDocument();
    expect(screen.getByText('2026-04-28')).toBeInTheDocument();
    expect(screen.getByText('ko')).toBeInTheDocument();
    expect(screen.getByText('su***@example.com')).toBeInTheDocument();
    expect(screen.getByText('+82********78')).toBeInTheDocument();
    expect(screen.getByText('203.0.113.0')).toBeInTheDocument();
    expect(screen.getByText('signup')).toBeInTheDocument();
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

  it('shows accessible error state', () => {
    renderTable({ auditRows: [], isError: true });

    const alert = screen.getByRole('alert');
    expect(within(alert).getByText('정보를 불러오지 못했습니다. 새로고침 후 다시 시도하고, 반복되면 운영자에게 문의하세요.')).toBeInTheDocument();
  });
});

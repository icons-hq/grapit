import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

import {
  OperationsInbox,
  type OperationsInboxRow,
} from '../operations-inbox';

const baseRow: OperationsInboxRow = {
  id: 'thread-qna',
  source: 'qna',
  sourceLabel: 'Q&A',
  category: 'general',
  categoryLabel: '일반 문의',
  subject: '좌석 위치 문의',
  summary: '좌석 시야를 확인하고 싶습니다.',
  locale: 'ko',
  status: 'open',
  queue: 'Q&A',
  assignee: {
    id: null,
    name: '미배정',
    email: null,
  },
  requester: {
    id: 'user-1',
    email: 'su***@example.com',
    phone: '+82********78',
    name: 'S**',
  },
  priority: 'normal',
  escalation: {
    state: 'none',
    escalated: false,
    label: '일반',
  },
  sla: {
    dueAt: '2026-05-14T10:00:00.000Z',
    remainingMinutes: 420,
    state: 'within_sla',
    label: '420분 남음',
  },
  createdAt: '2026-05-14T01:00:00.000Z',
  updatedAt: '2026-05-14T02:00:00.000Z',
  lastMessageAt: '2026-05-14T02:00:00.000Z',
  reservationId: null,
  refundDispute: null,
  signupFailure: null,
};

function renderInbox(rows: OperationsInboxRow[] = []) {
  render(
    <OperationsInbox
      rows={rows}
      isLoading={false}
      isError={false}
      onFilterChange={vi.fn()}
      onEscalate={vi.fn()}
      onAnswer={vi.fn()}
      onReassign={vi.fn()}
    />,
  );
}

describe('OperationsInbox', () => {
  it('renders the UI-SPEC empty state copy', () => {
    renderInbox([]);

    expect(screen.getByText('처리할 운영 항목이 없습니다')).toBeInTheDocument();
    expect(
      screen.getByText(
        '미답변 문의, 검토 요청, 환불 분쟁이 생기면 여기에 표시됩니다. 필터를 조정하거나 새 공지 또는 FAQ를 등록하세요.',
      ),
    ).toBeInTheDocument();
  });

  it('pins escalated high-risk rows before normal rows', () => {
    renderInbox([
      baseRow,
      {
        ...baseRow,
        id: 'thread-payment',
        source: 'cs_ticket',
        sourceLabel: 'CS',
        category: 'payment_error',
        categoryLabel: '결제 오류',
        subject: 'Toss 결제 실패',
        priority: 'escalated',
        escalation: {
          state: 'auto_escalated',
          escalated: true,
          label: '즉시 확인',
        },
        sla: {
          dueAt: '2026-05-14T02:00:00.000Z',
          remainingMinutes: -60,
          state: 'overdue',
          label: '24시간 SLA를 초과했습니다. 즉시 확인해주세요',
        },
        createdAt: '2026-05-14T02:30:00.000Z',
      },
    ]);

    const renderedRows = screen.getAllByTestId('operations-inbox-row');

    expect(within(renderedRows[0]!).getByText('Toss 결제 실패')).toBeInTheDocument();
    expect(within(renderedRows[0]!).getByText('즉시 확인')).toBeInTheDocument();
    expect(within(renderedRows[1]!).getByText('좌석 위치 문의')).toBeInTheDocument();
  });

  it('renders due-soon amber and overdue red SLA labels', () => {
    renderInbox([
      {
        ...baseRow,
        id: 'thread-due-soon',
        subject: '입장 안내 문의',
        sla: {
          dueAt: '2026-05-14T04:30:00.000Z',
          remainingMinutes: 90,
          state: 'due_soon',
          label: '24시간 SLA 마감이 가까워지고 있습니다',
        },
      },
      {
        ...baseRow,
        id: 'thread-overdue',
        subject: '환불 지연',
        category: 'refund_unprocessed',
        categoryLabel: '환불 미처리',
        priority: 'overdue',
        sla: {
          dueAt: '2026-05-14T02:40:00.000Z',
          remainingMinutes: -20,
          state: 'overdue',
          label: '24시간 SLA를 초과했습니다. 즉시 확인해주세요',
        },
      },
    ]);

    expect(screen.getByText('24시간 SLA 마감이 가까워지고 있습니다')).toHaveClass('text-[#8B6306]');
    expect(screen.getByText('24시간 SLA를 초과했습니다. 즉시 확인해주세요')).toHaveClass('text-[#C62828]');
  });

  it('shows masked requester metadata and never renders raw email or phone values', () => {
    renderInbox([
      {
        ...baseRow,
        requester: {
          id: 'user-raw',
          email: 'ra***@example.com',
          phone: '+82********34',
          name: 'R**',
        },
      },
    ]);

    expect(screen.getByText('ra***@example.com')).toBeInTheDocument();
    expect(screen.getByText('+82********34')).toBeInTheDocument();
    expect(screen.queryByText('raw-customer@example.com')).not.toBeInTheDocument();
    expect(screen.queryByText('+821055501234')).not.toBeInTheDocument();
  });
});

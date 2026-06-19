import { render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminBenefitManager } from '../admin-benefit-manager';
import type {
  BenefitConfiguration,
  BenefitConfigurationChangeRecord,
  BenefitRunRecord,
} from '@grabit/shared';

const mocks = vi.hoisted(() => ({
  configuration: undefined as unknown,
  changes: [] as unknown[],
  runs: [] as unknown[],
  saveMutate: vi.fn(),
  testMutate: vi.fn(),
  liveMutate: vi.fn(),
  rollbackMutate: vi.fn(),
  exportMutate: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  performanceListParams: [] as Array<{ page?: number; limit?: number; search?: string }>,
}));

vi.mock('@/hooks/use-admin', () => ({
  useAdminPerformances: (params: { page?: number; limit?: number; search?: string }) => {
    mocks.performanceListParams.push(params);
    return {
      data: performanceListResponse(),
      isLoading: false,
      isError: false,
    };
  },
  useAdminPerformanceDetail: (performanceId: string) => ({
    data: performanceId === performanceFixture.id
      ? performanceDetailResponse()
      : undefined,
    isLoading: false,
    isError: false,
  }),
}));

vi.mock('@/hooks/use-admin-benefits', () => ({
  useAdminBenefitConfiguration: () => ({
    data: mocks.configuration,
    isLoading: false,
    isSuccess: true,
  }),
  useAdminBenefitConfigurationChanges: () => ({
    data: mocks.changes,
    isLoading: false,
  }),
  useAdminBenefitRuns: () => ({
    data: { runs: mocks.runs },
    isLoading: false,
  }),
  useSaveAdminBenefitConfiguration: () => ({
    mutateAsync: mocks.saveMutate,
    isPending: false,
  }),
  useRunAdminBenefitTest: () => ({
    mutateAsync: mocks.testMutate,
    isPending: false,
  }),
  useRunAdminBenefitLive: () => ({
    mutateAsync: mocks.liveMutate,
    isPending: false,
  }),
  useRollbackAdminBenefitRun: () => ({
    mutateAsync: mocks.rollbackMutate,
    isPending: false,
  }),
  useAdminBenefitExport: () => ({
    mutateAsync: mocks.exportMutate,
    isPending: false,
  }),
}));

vi.mock('sonner', () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
  },
}));

const showtimeId = '00000000-0000-4000-8000-000000000301';
const configurationId = '00000000-0000-4000-8000-000000000401';
const liveRunId = '00000000-0000-4000-8000-000000000501';
const testRunId = '00000000-0000-4000-8000-000000000502';
const performanceId = '00000000-0000-4000-8000-000000000201';

const performanceFixture = {
  id: performanceId,
  title: 'Girl Rules Fanmeet',
  genre: 'artist_celebrity',
  posterUrl: null,
  status: 'upcoming',
  startDate: '2026-07-18T00:00:00.000Z',
  endDate: '2026-07-18T00:00:00.000Z',
  venueName: 'Donghae Arts Center',
} as const;

const fixtureConfiguration: BenefitConfiguration = {
  id: configurationId,
  showtimeId,
  active: true,
  version: 2,
  benefits: [
    {
      kind: 'included',
      identity: 'benefit_official_poster',
      displayCopy: {
        ko: { name: '공식 포스터', description: '공식 포스터 설명' },
        en: { name: 'Official poster', description: 'Official poster benefit' },
        'zh-CN': { name: '官方海报', description: '官方海报福利' },
        th: { name: 'Official poster', description: 'Official poster benefit' },
      },
      eligibleTierNames: ['SVIP', 'VIP', 'R', 'S'],
      mutuallyExclusiveWith: [],
    },
    {
      kind: 'limited',
      identity: 'benefit_6_to_1',
      displayCopy: {
        ko: { name: '6:1 이벤트 참여권', description: '6:1 이벤트 설명' },
        en: { name: '6:1 event', description: '6:1 event benefit' },
        'zh-CN': { name: '6:1 活动', description: '6:1 活动福利' },
        th: { name: '6:1 event', description: '6:1 event benefit' },
      },
      eligibleTierNames: ['SVIP'],
      quantity: 30,
      selectionPriority: 1,
      mutuallyExclusiveWith: ['benefit_polaroid'],
    },
  ],
  createdAt: '2026-07-01T08:00:00.000Z',
  updatedAt: '2026-07-01T08:10:00.000Z',
  activatedAt: '2026-07-01T08:10:00.000Z',
};

const fixtureRuns: BenefitRunRecord[] = [
  {
    id: liveRunId,
    showtimeId,
    configurationId,
    mode: 'live',
    attachedToTicket: true,
    entitlementCount: 30,
    createdByUserId: 'admin-user',
    redactedSeedRef: 'seed_[redacted]',
    startedAt: '2026-07-01T09:00:00.000Z',
    completedAt: '2026-07-01T09:01:00.000Z',
  },
  {
    id: testRunId,
    showtimeId,
    configurationId,
    mode: 'test',
    attachedToTicket: false,
    entitlementCount: 30,
    createdByUserId: 'admin-user',
    operatorProvidedSeedRef: 'seed-test',
    startedAt: '2026-07-01T08:30:00.000Z',
    completedAt: '2026-07-01T08:31:00.000Z',
  },
];

const fixtureChanges: BenefitConfigurationChangeRecord[] = [
  {
    id: 'change-1',
    showtimeId,
    configurationId,
    action: 'updated',
    actorUserId: 'admin-user',
    reason: '운영안 확정',
    changedAt: '2026-07-01T08:10:00.000Z',
  },
];

function performanceListResponse() {
  return {
    data: [performanceFixture],
    total: 1,
    page: 1,
    limit: 200,
    totalPages: 1,
  };
}

function performanceDetailResponse() {
  return {
    ...performanceFixture,
    subcategory: null,
    venueId: null,
    description: null,
    descriptionVisible: true,
    runtime: null,
    ageRating: '전체 관람가',
    salesInfo: null,
    salesInfoVisible: true,
    detailImages: [],
    viewCount: 0,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    venue: null,
    priceTiers: [],
    showtimes: [
      {
        id: showtimeId,
        performanceId,
        dateTime: '2026-07-18T10:00:00.000Z',
      },
    ],
    castings: [],
    seatMaps: [],
    bookingPolicy: {
      maxTicketsPerUser: 1,
      allowedPaymentMethods: ['CARD'],
      changePolicyEnabled: false,
      paymentWindowMinutes: 7,
      seatHoldMinutes: 10,
      cancelledSeatHoldMinMinutes: 1,
      cancelledSeatHoldMaxMinutes: 10,
      manualOpenEnabled: true,
      bookingStartsAt: null,
    },
    seatMap: null,
  };
}

async function selectBenefitShowtime(user: ReturnType<typeof userEvent.setup>) {
  render(<AdminBenefitManager />);

  await selectOption(user, '공연', performanceFixture.title);
  await selectOption(user, '회차', '2026. 7. 18. 오후 7:00');
}

describe('AdminBenefitManager', () => {
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

  beforeEach(() => {
    mocks.configuration = fixtureConfiguration;
    mocks.changes = fixtureChanges;
    mocks.runs = fixtureRuns;
    mocks.saveMutate.mockReset();
    mocks.testMutate.mockReset();
    mocks.liveMutate.mockReset();
    mocks.rollbackMutate.mockReset();
    mocks.exportMutate.mockReset();
    mocks.toastSuccess.mockReset();
    mocks.toastError.mockReset();
    mocks.performanceListParams = [];
    mocks.saveMutate.mockResolvedValue(fixtureConfiguration);
    mocks.testMutate.mockResolvedValue(fixtureRuns[1]);
    mocks.liveMutate.mockResolvedValue(fixtureRuns[0]);
    mocks.rollbackMutate.mockResolvedValue(fixtureRuns[0]);
    mocks.exportMutate.mockResolvedValue({
      blob: new Blob(['csv']),
      filename: 'benefit-export.csv',
    });
  });

  it('saves current ALL and limited benefit settings with an audit reason', async () => {
    const user = userEvent.setup();
    await selectBenefitShowtime(user);

    await screen.findByDisplayValue('benefit_official_poster');
    await user.clear(screen.getByLabelText('설정 저장 사유'));
    await user.type(screen.getByLabelText('설정 저장 사유'), '혜택 운영안 확정');
    await user.click(screen.getByRole('button', { name: /설정 저장/ }));

    await waitFor(() => expect(mocks.saveMutate).toHaveBeenCalledTimes(1));
    expect(mocks.saveMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        showtimeId,
        reason: '혜택 운영안 확정',
        benefits: expect.arrayContaining([
          expect.objectContaining({
            kind: 'included',
            identity: 'benefit_official_poster',
            eligibleTierNames: ['SVIP', 'VIP', 'R', 'S'],
          }),
          expect.objectContaining({
            kind: 'limited',
            identity: 'benefit_6_to_1',
            quantity: 30,
            selectionPriority: 1,
            mutuallyExclusiveWith: ['benefit_polaroid'],
          }),
        ]),
      }),
    );
  });

  it('runs a test from the current draft without attaching benefits to tickets', async () => {
    const user = userEvent.setup();
    await selectBenefitShowtime(user);

    await screen.findByDisplayValue('benefit_6_to_1');
    await user.type(screen.getByLabelText('테스트 seed 참조값'), 'operator-seed');
    await user.click(screen.getByRole('button', { name: /^테스트 실행$/ }));

    await waitFor(() => expect(mocks.testMutate).toHaveBeenCalledTimes(1));
    expect(mocks.testMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        showtimeId,
        configurationId,
        operatorProvidedSeedRef: 'operator-seed',
        configurationSnapshot: expect.objectContaining({
          active: false,
          sourceConfigurationId: configurationId,
          benefits: expect.arrayContaining([
            expect.objectContaining({ identity: 'benefit_6_to_1' }),
          ]),
        }),
      }),
    );
  });

  it('runs live, exports run CSV, and opens rollback from run history', async () => {
    const user = userEvent.setup();
    await selectBenefitShowtime(user);

    await screen.findByText(liveRunId);
    await user.type(screen.getByLabelText('라이브 적용 사유'), '판매 종료 전 확정');
    await user.click(screen.getByRole('button', { name: /라이브 적용/ }));

    await waitFor(() => expect(mocks.liveMutate).toHaveBeenCalledTimes(1));
    expect(mocks.liveMutate).toHaveBeenCalledWith({
      showtimeId,
      configurationId,
      reason: '판매 종료 전 확정',
    });

    const liveRunRow = screen.getByText(liveRunId).closest('tr');
    expect(liveRunRow).not.toBeNull();
    await user.click(within(liveRunRow as HTMLTableRowElement).getByRole('button', { name: /CSV/ }));
    expect(mocks.exportMutate).toHaveBeenCalledWith({
      path: `/api/v1/admin/benefits/runs/${liveRunId}/export`,
      fallbackFilename: `benefit-run-${liveRunId}.csv`,
    });

    await user.click(
      within(liveRunRow as HTMLTableRowElement).getByRole('button', { name: /되돌리기/ }),
    );
    await user.type(screen.getByLabelText('Rollback 사유'), '직전 실행으로 복구');
    await user.click(screen.getByRole('button', { name: /^되돌리기$/ }));

    await waitFor(() => expect(mocks.rollbackMutate).toHaveBeenCalledTimes(1));
    expect(mocks.rollbackMutate).toHaveBeenCalledWith({
      showtimeId,
      sourceRunId: liveRunId,
      reason: '직전 실행으로 복구',
    });
  });

  it('keeps benefit actions disabled until a performance and showtime are selected', () => {
    render(<AdminBenefitManager />);

    expect(screen.queryByLabelText('회차 ID')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '설정 CSV' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '부여 CSV' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /설정 저장/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^테스트 실행$/ })).toBeDisabled();
    expect(screen.getByText('공연과 회차를 선택하면 실행 기록을 조회합니다.')).toBeInTheDocument();
    expect(screen.getByText('공연과 회차를 선택하면 변경 기록을 조회합니다.')).toBeInTheDocument();
  });

  it('filters performance options by title search', async () => {
    const user = userEvent.setup();
    render(<AdminBenefitManager />);

    await user.type(screen.getByLabelText('공연 검색'), 'Girl');

    await waitFor(() =>
      expect(mocks.performanceListParams).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            page: 1,
            limit: 200,
            search: 'Girl',
          }),
        ]),
      ),
    );
  });
});

async function selectOption(
  user: ReturnType<typeof userEvent.setup>,
  label: string,
  option: string,
) {
  await user.click(screen.getByLabelText(label));
  await user.click(within(document.body).getByRole('option', { name: option }));
}

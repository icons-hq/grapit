'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Download,
  FlaskConical,
  Gift,
  Loader2,
  Play,
  Plus,
  RotateCcw,
  Save,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import type {
  BenefitConfiguration,
  BenefitDefinition,
  BenefitRunRecord,
} from '@grabit/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import {
  useAdminBenefitConfiguration,
  useAdminBenefitConfigurationChanges,
  useAdminBenefitExport,
  useAdminBenefitRuns,
  useRollbackAdminBenefitRun,
  useRunAdminBenefitLive,
  useRunAdminBenefitTest,
  useSaveAdminBenefitConfiguration,
} from '@/hooks/use-admin-benefits';
import { cn } from '@/lib/cn';

type BenefitDraftKind = 'included' | 'limited';

interface BenefitDraft {
  localId: string;
  kind: BenefitDraftKind;
  identity: string;
  nameKo: string;
  descriptionKo: string;
  eligibleTierNames: string;
  quantity: string;
  selectionPriority: string;
  mutuallyExclusiveWith: string;
}

interface AdminBenefitManagerProps {
  initialShowtimeId?: string;
  className?: string;
}

export function AdminBenefitManager({
  initialShowtimeId = '',
  className,
}: AdminBenefitManagerProps) {
  const [showtimeId, setShowtimeId] = useState(initialShowtimeId);
  const normalizedShowtimeId = showtimeId.trim();
  const configurationQuery = useAdminBenefitConfiguration(normalizedShowtimeId);
  const changesQuery = useAdminBenefitConfigurationChanges(normalizedShowtimeId);
  const runsQuery = useAdminBenefitRuns(normalizedShowtimeId);
  const saveConfiguration = useSaveAdminBenefitConfiguration();
  const runTest = useRunAdminBenefitTest();
  const runLive = useRunAdminBenefitLive();
  const rollbackRun = useRollbackAdminBenefitRun();
  const exportMutation = useAdminBenefitExport();

  const [draftSourceKey, setDraftSourceKey] = useState('');
  const [drafts, setDrafts] = useState<BenefitDraft[]>(() => [
    createBenefitDraft('included'),
    createBenefitDraft('limited'),
  ]);
  const [saveReason, setSaveReason] = useState('');
  const [testSeedRef, setTestSeedRef] = useState('');
  const [liveReason, setLiveReason] = useState('');
  const [rollbackTarget, setRollbackTarget] = useState<BenefitRunRecord | null>(null);
  const [rollbackReason, setRollbackReason] = useState('');

  const configuration = configurationQuery.data ?? null;
  const runs = runsQuery.data?.runs ?? [];
  const changes = changesQuery.data ?? [];
  const limitedDrafts = drafts.filter((draft) => draft.kind === 'limited');
  const includedDrafts = drafts.filter((draft) => draft.kind === 'included');
  const isMutating =
    saveConfiguration.isPending ||
    runTest.isPending ||
    runLive.isPending ||
    rollbackRun.isPending ||
    exportMutation.isPending;
  const canUseShowtime = normalizedShowtimeId.length > 0;
  const canRunLive =
    canUseShowtime &&
    Boolean(configuration?.id) &&
    liveReason.trim().length > 0 &&
    !isMutating;

  useEffect(() => {
    setDraftSourceKey('');
  }, [normalizedShowtimeId]);

  useEffect(() => {
    if (!normalizedShowtimeId || !configurationQuery.isSuccess) {
      return;
    }

    const nextSourceKey = configuration
      ? configuration.id
      : `empty:${normalizedShowtimeId}`;
    if (draftSourceKey === nextSourceKey) {
      return;
    }

    setDrafts(
      configuration
        ? draftsFromConfiguration(configuration)
        : [createBenefitDraft('included'), createBenefitDraft('limited')],
    );
    setDraftSourceKey(nextSourceKey);
  }, [
    configuration,
    configurationQuery.isSuccess,
    draftSourceKey,
    normalizedShowtimeId,
  ]);

  const summary = useMemo(
    () => ({
      included: includedDrafts.length,
      limited: limitedDrafts.length,
      liveRuns: runs.filter((run) => run.mode === 'live').length,
      testRuns: runs.filter((run) => run.mode === 'test').length,
    }),
    [includedDrafts.length, limitedDrafts.length, runs],
  );

  function updateDraft(localId: string, patch: Partial<BenefitDraft>) {
    setDrafts((current) =>
      current.map((draft) =>
        draft.localId === localId ? { ...draft, ...patch } : draft,
      ),
    );
  }

  function addDraft(kind: BenefitDraftKind) {
    setDrafts((current) => [...current, createBenefitDraft(kind)]);
  }

  function removeDraft(localId: string) {
    setDrafts((current) => {
      if (current.length === 1) {
        return current;
      }
      return current.filter((draft) => draft.localId !== localId);
    });
  }

  function buildDefinitionsOrNotify(): BenefitDefinition[] | null {
    const result = buildBenefitDefinitions(drafts);
    if (result.ok) {
      return result.benefits;
    }
    toast.error(result.message);
    return null;
  }

  function handleSave() {
    if (!canUseShowtime) {
      toast.error('회차 ID를 입력하세요.');
      return;
    }

    const benefits = buildDefinitionsOrNotify();
    if (!benefits) {
      return;
    }

    void saveConfiguration
      .mutateAsync({
        showtimeId: normalizedShowtimeId,
        benefits,
        reason: saveReason,
      })
      .then(() => {
        toast.success('혜택 설정을 저장했습니다.');
        setSaveReason('');
      })
      .catch((error: unknown) => {
        toast.error(error instanceof Error ? error.message : '혜택 설정 저장에 실패했습니다.');
      });
  }

  function handleRunTest() {
    if (!canUseShowtime) {
      toast.error('회차 ID를 입력하세요.');
      return;
    }

    const benefits = buildDefinitionsOrNotify();
    if (!benefits) {
      return;
    }

    void runTest
      .mutateAsync({
        showtimeId: normalizedShowtimeId,
        configurationId: configuration?.id ?? null,
        operatorProvidedSeedRef: testSeedRef,
        configurationSnapshot: {
          active: false,
          sourceConfigurationId: configuration?.id ?? null,
          capturedAt: new Date().toISOString(),
          benefits,
        },
      })
      .then(() => {
        toast.success('테스트 혜택 실행 결과를 기록했습니다.');
        setTestSeedRef('');
      })
      .catch((error: unknown) => {
        toast.error(error instanceof Error ? error.message : '테스트 실행에 실패했습니다.');
      });
  }

  function handleRunLive() {
    if (!configuration?.id) {
      toast.error('라이브 실행 전 혜택 설정을 저장하세요.');
      return;
    }
    if (liveReason.trim().length === 0) {
      toast.error('라이브 실행 사유를 입력하세요.');
      return;
    }

    void runLive
      .mutateAsync({
        showtimeId: normalizedShowtimeId,
        configurationId: configuration.id,
        reason: liveReason,
      })
      .then(() => {
        toast.success('라이브 혜택을 티켓에 적용했습니다.');
        setLiveReason('');
      })
      .catch((error: unknown) => {
        toast.error(error instanceof Error ? error.message : '라이브 실행에 실패했습니다.');
      });
  }

  function handleRollback() {
    if (!rollbackTarget || rollbackReason.trim().length === 0) {
      return;
    }

    void rollbackRun
      .mutateAsync({
        showtimeId: normalizedShowtimeId,
        sourceRunId: rollbackTarget.id,
        reason: rollbackReason,
      })
      .then(() => {
        toast.success('선택한 라이브 실행 기록으로 혜택을 되돌렸습니다.');
        setRollbackTarget(null);
        setRollbackReason('');
      })
      .catch((error: unknown) => {
        toast.error(error instanceof Error ? error.message : '혜택 rollback에 실패했습니다.');
      });
  }

  function handleExport(path: `/${string}`, fallbackFilename: string) {
    void exportMutation
      .mutateAsync({ path, fallbackFilename })
      .then((result) => {
        toast.success(`${result.filename} 다운로드를 시작했습니다.`);
      })
      .catch((error: unknown) => {
        toast.error(error instanceof Error ? error.message : 'CSV 다운로드에 실패했습니다.');
      });
  }

  return (
    <section className={cn('space-y-6', className)} aria-labelledby="admin-benefits-title">
      <div>
        <h1
          id="admin-benefits-title"
          className="text-display font-semibold leading-[1.2]"
        >
          혜택 관리
        </h1>
        <p className="mt-2 text-sm text-gray-600">
          회차별 ALL 혜택과 한정 혜택을 설정하고 테스트/라이브 실행 이력을 관리합니다.
        </p>
      </div>

      <section className="rounded-lg bg-white p-4 shadow-sm">
        <div className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-end">
          <label className="space-y-1.5 text-sm font-semibold text-gray-700">
            <span>회차 ID</span>
            <Input
              value={showtimeId}
              onChange={(event) => setShowtimeId(event.target.value)}
              placeholder="showtime id"
              aria-label="회차 ID"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={!canUseShowtime || exportMutation.isPending}
              onClick={() =>
                handleExport(
                  `/api/v1/admin/benefits/showtimes/${normalizedShowtimeId}/configuration/export`,
                  `benefit-configuration-${normalizedShowtimeId}.csv`,
                )
              }
            >
              <Download className="h-4 w-4" />
              설정 CSV
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!canUseShowtime || exportMutation.isPending}
              onClick={() =>
                handleExport(
                  `/api/v1/admin/benefits/showtimes/${normalizedShowtimeId}/entitlements/export`,
                  `benefit-entitlements-${normalizedShowtimeId}.csv`,
                )
              }
            >
              <Download className="h-4 w-4" />
              부여 CSV
            </Button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <SummaryPill label="설정 버전" value={configuration?.version ?? '-'} />
          <SummaryPill label="ALL 혜택" value={summary.included} />
          <SummaryPill label="한정 혜택" value={summary.limited} />
          <SummaryPill label="실행 기록" value={`${summary.liveRuns}/${summary.testRuns}`} />
        </div>
      </section>

      <section className="rounded-lg bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-xl font-semibold leading-tight text-gray-900">
              혜택 설정
            </h2>
            <p className="mt-1 text-sm text-gray-600">
              ALL 혜택은 모든 대상 티켓에 적용되고, 한정 혜택은 실행 기록 기준으로 부여됩니다.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => addDraft('included')}>
              <Plus className="h-4 w-4" />
              ALL 추가
            </Button>
            <Button type="button" variant="outline" onClick={() => addDraft('limited')}>
              <Plus className="h-4 w-4" />
              한정 추가
            </Button>
          </div>
        </div>

        {configurationQuery.isLoading && canUseShowtime ? (
          <div className="mt-4 space-y-3">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {drafts.map((draft, index) => (
              <BenefitDraftEditor
                key={draft.localId}
                draft={draft}
                index={index}
                canRemove={drafts.length > 1}
                onChange={(patch) => updateDraft(draft.localId, patch)}
                onRemove={() => removeDraft(draft.localId)}
              />
            ))}
          </div>
        )}

        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <label className="space-y-1.5 text-sm font-semibold text-gray-700">
            <span>설정 저장 사유</span>
            <Textarea
              value={saveReason}
              onChange={(event) => setSaveReason(event.target.value)}
              placeholder="예: VIP/R/S 혜택 운영안 확정"
            />
          </label>
          <div className="flex items-end">
            <Button
              type="button"
              className="h-12 w-full"
              disabled={!canUseShowtime || saveConfiguration.isPending}
              onClick={handleSave}
            >
              {saveConfiguration.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              설정 저장
            </Button>
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg bg-white p-4 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#F3EFFF] text-[#6C3CE0]">
              <FlaskConical className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-xl font-semibold leading-tight text-gray-900">
                테스트 실행
              </h2>
              <p className="mt-1 text-sm text-gray-600">
                현재 입력값으로 결과를 기록하고 실제 티켓에는 붙이지 않습니다.
              </p>
            </div>
          </div>
          <label className="mt-4 block space-y-1.5 text-sm font-semibold text-gray-700">
            <span>테스트 seed 참조값</span>
            <Input
              value={testSeedRef}
              onChange={(event) => setTestSeedRef(event.target.value)}
              placeholder="선택 입력"
            />
          </label>
          <Button
            type="button"
            className="mt-4 h-12 w-full"
            disabled={!canUseShowtime || runTest.isPending}
            onClick={handleRunTest}
          >
            {runTest.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FlaskConical className="h-4 w-4" />
            )}
            테스트 실행
          </Button>
        </div>

        <div className="rounded-lg bg-white p-4 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#F0FDF4] text-[#15803D]">
              <Play className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-xl font-semibold leading-tight text-gray-900">
                라이브 적용
              </h2>
              <p className="mt-1 text-sm text-gray-600">
                저장된 설정으로 한정 혜택을 티켓에 확정 적용합니다.
              </p>
            </div>
          </div>
          <label className="mt-4 block space-y-1.5 text-sm font-semibold text-gray-700">
            <span>라이브 적용 사유</span>
            <Textarea
              value={liveReason}
              onChange={(event) => setLiveReason(event.target.value)}
              placeholder="예: 판매 종료 전 1차 혜택 확정"
            />
          </label>
          <Button
            type="button"
            className="mt-4 h-12 w-full bg-[#15803D] hover:bg-[#166534]"
            disabled={!canRunLive}
            onClick={handleRunLive}
          >
            {runLive.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            라이브 적용
          </Button>
        </div>
      </section>

      <section className="rounded-lg bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2">
          <Gift className="h-5 w-5 text-[#6C3CE0]" />
          <h2 className="text-xl font-semibold leading-tight text-gray-900">
            실행 기록
          </h2>
        </div>
        <div className="mt-4 overflow-x-auto rounded-lg border border-gray-200">
          <Table>
            <TableHeader>
              <TableRow className="bg-[#F5F5F7]">
                <TableHead>모드</TableHead>
                <TableHead>부여 수</TableHead>
                <TableHead>시각</TableHead>
                <TableHead>run ID</TableHead>
                <TableHead>작업</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runsQuery.isLoading && canUseShowtime &&
                Array.from({ length: 3 }).map((_, index) => (
                  <TableRow key={`benefit-run-skeleton-${index}`}>
                    <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-12" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-44" /></TableCell>
                    <TableCell><Skeleton className="h-8 w-32" /></TableCell>
                  </TableRow>
                ))}
              {!runsQuery.isLoading && !canUseShowtime && (
                <EmptyRow colSpan={5} message="회차 ID를 입력하면 실행 기록을 조회합니다." />
              )}
              {!runsQuery.isLoading && canUseShowtime && runs.length === 0 && (
                <EmptyRow colSpan={5} message="기록된 혜택 실행이 없습니다." />
              )}
              {runs.map((run) => (
                <TableRow key={run.id}>
                  <TableCell>
                    <Badge className={run.mode === 'live'
                      ? 'border-transparent bg-[#F0FDF4] text-[#15803D]'
                      : 'border-transparent bg-[#F3EFFF] text-[#6C3CE0]'}
                    >
                      {run.mode === 'live' ? 'LIVE' : 'TEST'}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-semibold">{run.entitlementCount}</TableCell>
                  <TableCell>{formatDateTime(run.completedAt ?? run.startedAt)}</TableCell>
                  <TableCell className="max-w-[260px] truncate text-sm text-gray-600">
                    {run.id}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={exportMutation.isPending}
                        onClick={() =>
                          handleExport(
                            `/api/v1/admin/benefits/runs/${run.id}/export`,
                            `benefit-run-${run.id}.csv`,
                          )
                        }
                      >
                        <Download className="h-4 w-4" />
                        CSV
                      </Button>
                      {run.mode === 'live' && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={rollbackRun.isPending}
                          onClick={() => {
                            setRollbackTarget(run);
                            setRollbackReason('');
                          }}
                        >
                          <RotateCcw className="h-4 w-4" />
                          되돌리기
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <section className="rounded-lg bg-white p-4 shadow-sm">
        <h2 className="text-xl font-semibold leading-tight text-gray-900">
          설정 변경 기록
        </h2>
        <div className="mt-4 overflow-x-auto rounded-lg border border-gray-200">
          <Table>
            <TableHeader>
              <TableRow className="bg-[#F5F5F7]">
                <TableHead>작업</TableHead>
                <TableHead>사유</TableHead>
                <TableHead>작업자</TableHead>
                <TableHead>시각</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {changesQuery.isLoading && canUseShowtime &&
                Array.from({ length: 2 }).map((_, index) => (
                  <TableRow key={`benefit-change-skeleton-${index}`}>
                    <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-48" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                  </TableRow>
                ))}
              {!changesQuery.isLoading && !canUseShowtime && (
                <EmptyRow colSpan={4} message="회차 ID를 입력하면 변경 기록을 조회합니다." />
              )}
              {!changesQuery.isLoading && canUseShowtime && changes.length === 0 && (
                <EmptyRow colSpan={4} message="기록된 설정 변경이 없습니다." />
              )}
              {changes.map((change) => (
                <TableRow key={change.id}>
                  <TableCell>{change.action}</TableCell>
                  <TableCell className="max-w-[360px] break-words">
                    {change.reason ?? '-'}
                  </TableCell>
                  <TableCell className="max-w-[220px] truncate text-sm text-gray-600">
                    {change.actorUserId}
                  </TableCell>
                  <TableCell>{formatDateTime(change.changedAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <Dialog
        open={Boolean(rollbackTarget)}
        onOpenChange={(open) => {
          if (!open && !rollbackRun.isPending) {
            setRollbackTarget(null);
            setRollbackReason('');
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>혜택 설정 되돌리기</DialogTitle>
            <DialogDescription>
              선택한 live run 기준으로 현재 한정 혜택 부여 상태를 다시 적용합니다.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-lg bg-[#F5F5F7] p-3 text-sm">
              <p className="font-semibold text-gray-900">{rollbackTarget?.id}</p>
              <p className="mt-1 text-gray-600">
                {rollbackTarget ? formatDateTime(rollbackTarget.completedAt ?? rollbackTarget.startedAt) : '-'}
              </p>
            </div>
            <label className="space-y-1.5 text-sm font-semibold text-gray-700">
              <span>Rollback 사유</span>
              <Textarea
                value={rollbackReason}
                onChange={(event) => setRollbackReason(event.target.value)}
                placeholder="예: 직전 실행 결과로 복구"
              />
            </label>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={rollbackRun.isPending}
              onClick={() => {
                setRollbackTarget(null);
                setRollbackReason('');
              }}
            >
              취소
            </Button>
            <Button
              type="button"
              disabled={rollbackReason.trim().length === 0 || rollbackRun.isPending}
              onClick={handleRollback}
            >
              {rollbackRun.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RotateCcw className="h-4 w-4" />
              )}
              되돌리기
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function BenefitDraftEditor({
  draft,
  index,
  canRemove,
  onChange,
  onRemove,
}: {
  draft: BenefitDraft;
  index: number;
  canRemove: boolean;
  onChange: (patch: Partial<BenefitDraft>) => void;
  onRemove: () => void;
}) {
  return (
    <div
      data-testid={`benefit-draft-${index}`}
      className="rounded-lg border border-gray-200 bg-[#FDFDFE] p-3"
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Badge className={draft.kind === 'included'
            ? 'border-transparent bg-[#F3EFFF] text-[#6C3CE0]'
            : 'border-transparent bg-[#F0FDF4] text-[#15803D]'}
          >
            {draft.kind === 'included' ? 'ALL' : '한정'}
          </Badge>
          <select
            aria-label={`혜택 종류 ${index + 1}`}
            className="h-9 rounded-md border bg-white px-3 text-sm font-semibold"
            value={draft.kind}
            onChange={(event) =>
              onChange({
                kind: event.target.value as BenefitDraftKind,
                quantity:
                  event.target.value === 'limited' ? draft.quantity || '1' : '',
                selectionPriority:
                  event.target.value === 'limited'
                    ? draft.selectionPriority || '1'
                    : '',
              })
            }
          >
            <option value="included">ALL</option>
            <option value="limited">한정</option>
          </select>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!canRemove}
          onClick={onRemove}
        >
          <Trash2 className="h-4 w-4" />
          삭제
        </Button>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <label className="space-y-1.5 text-sm font-semibold text-gray-700">
          <span>혜택 identity</span>
          <Input
            value={draft.identity}
            onChange={(event) => onChange({ identity: event.target.value })}
            placeholder="benefit_6_to_1"
          />
        </label>
        <label className="space-y-1.5 text-sm font-semibold text-gray-700">
          <span>대상 등급</span>
          <Input
            value={draft.eligibleTierNames}
            onChange={(event) => onChange({ eligibleTierNames: event.target.value })}
            placeholder="SVIP, VIP"
          />
        </label>
        <label className="space-y-1.5 text-sm font-semibold text-gray-700">
          <span>혜택명</span>
          <Input
            value={draft.nameKo}
            onChange={(event) => onChange({ nameKo: event.target.value })}
            placeholder="6:1 이벤트 참여권"
          />
        </label>
        <label className="space-y-1.5 text-sm font-semibold text-gray-700">
          <span>상호 배제 identity</span>
          <Input
            value={draft.mutuallyExclusiveWith}
            onChange={(event) => onChange({ mutuallyExclusiveWith: event.target.value })}
            placeholder="benefit_polaroid"
          />
        </label>
        <label className="space-y-1.5 text-sm font-semibold text-gray-700 md:col-span-2">
          <span>혜택 설명</span>
          <Textarea
            value={draft.descriptionKo}
            onChange={(event) => onChange({ descriptionKo: event.target.value })}
            placeholder="현장 스캐너에서 사용 처리하는 혜택입니다."
          />
        </label>
        {draft.kind === 'limited' && (
          <>
            <label className="space-y-1.5 text-sm font-semibold text-gray-700">
              <span>수량</span>
              <Input
                type="number"
                min={1}
                value={draft.quantity}
                onChange={(event) => onChange({ quantity: event.target.value })}
              />
            </label>
            <label className="space-y-1.5 text-sm font-semibold text-gray-700">
              <span>선정 우선순위</span>
              <Input
                type="number"
                min={1}
                value={draft.selectionPriority}
                onChange={(event) => onChange({ selectionPriority: event.target.value })}
              />
            </label>
          </>
        )}
      </div>
    </div>
  );
}

function SummaryPill({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-gray-100 bg-[#F5F5F7] px-3 py-2">
      <p className="text-xs font-semibold text-gray-500">{label}</p>
      <p className="mt-1 text-lg font-semibold text-gray-900">{value}</p>
    </div>
  );
}

function EmptyRow({ colSpan, message }: { colSpan: number; message: string }) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="py-8 text-center text-sm text-gray-500">
        {message}
      </TableCell>
    </TableRow>
  );
}

function createBenefitDraft(kind: BenefitDraftKind): BenefitDraft {
  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `benefit-draft-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  return {
    localId: id,
    kind,
    identity: '',
    nameKo: '',
    descriptionKo: '',
    eligibleTierNames: '',
    quantity: kind === 'limited' ? '1' : '',
    selectionPriority: kind === 'limited' ? '1' : '',
    mutuallyExclusiveWith: '',
  };
}

function draftsFromConfiguration(configuration: BenefitConfiguration): BenefitDraft[] {
  return configuration.benefits.map((benefit) => ({
    localId: createBenefitDraft(benefit.kind).localId,
    kind: benefit.kind,
    identity: benefit.identity,
    nameKo: benefit.displayCopy.ko.name,
    descriptionKo: benefit.displayCopy.ko.description,
    eligibleTierNames: benefit.eligibleTierNames.join(', '),
    quantity: benefit.kind === 'limited' ? String(benefit.quantity) : '',
    selectionPriority:
      benefit.kind === 'limited' ? String(benefit.selectionPriority) : '',
    mutuallyExclusiveWith: benefit.mutuallyExclusiveWith.join(', '),
  }));
}

function buildBenefitDefinitions(
  drafts: BenefitDraft[],
): { ok: true; benefits: BenefitDefinition[] } | { ok: false; message: string } {
  const benefits: BenefitDefinition[] = [];

  for (const [index, draft] of drafts.entries()) {
    const identity = draft.identity.trim();
    const nameKo = draft.nameKo.trim();
    const descriptionKo = draft.descriptionKo.trim();
    const eligibleTierNames = splitCsv(draft.eligibleTierNames);
    const mutuallyExclusiveWith = splitCsv(draft.mutuallyExclusiveWith);

    if (!identity || !nameKo || !descriptionKo || eligibleTierNames.length === 0) {
      return {
        ok: false,
        message: `${index + 1}번째 혜택의 identity, 혜택명, 설명, 대상 등급을 입력하세요.`,
      };
    }

    const base = {
      identity,
      displayCopy: {
        ko: { name: nameKo, description: descriptionKo },
        en: { name: nameKo, description: descriptionKo },
        'zh-CN': { name: nameKo, description: descriptionKo },
        th: { name: nameKo, description: descriptionKo },
      },
      eligibleTierNames,
      mutuallyExclusiveWith,
    };

    if (draft.kind === 'included') {
      benefits.push({
        ...base,
        kind: 'included',
      });
      continue;
    }

    const quantity = Number(draft.quantity);
    const selectionPriority = Number(draft.selectionPriority);
    if (!Number.isInteger(quantity) || quantity < 1) {
      return { ok: false, message: `${index + 1}번째 한정 혜택 수량을 확인하세요.` };
    }
    if (!Number.isInteger(selectionPriority) || selectionPriority < 1) {
      return { ok: false, message: `${index + 1}번째 한정 혜택 우선순위를 확인하세요.` };
    }

    benefits.push({
      ...base,
      kind: 'limited',
      quantity,
      selectionPriority,
    });
  }

  return { ok: true, benefits };
}

function splitCsv(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatDateTime(value?: string | null): string {
  if (!value) {
    return '-';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Seoul',
  }).format(date);
}

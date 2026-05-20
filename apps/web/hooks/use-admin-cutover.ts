'use client';

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

export type CutoverGateState =
  | 'PASS'
  | 'FAIL'
  | 'ACCEPTED_RISK'
  | 'CONFIG_READY_NOT_DRILLED'
  | 'BLOCKED';

export interface AdminCutoverGateRow {
  gateId: string;
  requirementIds: string[];
  state: CutoverGateState;
  environment: string | null;
  evidenceRefs: string[];
  evidenceMissing: boolean;
  failureReason: string | null;
  approvalState: string;
  approver: string | null;
  approvalTimestamp: string | null;
  compensatingMonitoring: string | null;
  rollbackOrCloseTrigger: string | null;
  sourceDecisions: string[];
  redactionNotes: string | null;
  blocking: boolean;
  blockingReason: string | null;
}

export interface AdminCutoverGateSummary {
  generatedAt: string;
  ledgerGeneratedAt: string | null;
  source: {
    state: 'loaded' | 'blocked';
    runtimeArtifactRequired: boolean;
    reason: string | null;
  };
  rows: AdminCutoverGateRow[];
  countsByState: Record<CutoverGateState, number>;
  missingEvidenceCount: number;
  firstBlockingGate: AdminCutoverGateRow | null;
  finalEnableAllowed: boolean;
  redactionNotes: string[];
}

export function useAdminCutoverGates() {
  return useQuery({
    queryKey: ['admin', 'cutover'],
    queryFn: () =>
      apiClient.get<AdminCutoverGateSummary>('/api/v1/admin/cutover/gates'),
  });
}

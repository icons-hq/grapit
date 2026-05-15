'use client';

import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import { AdminSecuritySummary } from '@/components/admin/admin-security-summary';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  ADMIN_SECURITY_REQUIRED_CAPABILITY,
  useAdminSecurityStatus,
  useCreateAdminAllowlistRecord,
} from '@/hooks/use-admin-security';

const MFA_DEFERRED_COPY =
  'MFA는 아직 적용되지 않았습니다. 현재는 IP allowlist와 audit monitoring으로 운영합니다.';

export default function AdminSecurityPage() {
  const securityStatus = useAdminSecurityStatus();
  const createAllowlistRecord = useCreateAdminAllowlistRecord();
  const [cidr, setCidr] = useState('');
  const [label, setLabel] = useState('');
  const [source, setSource] = useState<'db_managed' | 'temporary_exception'>('db_managed');
  const [expiresAt, setExpiresAt] = useState('');
  const [reason, setReason] = useState('');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!cidr.trim() || !label.trim() || !reason.trim()) return;

    await createAllowlistRecord.mutateAsync(
      {
        cidr,
        label,
        source,
        reason,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
      },
      {
        onSuccess: () => {
          toast.success('IP allowlist 변경이 감사 로그와 함께 저장되었습니다.');
          setCidr('');
          setLabel('');
          setSource('db_managed');
          setExpiresAt('');
          setReason('');
        },
        onError: () => {
          toast.error('IP allowlist 변경에 실패했습니다.');
        },
      },
    );
  }

  return (
    <div className="space-y-6" data-required-capability={ADMIN_SECURITY_REQUIRED_CAPABILITY}>
      <div>
        <h1 className="text-display font-semibold leading-[1.2]">보안 운영</h1>
        <p className="mt-2 text-sm text-gray-600">{MFA_DEFERRED_COPY}</p>
      </div>

      <AdminSecuritySummary
        status={securityStatus.data}
        isLoading={securityStatus.isLoading}
        isError={securityStatus.isError}
      />

      <form
        onSubmit={handleSubmit}
        className="grid gap-4 rounded-lg bg-white p-4 shadow-sm lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_220px]"
      >
        <div className="space-y-2">
          <Label htmlFor="security-cidr">CIDR 또는 IP</Label>
          <Input
            id="security-cidr"
            value={cidr}
            onChange={(event) => setCidr(event.target.value)}
            placeholder="203.0.113.0/24"
            aria-label="CIDR 또는 IP"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="security-label">라벨</Label>
          <Input
            id="security-label"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Ops VPN"
            aria-label="라벨"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="security-source">유형</Label>
          <select
            id="security-source"
            value={source}
            onChange={(event) =>
              setSource(event.target.value as 'db_managed' | 'temporary_exception')
            }
            className="flex h-11 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <option value="db_managed">DB managed</option>
            <option value="temporary_exception">Temporary exception</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="security-expires-at">만료 시각</Label>
          <Input
            id="security-expires-at"
            type="datetime-local"
            value={expiresAt}
            onChange={(event) => setExpiresAt(event.target.value)}
            aria-label="만료 시각"
          />
        </div>
        <div className="space-y-2 lg:col-span-2">
          <Label htmlFor="security-reason">사유</Label>
          <Textarea
            id="security-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="허용 또는 예외 등록 사유"
            aria-label="사유"
            className="min-h-24"
          />
        </div>
        <div className="flex items-end">
          <Button
            type="submit"
            className="h-11 w-full"
            disabled={
              createAllowlistRecord.isPending ||
              !cidr.trim() ||
              !label.trim() ||
              !reason.trim()
            }
          >
            <Plus className="h-4 w-4" />
            allowlist 저장
          </Button>
        </div>
      </form>
    </div>
  );
}

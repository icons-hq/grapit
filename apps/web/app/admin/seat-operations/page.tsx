import { SeatOperationsPanel } from '@/components/admin/seat-operations-panel';

export default function AdminSeatOperationsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-display font-semibold leading-[1.2]">좌석 운영</h1>
        <p className="mt-2 text-sm text-gray-600">
          회차별 좌석 비활성화, 재활성화, 운영 이력을 한 곳에서 관리합니다.
        </p>
      </div>

      <SeatOperationsPanel />
    </div>
  );
}

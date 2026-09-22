import { AdminPatchNotesList } from '@/components/admin/admin-patch-notes';
import { adminPatchNotes } from '@/content/admin-patch-notes';

export default function AdminPatchNotesPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="mb-2 text-xl font-semibold text-gray-900">업데이트 내역</h1>
        <p className="text-xs text-gray-600">
          새 기능과 개선 사항을 확인하세요. 개발·검증 기록은 각 항목에 함께 남겼습니다.
        </p>
      </header>

      <AdminPatchNotesList notes={adminPatchNotes} />
    </div>
  );
}

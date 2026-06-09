import { AdminPatchNotesList } from '@/components/admin/admin-patch-notes';
import { adminPatchNotes } from '@/content/admin-patch-notes';

export default function AdminPatchNotesPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="mb-2 text-xl font-semibold text-gray-900">패치노트</h1>
        <p className="text-xs text-gray-600">
          PR 단위로 정리된 관리자 기능 개선과 검증 내역을 확인하세요
        </p>
      </header>

      <AdminPatchNotesList notes={adminPatchNotes} />
    </div>
  );
}

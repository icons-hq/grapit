import { AdminUserManagement } from '@/components/admin/admin-user-management';

export default function AdminUsersPage() {
  return (
    <div className="min-w-0 max-w-full space-y-6 overflow-x-hidden">
      <header>
        <h1 className="text-display font-semibold leading-[1.2]">회원 관리</h1>
        <p className="mt-2 break-words text-sm text-gray-600">
          회원을 검색해 인증 상태, 예매·문의 내역과 관리자 권한을 확인합니다.
        </p>
      </header>

      <AdminUserManagement />
    </div>
  );
}

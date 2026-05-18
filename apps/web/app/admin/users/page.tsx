import { AdminUserManagement } from '@/components/admin/admin-user-management';

export default function AdminUsersPage() {
  return (
    <div className="min-w-0 max-w-full space-y-6 overflow-x-hidden">
      <header>
        <h1 className="text-display font-semibold leading-[1.2]">회원 관리</h1>
        <p className="mt-2 break-words text-sm text-gray-600">
          회원 계정, 인증 상태, 예매·CS 이력, 권한 변경 감사 컨텍스트를 한 곳에서 확인합니다.
        </p>
      </header>

      <AdminUserManagement />
    </div>
  );
}

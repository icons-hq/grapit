import { SEAT_OPERATION_CAPABILITIES, resolveAdminCapabilitySnapshot, type AdminCapability } from '@grabit/shared';

export type AdminNavigationItem = {
  label: string;
  href: string;
  description: string;
  keywords?: string;
  capabilities?: readonly AdminCapability[];
};

/** Shared vocabulary and capability boundary for menus, breadcrumbs and shortcuts. */
export const ADMIN_NAVIGATION: Array<{ id: string; label: string; items: AdminNavigationItem[] }> = [
  { id: 'home', label: '홈', items: [
    { label: '운영 현황', href: '/admin', description: '오늘의 예매와 처리할 업무', keywords: '대시보드', capabilities: ['reservations.read'] },
  ] },
  { id: 'sales', label: '공연·예매', items: [
    { label: '공연 관리', href: '/admin/performances', description: '공연 등록, 판매 준비와 공개', capabilities: ['event.write'] },
    { label: '예매·취소', href: '/admin/bookings', description: '예매 검색, 결제 확인과 취소', keywords: '예매 관리 환불 결제', capabilities: ['reservations.read'] },
    { label: '정산 자료', href: '/admin/settlement', description: '결제·환불과 결제사 정산 대조', keywords: '내보내기 원장 PG', capabilities: ['settlement.export'] },
  ] },
  { id: 'field', label: '좌석·현장', items: [
    { label: '좌석 관리', href: '/admin/seat-operations', description: '판매 제한, 좌석 복구와 재판매', keywords: '좌석 운영', capabilities: SEAT_OPERATION_CAPABILITIES },
    { label: '특전 관리', href: '/admin/benefits', description: '회차별 특전 설정과 지급 결과', keywords: '혜택 추첨', capabilities: ['benefits.manage'] },
    { label: '입장 현황', href: '/admin/field-monitor', description: '현장 입장과 처리 결과 확인', keywords: '현장 모니터 QR 검표', capabilities: ['field.scan.verify'] },
  ] },
  { id: 'support', label: '고객·콘텐츠', items: [
    { label: '고객 문의', href: '/admin/operations', description: '미답변 문의, 환불 문의와 담당자', keywords: '운영 인박스 CS Q&A SLA', capabilities: ['support.manage'] },
    { label: '공지·자주 묻는 질문', href: '/admin/support-content', description: '고객에게 보여줄 안내 관리', keywords: 'FAQ 공지', capabilities: ['support.manage'] },
    { label: '홈 배너', href: '/admin/banners', description: '홈 화면의 공연 배너 관리', capabilities: ['banner.manage'] },
    { label: '번역 검수', href: '/admin/translations', description: '외국어 안내 검토와 게시', capabilities: ['event.write'] },
    { label: '회원 관리', href: '/admin/users', description: '회원 조회와 관리자 권한', capabilities: ['security.manage'] },
  ] },
  { id: 'settings', label: '설정·기록', items: [
    { label: '판매 시작 점검', href: '/admin/cutover', description: '판매 시작 전 확인 사항과 승인 기록', keywords: '컷오버 게이트 준비', capabilities: ['audit.read'] },
    { label: '개인정보 동의 기록', href: '/admin/consent-audit', description: '동의 항목과 시각 확인', keywords: '동의 감사', capabilities: ['audit.read'] },
    { label: '관리자 활동 기록', href: '/admin/audit', description: '누가 어떤 정보를 변경했는지 확인', keywords: '감사 로그', capabilities: ['audit.read'] },
    { label: '접근 보안', href: '/admin/security', description: '관리자 접속 허용과 보안 상태', keywords: '보안 설정 IP allowlist MFA', capabilities: ['security.manage'] },
    { label: '업데이트 내역', href: '/admin/patch-notes', description: '새 기능과 개선 사항', keywords: '패치노트' },
  ] },
];

export function isAdminPathActive(href: string, pathname: string) {
  return pathname === href || (href !== '/admin' && pathname.startsWith(`${href}/`));
}

export function adminLocation(pathname: string) {
  const group = ADMIN_NAVIGATION.find((group) => group.items.some((item) => isAdminPathActive(item.href, pathname)));
  return { group, item: group?.items.find((item) => isAdminPathActive(item.href, pathname)) };
}

export function canAccessAdminItem(item: AdminNavigationItem, snapshot: ReturnType<typeof resolveAdminCapabilitySnapshot>) {
  return !item.capabilities?.length || snapshot.superuser || item.capabilities.some((capability) => snapshot.capabilities.includes(capability));
}

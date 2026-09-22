/** Human-readable labels only. Unknown stored values remain available for investigation. */
export const ADMIN_CONTENT_LABELS: Record<string, string> = { performance: '공연', banner: '배너', notice: '공지', legal: '약관·정책' };
export const ADMIN_LOCALE_LABELS: Record<string, string> = { ko: '한국어', en: '영어', th: '태국어', 'zh-CN': '중국어' };
export const CONSENT_ITEM_LABELS: Record<string, string> = { terms: '서비스 이용약관', privacy: '개인정보 처리방침', pipa_required: '필수 개인정보 수집·이용', cross_border_transfer: '개인정보 국외 이전', pdpa_notice: '태국 개인정보 안내', pipl_notice: '중국 개인정보 안내', marketing: '마케팅 수신' };
export const CONSENT_FLOW_LABELS: Record<string, string> = { signup: '회원가입', social_completion: '간편가입 정보 입력', booking: '예매' };
export const CUTOVER_LABELS: Record<string, string> = {
  ADMIN_CUTOVER_UI: '관리자 점검 화면 확인', BOOKING_ENABLED_GO_NO_GO: '예매 시작 승인', CLEANUP_ISOLATION: '테스트 예매 정리',
  DR_CLOUD_SQL_PITR: '데이터베이스 복구 테스트', DR_VALKEY_RECONNECT: '좌석 잠금 장애 복구', FIRST_24H_WATCH: '판매 첫날 모니터링',
  LOAD_10K_BASELINE: '기본 동시 접속 테스트', LOAD_20K_STRESS: '최대 부하 테스트', M1_LOCALE_SCOPE: '언어별 예매 확인', ONCALL_PLAYBOOKS: '장애 대응 절차',
  TOSS_LIVE_KEY_SMOKE: '실제 결제 확인', TOSS_TEST_REHEARSAL: '테스트 결제 리허설', WAF_ACTIVE_RULES: '비정상 접속 차단 확인',
  DR_CLOUD_RUN_ROLLBACK: '이전 버전 복구 테스트', INFRA_HA_REPLICA: '데이터베이스 장애 대비', INFRA_POOL_PGBOUNCER: '데이터베이스 연결 관리',
  TOSS_TEST_SECRET_ROTATION: '테스트 결제 인증정보 교체', M1_DIRECT_DEPLOY_WATCH: '배포 후 동작 확인', QR_VISIBILITY: '구매자 QR 티켓 표시',
};
export function cutoverLabel(id: string) { return CUTOVER_LABELS[id] ?? id; }

export const ADMIN_PERFORMANCE_STATUS_LABELS = { selling: '판매 중', closing_soon: '마감 임박', upcoming: '판매 예정', ended: '판매 종료' } as const;

const en = {
  title: 'Optional visitor analytics', deletionPending: 'Collection has stopped. Deletion of earlier records is pending.', retry: 'Retry deletion',
  summary: 'Help us understand which announcements bring visitors and where booking becomes difficult. With your permission, we use a random browser ID to record page visits, campaign labels, device groups, booking steps, click/touch coordinates, screen dimensions, scrolling and masked session recordings, and connect them to your account after sign-in. Activity records are kept for up to 90 days and session replay for 14 days; statistics without identifiers for 1 year. You can refuse or withdraw without affecting signup or booking.',
  accept: 'Allow analytics', decline: 'Decline analytics', settings: 'Visitor analytics settings',
  details: 'Details and choices', accepted: 'Analytics allowed on this browser', declined: 'Analytics declined on this browser',
  signal: 'Your browser’s privacy signal takes priority. Analytics is disabled.',
  privacy: 'All text and input values in replay are masked. Passwords, payment details, QR identifiers, raw IPs and search text are excluded from analytics storage. Authorized administrators can see the existing account name and email after a verified sign-in links a session. Images, video, external frames and sensitive routes are excluded from replay. It does not send data to advertising platforms. Random identifiers linked to your account are personal data, not fully anonymous data.',
  storage: 'The choice and random visitor ID use localStorage (up to 90 days). The session uses sessionStorage and expires after 30 minutes without activity. You can change your choice here or clear browser storage. Declining stops collection and clears this browser’s analytics identifiers. Declining also requests deletion of this visitor’s earlier records and account links. If delivery fails, only the deletion request is retained for retry (up to 90 days). Completion is confirmed by the server. A hash blocking delayed re-collection is retained for up to 90 days. Contact privacy@heygrabit.com for further requests.',
};
const ko: typeof en = {
  title: '방문 분석 선택 동의', deletionPending: '수집을 중단했습니다. 기존 기록 삭제는 서버 확인을 기다리고 있습니다.', retry: '삭제 요청 재시도',
  summary: '공지 유입과 예매 과정의 불편을 파악하기 위해, 동의한 경우 무작위 브라우저 ID로 방문 페이지·캠페인·기기 구분·예매 단계·클릭/터치 좌표·화면 크기·스크롤·마스킹된 화면 재생 기록을 수집하고 로그인 후 회원 계정과 연결합니다. 행동 기록은 최대 90일, 화면 재생은 14일, 식별자 없는 통계는 1년 보관합니다. 거부·철회해도 가입과 예매를 이용할 수 있습니다.',
  accept: '분석 허용', decline: '분석 거부', settings: '방문 분석 설정', details: '자세한 내용·설정',
  accepted: '이 브라우저에서 분석을 허용했습니다', declined: '이 브라우저에서 분석을 거부했습니다',
  signal: '브라우저의 추적 거부 설정을 우선하여 분석을 중단합니다.',
  privacy: '화면 재생의 모든 텍스트·입력값은 가립니다. 비밀번호·결제정보·QR 식별자·원본 IP·검색어는 분석 저장소에서 제외하며 광고 매체에 전송하지 않습니다. 로그인 연결이 확인되면 권한 있는 관리자가 기존 회원 DB의 이름·이메일과 방문 기록을 함께 볼 수 있습니다. 이미지·영상·외부 결제창·민감 경로는 화면 재생에서 제외합니다. 회원 계정에 연결된 무작위 식별자는 완전 익명 정보가 아닌 연결 가능한 개인정보로 취급합니다.',
  storage: '선택과 무작위 방문자 ID는 localStorage에 최대 90일, 세션은 sessionStorage에 보관하며 30분간 활동이 없으면 만료됩니다. 이 화면에서 선택을 바꾸거나 브라우저 저장 정보를 삭제할 수 있습니다. 거부하면 수집을 중단하고 브라우저의 분석 식별자를 지웁니다. 거부와 함께 이 방문자의 기존 기록·회원 연결 삭제를 요청합니다. 전송 실패 시 삭제 요청만 최대 90일 보관해 재시도하며 서버 확인 후 완료합니다. 지연 도착 데이터의 재수집을 막는 해시는 최대 90일 보관합니다. 추가 요청은 privacy@heygrabit.com으로 문의해주세요.',
};
export function analyticsCopy(locale: string) { return locale === 'ko' ? ko : en; }

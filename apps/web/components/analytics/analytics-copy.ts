const en = {
  title: 'Optional visitor analytics', deletionPending: 'Collection has stopped. Deletion of earlier records is pending.', retry: 'Retry deletion',
  summary: 'Help us understand which announcements bring visitors and where booking becomes difficult. With your permission, we use a random browser ID to record page visits, campaign labels, device groups and booking steps, and connect them to your account after sign-in. Records are kept for up to 90 days; statistics without identifiers for 1 year. You can refuse or withdraw without affecting signup or booking.',
  accept: 'Allow analytics', decline: 'Decline analytics', settings: 'Visitor analytics settings',
  details: 'Details and choices', accepted: 'Analytics allowed on this browser', declined: 'Analytics declined on this browser',
  signal: 'Your browser’s privacy signal takes priority. Analytics is disabled.',
  privacy: 'No names, emails, phone numbers, raw IPs, search text, payment or QR identifiers, form contents, or session recordings are collected by this feature. It does not send data to advertising platforms. Random identifiers linked to your account are personal data, not fully anonymous data.',
  storage: 'The choice and random visitor ID use localStorage (up to 90 days). The session uses sessionStorage and expires after 30 minutes without activity. You can change your choice here or clear browser storage. Declining stops collection and clears this browser’s analytics identifiers. Declining also requests deletion of this visitor’s earlier records and account links. If delivery fails, only the deletion request is retained for retry (up to 90 days). Completion is confirmed by the server. A hash blocking delayed re-collection is retained for up to 90 days. Contact privacy@heygrabit.com for further requests.',
};
const ko: typeof en = {
  title: '방문 분석 선택 동의', deletionPending: '수집을 중단했습니다. 기존 기록 삭제는 서버 확인을 기다리고 있습니다.', retry: '삭제 요청 재시도',
  summary: '공지 유입과 예매 과정의 불편을 파악하기 위해, 동의한 경우 무작위 브라우저 ID로 방문 페이지·캠페인·기기 구분·예매 단계를 기록하고 로그인 후 회원 계정과 연결합니다. 기록은 최대 90일, 식별자 없는 통계는 1년 보관합니다. 거부·철회해도 가입과 예매를 이용할 수 있습니다.',
  accept: '분석 허용', decline: '분석 거부', settings: '방문 분석 설정', details: '자세한 내용·설정',
  accepted: '이 브라우저에서 분석을 허용했습니다', declined: '이 브라우저에서 분석을 거부했습니다',
  signal: '브라우저의 추적 거부 설정을 우선하여 분석을 중단합니다.',
  privacy: '이 기능은 이름·이메일·전화번호·원본 IP·검색어·결제 및 QR 식별자·입력 내용·화면 녹화를 수집하지 않으며 광고 매체에 전송하지 않습니다. 회원 계정에 연결된 무작위 식별자는 완전 익명 정보가 아닌 연결 가능한 개인정보로 취급합니다.',
  storage: '선택과 무작위 방문자 ID는 localStorage에 최대 90일, 세션은 sessionStorage에 보관하며 30분간 활동이 없으면 만료됩니다. 이 화면에서 선택을 바꾸거나 브라우저 저장 정보를 삭제할 수 있습니다. 거부하면 수집을 중단하고 브라우저의 분석 식별자를 지웁니다. 거부와 함께 이 방문자의 기존 기록·회원 연결 삭제를 요청합니다. 전송 실패 시 삭제 요청만 최대 90일 보관해 재시도하며 서버 확인 후 완료합니다. 지연 도착 데이터의 재수집을 막는 해시는 최대 90일 보관합니다. 추가 요청은 privacy@heygrabit.com으로 문의해주세요.',
};
const th: typeof en = {
  title: 'การวิเคราะห์การเข้าชม (ไม่บังคับ)', deletionPending: 'หยุดเก็บข้อมูลแล้ว กำลังรอยืนยันการลบข้อมูลเดิม', retry: 'ลองลบอีกครั้ง',
  summary: 'หากคุณยินยอม เราจะใช้รหัสเบราว์เซอร์แบบสุ่มบันทึกหน้าที่เข้าชม แคมเปญ ประเภทอุปกรณ์ และขั้นตอนการจอง แล้วเชื่อมโยงกับบัญชีเมื่อเข้าสู่ระบบ เพื่อปรับปรุงการประกาศและการจอง เก็บข้อมูลไม่เกิน 90 วัน และสถิติที่ไม่มีรหัสระบุตัวตน 1 ปี คุณปฏิเสธหรือถอนความยินยอมได้โดยยังสมัครและจองได้ตามปกติ',
  accept: 'อนุญาต', decline: 'ปฏิเสธ', settings: 'ตั้งค่าการวิเคราะห์', details: 'รายละเอียดและการตั้งค่า',
  accepted: 'อนุญาตการวิเคราะห์ในเบราว์เซอร์นี้', declined: 'ปฏิเสธการวิเคราะห์ในเบราว์เซอร์นี้', signal: 'การตั้งค่าความเป็นส่วนตัวของเบราว์เซอร์มีลำดับความสำคัญสูงกว่า การวิเคราะห์ถูกปิด',
  privacy: en.privacy, storage: en.storage,
};
const zh: typeof en = {
  title: '访问分析（可选）', deletionPending: '已停止收集，正在等待服务器确认删除旧记录。', retry: '重试删除', summary: '经您同意，我们使用随机浏览器标识记录访问页面、推广活动、设备类别及预订步骤，并在登录后与账号关联，用于了解公告效果和改善预订体验。原始记录最多保留90天，不含标识的统计保留1年。拒绝或撤回不影响注册和预订。',
  accept: '允许分析', decline: '拒绝分析', settings: '访问分析设置', details: '详情与设置', accepted: '已允许此浏览器的访问分析', declined: '已拒绝此浏览器的访问分析', signal: '优先遵循浏览器的隐私信号，访问分析已停止。',
  privacy: en.privacy, storage: en.storage,
};
export function analyticsCopy(locale: string) { return locale === 'ko' ? ko : locale === 'th' ? th : locale.startsWith('zh') ? zh : en; }

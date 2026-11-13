const ko = {
  title: '나의 관심 취향', subtitle: '좋아하는 것을 알려주세요. 다음 공연과 혜택을 준비하는 데 참고할게요.',
  invitation: '좋아하는 아티스트와 관심 활동을 선택해보세요.', invitationAction: '취향 설정',
  artist: '좋아하는 아티스트', activity: '평소 즐기는 활동', benefit: '관심 있는 소식과 혜택',
  optional: '모두 선택사항 · 질문별 최대 5개', none: '선택할 항목을 준비하고 있어요.',
  consent: '선택한 취향의 수집·이용에 동의합니다. (선택)',
  purpose: '선택한 아티스트·활동·혜택과 회원 ID로 관심 프로필을 만들어 맞춤 공연·혜택 추천 및 마케팅 기획에 이용합니다. 권한 있는 관리자가 확인할 수 있습니다. 마지막 저장일부터 90일간 보관하며, 철회·탈퇴 시 프로필과 선택값을 삭제합니다. 동의 증빙은 90일 보관합니다. 동의하지 않아도 가입과 예매를 이용할 수 있습니다.',
  behavior: '동의 이후의 공연 조회·찜·예매 기록으로 관심 분석을 보완합니다. (선택)',
  behaviorHint: '방문 기록은 별도의 방문 분석에 동의한 경우에만 연결합니다. 이전 행동은 소급해 이용하지 않으며, 최근 90일 기록만 참고합니다. 이 선택을 끄면 행동 추정을 중단합니다.',
  marketing: '이메일·문자 발송은 별도의 마케팅 수신 동의에 따릅니다.', marketingSettings: '수신 설정 확인',
  save: '동의하고 저장', saving: '저장 중…', saved: '취향을 저장했어요.',
  withdraw: '취향 동의 철회·삭제', withdrawn: '취향과 관심 프로필을 삭제했어요.', skip: '나중에 할게요',
  error: '불러오거나 저장하지 못했습니다. 잠시 후 다시 시도해주세요.', retry: '다시 시도', loading: '취향 불러오는 중', expires: '보관 만료일',
};
type AudienceCopy = { [K in keyof typeof ko]: string };
const en: AudienceCopy = {
  title: 'Your interests', subtitle: 'Tell us what you enjoy to help us plan shows and benefits for you.',
  invitation: 'Choose your favourite artists and activities.', invitationAction: 'Set interests',
  artist: 'Favourite artists', activity: 'Activities you enjoy', benefit: 'News and benefits you like',
  optional: 'All optional · Up to 5 per question', none: 'Options are coming soon.',
  consent: 'I consent to the collection and use of my selected interests. (Optional)',
  purpose: 'We use your selected artists, activities, benefits and member ID to create an interest profile for personalised show/benefit recommendations and marketing planning. Authorised administrators can view it. Choices and profiles are kept for 90 days after the last save and deleted on withdrawal or account closure. Consent receipts are kept for 90 days. Declining does not affect signup or booking.',
  behavior: 'Use show views, saved shows and bookings after this consent to improve interest analysis. (Optional)',
  behaviorHint: 'Visits are linked only with separate visitor-analytics consent. Earlier activity is not reused. Only the last 90 days are considered. Turning this off stops behavioural inference.',
  marketing: 'Emails and SMS require separate marketing-message consent.', marketingSettings: 'Review message settings',
  save: 'Agree and save', saving: 'Saving…', saved: 'Your interests are saved.', withdraw: 'Withdraw and delete interests', withdrawn: 'Your interests and profile have been deleted.', skip: 'Maybe later',
  error: 'Could not load or save. Please try again.', retry: 'Try again', loading: 'Loading interests', expires: 'Retained until',
};
const th: AudienceCopy = { ...en,
  title: 'ความสนใจของคุณ', subtitle: 'บอกสิ่งที่คุณชอบ เพื่อช่วยเตรียมการแสดงและสิทธิพิเศษสำหรับคุณ', invitation: 'เลือกศิลปินและกิจกรรมที่คุณชอบ', invitationAction: 'ตั้งค่าความสนใจ',
  artist: 'ศิลปินที่ชื่นชอบ', activity: 'กิจกรรมที่ชอบ', benefit: 'ข่าวสารและสิทธิพิเศษที่สนใจ', optional: 'ไม่บังคับ · เลือกได้สูงสุด 5 ข้อต่อคำถาม', none: 'กำลังเตรียมตัวเลือก',
  save: 'ยอมรับและบันทึก', saving: 'กำลังบันทึก…', saved: 'บันทึกความสนใจแล้ว', withdraw: 'ถอนความยินยอมและลบความสนใจ', withdrawn: 'ลบความสนใจและโปรไฟล์แล้ว', skip: 'ไว้ทีหลัง',
  error: 'ไม่สามารถโหลดหรือบันทึกได้ โปรดลองอีกครั้ง', retry: 'ลองอีกครั้ง', loading: 'กำลังโหลดความสนใจ', expires: 'เก็บไว้ถึง',
};
const zh: AudienceCopy = { ...en,
  title: '我的兴趣偏好', subtitle: '告诉我们你喜欢什么，帮助我们准备演出与福利。', invitation: '选择你喜欢的艺人与活动。', invitationAction: '设置兴趣',
  artist: '喜欢的艺人', activity: '平时喜欢的活动', benefit: '感兴趣的消息与福利', optional: '均为选填 · 每题最多选5项', none: '选项准备中。',
  consent: '我同意收集和使用所选兴趣。（可选）',
  purpose: '我们将使用您选择的艺人、活动、福利及会员ID建立兴趣档案，用于个性化演出与福利推荐及营销策划，授权管理员可查看。选择和档案保存至最后一次保存后的90天，撤回同意或注销后删除。同意记录保存90天。不接受不影响注册和购票。',
  behavior: '使用同意后的演出浏览、收藏和购票记录辅助兴趣分析。（可选）', behaviorHint: '浏览记录仅在另行同意访问分析后关联，不追溯此前行为，仅参考最近90天。关闭此选项将停止行为推测。',
  marketing: '电子邮件及短信须另行获得营销接收同意。', marketingSettings: '查看接收设置',
  save: '同意并保存', saving: '保存中…', saved: '已保存兴趣。', withdraw: '撤回同意并删除兴趣', withdrawn: '已删除兴趣及档案。', skip: '以后再说', error: '加载或保存失败，请重试。', retry: '重试', loading: '正在加载兴趣', expires: '保留至',
};
export function getAudienceCopy(locale: string): AudienceCopy { return locale === 'ko' ? ko : locale === 'th' ? th : locale.startsWith('zh') ? zh : en; }

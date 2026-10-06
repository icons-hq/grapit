-- Privacy policy v1.2 (effective 2026-05-11) consent rows. Additive only: the
-- 2026-04-28 rows stay active so pages opened before the web release can still
-- submit them. Retire them in a separate, later release (consent version runbook).
INSERT INTO "consent_items"
  ("key", "version", "locale", "title", "body", "is_required", "is_active")
VALUES
  ('privacy', '2026-05-11', 'ko', '개인정보처리방침', 'Grabit 개인정보 처리방침에 따른 개인정보 처리에 동의합니다.', true, true),
  ('pipa_required', '2026-05-11', 'ko', '개인정보 필수 수집 및 이용', '회원 가입, 본인 확인, 예매 처리를 위한 필수 개인정보 수집 및 이용에 동의합니다.', true, true),
  ('privacy', '2026-05-11', 'en', 'Privacy Policy', 'I agree to Grabit processing personal data under the Privacy Policy.', true, true),
  ('pipa_required', '2026-05-11', 'en', 'Required Personal Data Collection and Use', 'I agree to required personal data collection and use for sign-up, identity verification, and booking.', true, true),
  ('privacy', '2026-05-11', 'th', 'นโยบายความเป็นส่วนตัว', 'ฉันยอมรับการประมวลผลข้อมูลส่วนบุคคลของ Grabit ตามนโยบายความเป็นส่วนตัว', true, true),
  ('pipa_required', '2026-05-11', 'th', 'การเก็บและใช้ข้อมูลส่วนบุคคลที่จำเป็น', 'ฉันยอมรับการเก็บและใช้ข้อมูลส่วนบุคคลที่จำเป็นสำหรับการสมัคร ยืนยันตัวตน และการจอง', true, true),
  ('privacy', '2026-05-11', 'zh-CN', '隐私政策', '我同意 Grabit 根据隐私政策处理个人信息。', true, true),
  ('pipa_required', '2026-05-11', 'zh-CN', '必要个人信息收集和使用', '我同意为注册、身份验证和预订所必需的个人信息收集和使用。', true, true)
ON CONFLICT ("key", "version", "locale") DO NOTHING;

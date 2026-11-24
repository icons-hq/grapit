-- Publish translations of the two existing, public analytics announcements.
-- Preserve editorial changes, unpublished notices, and prior locale-specific decisions.
DO $migration$
DECLARE
  item record;
  source_notice support_notices%ROWTYPE;
  group_id uuid;
BEGIN
  FOR item IN SELECT * FROM (VALUES
      ('447232b6-e24c-416c-bd2a-033495088899', '76e58db5-6518-4fd3-9986-b341497dbd68', 'c6c96c8a595e1e9fa5d72998a9b185d945e9991ed5e2e252f127b777e713872c', '0d6e28e7a97a9af8df07ce484d1a478ca4c3d3101fd5af2715d2c6bc7623dc32', 'th', 'ประกาศเรื่องการวิเคราะห์ผู้เยี่ยมชมและการเล่นเซสชันย้อนหลังแบบเลือกได้ (12 พฤศจิกายน 2026)', 'Grabit มีตัวเลือกวิเคราะห์เพื่อดูว่าผู้ชมเข้ามาจากประกาศใดและปรับปรุงประสบการณ์สมัครสมาชิกและจองบัตร

เมื่อคุณยินยอมแยกกันทั้งการเก็บและใช้ข้อมูล และการโอนข้อมูลไปต่างประเทศ เราจึงใช้รหัสเบราว์เซอร์และเซสชันแบบสุ่มบันทึกหน้าที่เข้าชม ป้ายแคมเปญ กลุ่มอุปกรณ์ ขั้นตอนการจอง ตำแหน่งคลิกหรือแตะ ขนาดหน้าจอ การเลื่อน และการเล่นเซสชันย้อนหลังโดยปกปิดข้อมูล หลังเข้าสู่ระบบและยืนยันตัวตน ประวัติการเข้าชมจะเชื่อมกับบัญชีและผู้ดูแลที่มีสิทธิสามารถดูพร้อมข้อมูลสมาชิกที่มีอยู่ได้

กิจกรรมและการเชื่อมบัญชีเก็บไม่เกิน 90 วัน การเล่นย้อนหลังเก็บ 14 วัน สถิติที่ไม่มีตัวระบุเก็บ 1 ปี ข้อความบนหน้าจอและค่าที่กรอกจะถูกปกปิด ไม่มีการเก็บรหัสผ่าน ข้อมูลชำระเงิน ตัวระบุ QR หรือคำค้นในคลังวิเคราะห์ ภาพ วิดีโอ และเฟรมชำระเงินภายนอกไม่รวมในการเล่นย้อนหลัง และข้อมูลไม่ส่งให้แพลตฟอร์มโฆษณา

การปฏิเสธหรือถอนความยินยอมไม่กระทบการสมัคร เข้าสู่ระบบ หรือจองบัตร เมื่อถอน ระบบจะหยุดเก็บและขอลบกิจกรรม การเล่นย้อนหลัง และการเชื่อมบัญชีเดิมของเบราว์เซอร์นี้ ไม่นำการเข้าชมเดิมหรือความยินยอมรับการตลาดเดิมมาใช้ย้อนหลัง

ฟังก์ชันนี้เริ่มหลังคุณให้ความยินยอมตามรายละเอียด โปรดอ่านประกาศแยกต่างหากคู่กับนโยบายความเป็นส่วนตัว ดูประเภทข้อมูล ผู้รับและประเทศที่ Google Cloud ประมวลผล ระยะเวลาเก็บ การสำรองและลบข้อมูล และการตั้งค่าได้ที่
https://heygrabit.com/th/legal/analytics

ติดต่อ privacy@heygrabit.com'),
      ('447232b6-e24c-416c-bd2a-033495088899', '76e58db5-6518-4fd3-9986-b341497dbd68', 'c6c96c8a595e1e9fa5d72998a9b185d945e9991ed5e2e252f127b777e713872c', '0d6e28e7a97a9af8df07ce484d1a478ca4c3d3101fd5af2715d2c6bc7623dc32', 'zh-CN', '可选访客分析与会话回放告知（2026年11月12日）', 'Grabit 提供可选的访客分析功能，用于了解公告带来的访问以及改进注册和订票体验。

仅在您分别同意收集、使用和跨境传输后，我们才通过随机浏览器及会话标识记录访问页面、活动标签、设备类别、订票步骤、点击或触摸位置、屏幕尺寸、滚动及遮蔽后的会话回放。验证登录后会关联账户，获授权管理员可以结合已有会员信息查看访问记录。

活动及账户关联记录最长保存90天，回放14天，无标识符的统计数据1年。屏幕文本和输入值均被遮蔽。密码、支付详情、二维码标识和搜索词不进入分析存储。图像、视频及外部支付框架不纳入回放。数据不会发送至广告平台。

拒绝或撤回不影响注册、登录或订票。撤回会停止收集，并请求删除此浏览器先前的活动、回放及账户关联。不会追溯利用先前的访问记录或既有营销信息接收同意。

此新功能自您详细了解并同意时起适用。请结合主要服务隐私政策阅读单独告知。数据类别、Google Cloud 的接收方、国家和保存期限、备份与删除及相关设置详见
https://heygrabit.com/zh-CN/legal/analytics

联系邮箱 privacy@heygrabit.com'),
      ('d3520150-ae51-4b8a-a7b5-43d7c7d29ccf', '8516d2aa-0aee-42bc-a85c-ced0379f7ed5', 'e79b1ce930729c91fa06119d3b4b54d2aa0da367c3778be8129d41926d65fd5e', 'e9f989919c1735b35eacea26e1b3d308a2d5be013699259d0e0023cfb05cc529', 'th', 'ประกาศเรื่องการนับจำนวนครั้งการใช้บริการ (12 พฤศจิกายน 2026)', 'ตั้งแต่ 12 พฤศจิกายน 2026 Grabit รวมจำนวนการใช้หน้าสาธารณะและการทำรายการที่กำหนดเป็นรายชั่วโมงเพื่อปรับปรุงบริการ

การนับครอบคลุมการแสดงหน้า เริ่มสมัคร จอง หรือชำระเงิน เข้าคิว เลือกที่นั่ง คลิกลิงก์ เลื่อนถึง 75% และเปิดหน้าอย่างน้อย 30 วินาที ประเภทหน้ารวมถึงหน้าหลัก การแสดง การจอง เข้าสู่ระบบหรือสมัครสมาชิก และค้นหา

ตัวนับไม่เก็บรหัสผู้เยี่ยมชม เซสชัน สมาชิก หรือเหตุการณ์ URL จริง ข้อมูลที่กรอก แหล่งที่มา หรือข้อมูลอุปกรณ์ เราไม่เก็บประวัติเหตุการณ์รายครั้งหรือเส้นทางรายบุคคล และไม่ส่งยอดให้แพลตฟอร์มโฆษณา ยอดรวมรายชั่วโมงเก็บไม่เกิน 365 วัน

คุณปิดการนับได้ทุกเมื่อผ่านการตั้งค่าการวิเคราะห์ผู้เยี่ยมชมที่ส่วนท้ายของเว็บไซต์ (https://heygrabit.com/th/legal/analytics) การปฏิเสธไม่กระทบการสมัคร เข้าสู่ระบบ หรือจองบัตร เรายังเคารพสัญญาณความเป็นส่วนตัวของเบราว์เซอร์ ระบบเก็บเฉพาะค่าเปิดหรือปิดบนเบราว์เซอร์นี้จนกว่าคุณเปลี่ยนหรือล้างข้อมูลเว็บไซต์

บันทึกการเข้าถึงเพื่อความปลอดภัยและให้บริการ รวมทั้งข้อมูลสมาชิก การจอง และการชำระเงิน อยู่ภายใต้นโยบายความเป็นส่วนตัวแยกต่างหาก ยอดนับไม่ได้แสดงจำนวนบุคคลไม่ซ้ำหรืออัตราการเปลี่ยนเป็นการซื้อรายบุคคล

ติดต่อ privacy@heygrabit.com'),
      ('d3520150-ae51-4b8a-a7b5-43d7c7d29ccf', '8516d2aa-0aee-42bc-a85c-ced0379f7ed5', 'e79b1ce930729c91fa06119d3b4b54d2aa0da367c3778be8129d41926d65fd5e', 'e9f989919c1735b35eacea26e1b3d308a2d5be013699259d0e0023cfb05cc529', 'zh-CN', '服务使用次数统计告知（2026年11月12日）', '自2026年11月12日起，Grabit 按小时汇总公开页面类别及特定操作的次数，以改进服务。

统计项目包括页面展示、开始注册、订票或结账、进入队列、选座、点击链接、滚动至75%以及页面展示至少30秒。页面类别包括首页、演出、订票、登录或注册和搜索。

计数器不存储访客、会话、会员或事件标识、实际网址、表单内容、来源或设备信息。我们不保留逐项事件记录或个人访问轨迹，也不会向广告平台发送计数。按小时汇总的结果最多保存365天。

您可随时在页脚的访客分析设置（https://heygrabit.com/zh-CN/legal/analytics）中关闭计数。拒绝不影响注册、登录或订票。我们遵循浏览器隐私信号。浏览器仅保存开关状态，直至您修改或清除站点数据。

既有安全和服务访问日志，以及会员、订票和支付信息，按现行隐私政策另行处理。计数不代表独立访客数或个人转化率。

联系邮箱 privacy@heygrabit.com')
  ) AS translations(ko_id, en_id, ko_hash, en_hash, language, title, body)
  LOOP
    SELECT en.* INTO source_notice
    FROM support_notices en JOIN support_notices ko ON ko.id = item.ko_id::uuid
    WHERE en.id = item.en_id::uuid AND ko.locale = 'ko' AND en.locale = 'en'
      AND ko.archived_at IS NULL AND en.archived_at IS NULL
      AND ko.status = 'published' AND en.status = 'published'
      AND ko.review_state = 'published' AND en.review_state = 'published'
      AND encode(sha256(convert_to(ko.title || chr(10) || ko.body, 'UTF8')), 'hex') = item.ko_hash
      AND encode(sha256(convert_to(en.title || chr(10) || en.body, 'UTF8')), 'hex') = item.en_hash;
    IF NOT FOUND THEN CONTINUE; END IF;

    SELECT coalesce(translation_group_id, source_notice.translation_group_id, id)
      INTO group_id FROM support_notices WHERE id = item.ko_id::uuid;
    UPDATE support_notices SET translation_group_id = group_id
      WHERE id IN (item.ko_id::uuid, source_notice.id) AND translation_group_id IS NULL;
    INSERT INTO support_notices
      (locale, title, body, category, priority, status, review_state, translation_use,
       translation_group_id, starts_at, ends_at, reviewed_at, published_at)
    SELECT item.language::locale, item.title, item.body, source_notice.category,
      source_notice.priority, 'published', 'published', 'manual', group_id,
      source_notice.starts_at, source_notice.ends_at, now(), source_notice.published_at
    WHERE NOT EXISTS (
      SELECT 1 FROM support_notices WHERE locale = item.language::locale
        AND translation_group_id IN (group_id, source_notice.translation_group_id)
    );
  END LOOP;
END
$migration$;
--> statement-breakpoint
-- Enrich only the audited artwork. Preserve image order, all editorial fields,
-- any newer captions and every unrelated event.
WITH captions(performance_id, image_url, original_alt, translations) AS (
  VALUES
    ('575e8ff0-cd16-4c00-9edc-d72f54bffa9d'::uuid, 'https://cdn.heygrabit.com/performance-detail/aedf443e-b34b-4b25-a3b4-bfdc9d4a32f1.jpg', 'NAMTANFILM Fan Meeting in Seoul 공식 포스터. 2027년 2월 13일 오후 3시, 큐브컨벤션센터', '{"en": "Official NAMTANFILM Fan Meeting in Seoul poster. February 13, 2027, 3:00 p.m. KST at CUBE CONVENTION CENTER.", "th": "โปสเตอร์ทางการ NAMTANFILM Fan Meeting in Seoul วันที่ 13 กุมภาพันธ์ 2027 เวลา 15:00 น. ตามเวลาเกาหลี ที่ CUBE CONVENTION CENTER", "zh-CN": "NAMTANFILM 首尔粉丝见面会官方海报。2027年2月13日下午3点（韩国时间），CUBE 会议中心。"}'::jsonb),
    ('575e8ff0-cd16-4c00-9edc-d72f54bffa9d'::uuid, 'https://cdn.heygrabit.com/performance-detail/466ab046-dda3-491c-983c-602cf0c6cb61.jpg', '남딴필름 등급별 베네핏. SVIP 380,000원·VIP 260,000원. 사운드체크와 하이터치는 전 등급 공통이며, 추가 PHOTO 2:1은 SVIP 150,000원, 추가 하이터치는 전 등급 80,000원입니다.', '{"en": "SVIP KRW 380,000 · VIP KRW 260,000. Both include soundcheck, hi-touch, an official poster and postcard. All SVIP tickets include PHOTO 2:4, and 30 SVIP holders are drawn for PHOTO 2:1. All VIP tickets include PHOTO 2:8. Pre-signed poster draw: 230 SVIP and 70 VIP. Pre-signed Polaroid draw: 33 SVIP and 7 VIP. Paid extras: PHOTO 2:1 for SVIP only (KRW 150,000), hi-touch for either tier (KRW 80,000).", "th": "SVIP 380,000 วอน และ VIP 260,000 วอน ทุกบัตรได้ซาวด์เช็ก ไฮทัช โปสเตอร์และโปสการ์ดทางการ SVIP ทุกคนได้ PHOTO 2:4 และสุ่ม 30 คนรับ PHOTO 2:1 ส่วน VIP ทุกคนได้ PHOTO 2:8 สุ่มโปสเตอร์พร้อมลายเซ็น SVIP 230 คน และ VIP 70 คน สุ่มโพลารอยด์พร้อมลายเซ็น SVIP 33 คน และ VIP 7 คน สิทธิ์เสริมแบบชำระเงิน PHOTO 2:1 เฉพาะ SVIP 150,000 วอน หรือไฮทัชทุกประเภทบัตร 80,000 วอน", "zh-CN": "SVIP 380,000韩元，VIP 260,000韩元。两档均含彩排、击掌、官方海报及明信片。全部 SVIP 含 PHOTO 2:4，另抽30名参加 PHOTO 2:1。全部 VIP 含 PHOTO 2:8。预签海报抽取230名 SVIP 和70名 VIP；预签拍立得抽取33名 SVIP 和7名 VIP。付费加购：PHOTO 2:1 限 SVIP，150,000韩元；击掌两档均可，80,000韩元。"}'::jsonb),
    ('575e8ff0-cd16-4c00-9edc-d72f54bffa9d'::uuid, 'https://cdn.heygrabit.com/performance-detail/508d56ac-f006-459f-b28f-bf0b2f4da7f8.jpg', '남딴필름 좌석 배치도. 무대 앞쪽 분홍색은 SVIP석 380,000원, 뒤쪽 보라색은 VIP석 260,000원이며 뒤쪽 중앙은 콘솔입니다.', '{"en": "Seating plan. Pink seats nearest the stage are SVIP (KRW 380,000). Purple seats toward the back are VIP (KRW 260,000). The control booth is at the back in the center.", "th": "ผังที่นั่ง โซนสีชมพูหน้าเวทีเป็น SVIP ราคา 380,000 วอน โซนสีม่วงด้านหลังเป็น VIP ราคา 260,000 วอน จุดควบคุมอยู่กึ่งกลางด้านหลัง", "zh-CN": "座位图。靠近舞台的粉色区域为 SVIP（380,000韩元），后方紫色区域为 VIP（260,000韩元），控制台位于后方中央。"}'::jsonb),
    ('575e8ff0-cd16-4c00-9edc-d72f54bffa9d'::uuid, 'https://cdn.heygrabit.com/performance-detail/7561d178-de83-4274-b4df-4e93ce2a4d3a.jpg', '큐브컨벤션센터 오시는 길. 서울 마포구 상암산로 34 디지털큐브빌딩 3층, 디지털미디어시티역 9번 출구에서 945m. 주변 지도와 버스 노선 안내.', '{"en": "CUBE CONVENTION CENTER, 3F Digital Cube, 34 Sangamsan-ro, Mapo-gu, Seoul. Walk 945 m from Exit 9 of Digital Media City Station (Line 6, Airport Railroad or Gyeongui–Jungang Line). Buses from Jongno, Gwanghwamun or Seoul Station: 171, 172, 271, 470. From Sinchon or Hapjeong: 171, 271, 710. From Gangnam or Yangjae: 470.", "th": "CUBE CONVENTION CENTER ชั้น 3 อาคาร Digital Cube เลขที่ 34 ถนน Sangamsan-ro เขตมาโพ โซล จากสถานี Digital Media City ทางออก 9 เดิน 945 เมตร (สาย 6 รถไฟสนามบิน หรือสาย Gyeongui–Jungang) รถประจำทางจาก Jongno, Gwanghwamun หรือสถานี Seoul ใช้สาย 171, 172, 271, 470 จาก Sinchon หรือ Hapjeong ใช้ 171, 271, 710 จาก Gangnam หรือ Yangjae ใช้ 470", "zh-CN": "CUBE 会议中心位于首尔麻浦区 Sangamsan-ro 34号 Digital Cube 大厦3层。数码媒体城站9号出口步行945米（地铁6号线、机场铁路、京义中央线）。从钟路、光化门或首尔站方向乘171、172、271、470路；新村或合井方向乘171、271、710路；江南或良才方向乘470路。"}'::jsonb),
    ('575e8ff0-cd16-4c00-9edc-d72f54bffa9d'::uuid, 'https://cdn.heygrabit.com/performance-detail/74b6b4ac-b98a-4a61-94d0-2a4b9a74f48c.png', '남딴필름 예매 관련 안내. 1인 최대 4매, 전석 지정석, 티켓과 함께 구매 가능한 PHOTO 2:1·HI TOUCH 수량 및 취소·환불 안내', '{"en": "Up to 4 tickets per person. All seats are reserved and must be selected when booking. Limited add-ons are offered with ticket booking, first come, first served. Each SVIP ticket can add one PHOTO 2:1. Each ticket can add up to four HI TOUCH options. Counterfeit tickets and ticket scalping are strictly prohibited. Cancellation and refunds follow Korea Fair Trade Commission standards as listed on the Grabit event detail page.", "th": "จองได้สูงสุดคนละ 4 ใบ ทุกบัตรเป็นแบบระบุที่นั่ง ต้องเลือกที่นั่งตอนจอง สิทธิ์เสริมมีจำนวนจำกัด ซื้อพร้อมบัตรตามลำดับก่อนหลัง บัตร SVIP แต่ละใบเพิ่ม PHOTO 2:1 ได้ 1 สิทธิ์ บัตรแต่ละใบเพิ่ม HI TOUCH ได้สูงสุด 4 สิทธิ์ ห้ามปลอมบัตรหรือขายบัตรเก็งกำไร การยกเลิกและคืนเงินเป็นไปตามมาตรฐานของคณะกรรมการการค้าที่เป็นธรรมแห่งเกาหลี ตามที่ประกาศบนหน้ารายละเอียดการแสดงของ Grabit", "zh-CN": "每人最多可订4张，全部为指定座位，订票时必须选座。加购权益数量有限，与门票一同购买，先到先得。每张 SVIP 可加购1份 PHOTO 2:1，每张门票最多可加购4份 HI TOUCH。严禁伪造或倒卖门票。取消及退款按韩国公平交易委员会的标准办理，具体规定见 Grabit 演出详情页。"}'::jsonb),
    ('18a3bcc6-5e75-463d-abfd-634601328754'::uuid, 'https://cdn.heygrabit.com/performance-detail/126f35ed-8228-40f8-a501-944334e64a28.png', NULL, '{"en": "Girl Rules Fan Meeting in Seoul, July 4, 2026 at 3 p.m. KST. Tickets were sold exclusively through Grabit. Unauthorized transactions may be subject to legal penalties and are at the buyer’s own risk. All seats are reserved. SVIP KRW 360,000, VIP KRW 240,000, R KRW 190,000, S KRW 80,000. The seating diagram is illustrative and staging may change. Kwangwoon University Donghae Culture and Arts Center, 20 Gwangun-ro, Nowon-gu, Seoul. Subway: Kwangwoon University (Line 1) or Seokgye (Line 6). Buses: 261, 173, 1017, 1130, 1137, 1140. Public transport is recommended. Traffic or parking delays and missed attendance do not qualify for cancellation or refund.", "th": "Girl Rules Fan Meeting in Seoul วันที่ 4 กรกฎาคม 2026 เวลา 15:00 น. ตามเวลาเกาหลี บัตรจำหน่ายผ่าน Grabit เท่านั้น การซื้อผ่านช่องทางที่ไม่ได้รับอนุญาตอาจมีโทษตามกฎหมาย ผู้ซื้อรับความเสี่ยงเอง ทุกที่นั่งเป็นแบบระบุที่นั่ง SVIP 360,000 วอน VIP 240,000 วอน R 190,000 วอน และ S 80,000 วอน ผังเป็นภาพอ้างอิง เวทีอาจเปลี่ยนได้ ศูนย์วัฒนธรรมและศิลปะทงแฮ มหาวิทยาลัยควังอุน เลขที่ 20 Gwangun-ro เขตโนวอน โซล รถไฟใต้ดินสถานี Kwangwoon University สาย 1 หรือ Seokgye สาย 6 รถประจำทาง 261, 173, 1017, 1130, 1137, 1140 แนะนำให้ใช้ขนส่งสาธารณะ ไม่สามารถยกเลิกหรือคืนเงินกรณีมาสายหรือไม่มาร่วมงานเพราะรถติดหรือปัญหาที่จอดรถ", "zh-CN": "Girl Rules 首尔粉丝见面会于2026年7月4日下午3点（韩国时间）举行，仅通过 Grabit 售票。通过违规渠道购票可能受法律制裁，损失由购票人承担。全场对号入座，SVIP 360,000韩元、VIP 240,000韩元、R 190,000韩元、S 80,000韩元。座位图仅供参考，舞台设计可能调整。地点为首尔芦原区 Gwangun-ro 20号光云大学东海文化艺术馆。地铁1号线光云大学站或6号线石溪站，可乘261、173、1017、1130、1137、1140路公交。建议使用公共交通，因交通或停车问题导致迟到或缺席不可取消或退款。"}'::jsonb)
)
UPDATE performances p SET detail_images = (
  SELECT jsonb_agg(
    CASE WHEN c.translations IS NULL THEN entry.image ELSE
      jsonb_set(entry.image, '{captions}', c.translations || coalesce(nullif(entry.image->'captions', 'null'::jsonb), '{}'::jsonb))
    END ORDER BY entry.position
  )
  FROM jsonb_array_elements(p.detail_images) WITH ORDINALITY AS entry(image, position)
  LEFT JOIN captions c ON c.performance_id = p.id
    AND c.image_url = entry.image->>'imageUrl'
    AND c.original_alt IS NOT DISTINCT FROM (entry.image->>'altText')
)
WHERE p.id IN (SELECT performance_id FROM captions) AND jsonb_typeof(p.detail_images) = 'array'
  AND EXISTS (SELECT 1 FROM jsonb_array_elements(p.detail_images) elem
    JOIN captions c ON c.performance_id = p.id AND c.image_url = elem->>'imageUrl'
      AND c.original_alt IS NOT DISTINCT FROM (elem->>'altText')
    WHERE NOT (coalesce(nullif(elem->'captions','null'::jsonb),'{}'::jsonb) ?& ARRAY['en','th','zh-CN']));

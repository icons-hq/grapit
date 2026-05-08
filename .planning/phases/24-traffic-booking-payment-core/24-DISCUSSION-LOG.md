# Phase 24: Traffic + Booking + Payment Core - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-08T11:27:21+09:00
**Phase:** 24-Traffic + Booking + Payment Core
**Areas discussed:** Queue admission contract, Traffic defense posture, Multi-floor seats and ticket policy, Payment/refund/QR contract

---

## Queue Admission Contract

### Queue enforcement boundary

| Option | Description | Selected |
|--------|-------------|----------|
| Booking 진입부터 | 공연 상세/가입은 열어두고, `/booking` 진입과 `lock/prepare/confirm` API에 admission token을 요구합니다. | ✓ |
| 상세 페이지부터 | 이벤트 상세까지 queue 뒤로 보내 origin 보호는 강하지만 광고/가입 탐색 UX가 무거워집니다. | |
| Agent decide | 현재 phase 목표와 기존 `BOOKING_ENABLED` gate를 기준으로 planner가 보수적으로 정합니다. | |

**User's choice:** Booking 진입부터
**Notes:** Queue is scoped to scarce booking resources, not event discovery.

### Admission identity

| Option | Description | Selected |
|--------|-------------|----------|
| 로그인 계정 + refresh token family | Booking은 로그인 필요하므로 `userId + refresh token family/device slot + queue session`에 묶습니다. | ✓ |
| 브라우저 cookie 중심 | 로그인 전 queue 진입이 자연스럽지만 다중 브라우저/공유 링크/봇 제어가 약합니다. | |
| 계정만 기준 | 구현은 단순하지만 여러 기기/탭 처리와 기존 3-device 정책이 흐려집니다. | |

**User's choice:** 로그인 계정 + refresh token family
**Notes:** Aligns with Phase 23 three-device policy.

### Admission duration

| Option | Description | Selected |
|--------|-------------|----------|
| 짧은 active window + 재입장 grace | 10분 active, 결제 진행 중 server-side 연장, refresh/back navigation은 2-3분 grace. | ✓ |
| 결제 완료/이탈 전까지 길게 유지 | UX는 편하지만 admitted user가 slot을 오래 점유합니다. | |
| 매 API마다 즉시 재검증만 | 운영 제어는 강하지만 네트워크 흔들림에서 queue로 되돌아갈 위험이 큽니다. | |

**User's choice:** 짧은 active window + 재입장 grace
**Notes:** Matches the existing 10-minute seat lock model.

### Queue UX

| Option | Description | Selected |
|--------|-------------|----------|
| 순번 + ETA + 잔여석 + 자동 진입 | Position, estimated wait, remaining seats를 표시하고 admitted 되면 자동 진입합니다. | ✓ |
| 순번 + 수동 입장 버튼 | 자동 이동 불안을 줄이지만 admitted slot이 낭비될 수 있습니다. | |
| 최소 정보만 표시 | 단순하지만 글로벌 팬덤 티켓팅에서 문의가 늘 수 있습니다. | |

**User's choice:** 순번 + ETA + 잔여석 + 자동 진입
**Notes:** Directly matches Phase 24 success criteria.

---

## Traffic Defense Posture

### Defense posture

| Option | Description | Selected |
|--------|-------------|----------|
| Progressive defense | Endpoint rate limit + app-layer guard, suspicious traffic gets `Managed Challenge`, clear macro/bot gets `Block`. | ✓ |
| Aggressive block-first | Strong origin protection but higher false-positive risk for global fans. | |
| Observe-first then tighten | Safer rollout but weaker early protection. | |

**User's choice:** Progressive defense
**Notes:** Balances protection and overseas fan access.

### Rate limit identity

| Option | Description | Selected |
|--------|-------------|----------|
| Endpoint별 + identity/session/IP 조합 | Track login/signup/SMS/booking separately with `userId/session cookie/admission token/IP` where available. | ✓ |
| IP 중심 | Simple but bad for shared networks. | |
| 계정 중심 | Strong after login but weak before signup/SMS/queue. | |

**User's choice:** Endpoint별 + identity/session/IP 조합
**Notes:** Avoids IP-only false positives.

### User-facing limited states

| Option | Description | Selected |
|--------|-------------|----------|
| Clear retry state + localized copy | Distinguish 429, queue redirect, challenge return, and blocked behavior in five locales. | ✓ |
| 최소 메시지 | Easier but causes repeated retry and confusion. | |
| 강한 보안 메시지 | Deterrent but may feel hostile to normal users. | |

**User's choice:** Clear retry state + localized copy
**Notes:** Must integrate with Phase 23 i18n surface.

### Macro controls

| Option | Description | Selected |
|--------|-------------|----------|
| Booking-critical scoring only | Score repeated `lock/prepare/payment` attempts across account, phone, email, payment method, device-ish fingerprint, and admission token. | ✓ |
| Full anti-fraud profile | Powerful but too broad for Phase 24. | |
| WAF/rate-limit만 우선 | Smaller but weaker operational traceability. | |

**User's choice:** Booking-critical scoring only
**Notes:** Full anti-fraud graphing is deferred.

---

## Multi-Floor Seats and Ticket Policy

### Multi-floor data model

| Option | Description | Selected |
|--------|-------------|----------|
| Seat map rows per floor | Expand `seat_maps` into floor-specific rows with `floorKey`, `floorLabel`, `sortOrder`, `svgUrl`, `seatConfig`. | ✓ |
| Single row JSON floors | Smaller migration but harder per-floor SVG/admin/cache handling. | |
| Agent decide | Planner decides after migration impact review. | |

**User's choice:** Seat map rows per floor
**Notes:** Existing single map migrates to floor `1F`.

### Floor switching behavior

| Option | Description | Selected |
|--------|-------------|----------|
| 층간 선택 유지 + 전체 선택 요약 | Keep selections across floors and show total floor-grouped summary. | ✓ |
| 층 변경 시 선택 해제 확인 | Simpler but users lose comparison state. | |
| 한 floor에서만 선택 허용 | Clear policy but limited UX. | |

**User's choice:** 층간 선택 유지 + 전체 선택 요약
**Notes:** Max ticket policy applies across all floors combined.

### Max ticket default

| Option | Description | Selected |
|--------|-------------|----------|
| Event default 1, configurable up to N | Fanmeet default is 1 ticket per user; event setting may raise the limit. | ✓ |
| 기본 2매 | Better group UX but weaker fairness. | |
| 기존 4매 유지 | Smaller implementation but inconsistent with fanmeet risk. | |

**User's choice:** Event default 1, configurable up to N
**Notes:** Existing hardcoded `MAX_SEATS=4` must be replaced by event config.

### Seat change policy

| Option | Description | Selected |
|--------|-------------|----------|
| 결제 전만 자유 변경, 결제 후 변경 불가 | Lock-stage changes allowed; confirmed reservations use cancellation/refund only. | ✓ |
| 결제 후 동일 등급만 변경 허용 | User-friendly but state-heavy. | |
| 운영자 수동 변경만 허용 | Moves exceptions to admin operations. | |

**User's choice:** 결제 전만 자유 변경, 결제 후 변경 불가
**Notes:** Avoids QR/refund/sold-seat state conflict.

---

## Payment, Refund, and QR Contract

### Overseas payment disclaimer

| Option | Description | Selected |
|--------|-------------|----------|
| Payment method 선택 직전 필수 동의 | Overseas card, Alipay+, and truemoney require explicit checkbox for KRW/FX/fee/refund-delay disclaimer. | ✓ |
| 상단 안내문만 표시 | Faster UX but weaker dispute evidence. | |
| 약관 동의에 통합 | Simpler UI but payment-method risk copy is buried. | |

**User's choice:** Payment method 선택 직전 필수 동의
**Notes:** Should generate explicit agreement evidence.

### Refund status model

| Option | Description | Selected |
|--------|-------------|----------|
| Detailed state machine | Show requested, sent to PG, processing, completed, failed, ETA, and CS CTA. | ✓ |
| Simple cancelled/refunded only | Smaller but poor for overseas delay inquiries. | |
| Admin detail only, user simple | Helps CS but leaves users uncertain. | |

**User's choice:** Detailed state machine
**Notes:** User-visible refund state is required.

### Cancelled-seat random holding

| Option | Description | Selected |
|--------|-------------|----------|
| User cancel도 1-10분 random hold | All user-cancelled seats reopen after pg-boss delayed job with uniform random jitter. | ✓ |
| 고위험 이벤트만 random hold | Config risk is high for fanmeet. | |
| 즉시 재개방 유지 | Current behavior but macro-vulnerable. | |

**User's choice:** User cancel도 1-10분 random hold
**Notes:** Operator manual open is the immediate-reopen exception.

### QR issuance and email timing

| Option | Description | Selected |
|--------|-------------|----------|
| 결제 성공 즉시 발급 + D-1 이메일 재발송 | Confirmed payment issues JWT/HMAC QR immediately and schedules D-1 24-hour email. | ✓ |
| D-1에만 발급/발송 | Lower exposure but more support inquiries. | |
| 즉시 발급만, D-1 email은 Phase 27 | Smaller Phase 24 but does not fully satisfy `QR-01`. | |

**User's choice:** 결제 성공 즉시 발급 + D-1 이메일 재발송
**Notes:** QR scanning/offline verification remains Phase 27.

---

## the agent's Discretion

None. The user selected concrete options for all discussed areas.

## Deferred Ideas

- Toss live-key cutover and `BOOKING_ENABLED=true` remain Phase 26.
- k6/DR/on-call/Cloud SQL HA/read replica/pgBouncer gate evidence remains Phase 26.
- Admin operations console and detailed manual seat-operation UI remain Phase 25.
- Field QR scanning, duplicate/tamper detection, offline sync, event-day monitor, and settlement remain Phase 27.
- Full anti-fraud graphing/provider-heavy fraud tooling is deferred.

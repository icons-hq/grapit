# Requirements: Grapit v2.0 Fanmeet Launch

**Defined:** 2026-05-04  
**Core Value:** 사용자가 원하는 공연을 발견하고, 좌석을 직접 선택하여, 안정적으로 예매를 완료할 수 있는 것. 이 흐름이 끊기면 서비스의 의미가 없다.

## v2.0 Requirements

### Preflight

- [x] **PREF-01**: Operator can complete launch-facing SMS, legal, and email real-device/sign-off gates with evidence before fanmeet implementation starts.
- [x] **PREF-02**: Maintainer can backfill v1.1 validation artifacts into a clear v2.0 launch-readiness baseline.
- [x] **PREF-03**: Maintainer can close or mitigate Valkey, R2, SMS, email, and legal operational fragility as explicit launch blockers.

### Production Compatibility and Flags

- [x] **FLAG-01**: Existing production users, reservations, sessions, and Korean SEO URLs remain valid through expand-only migrations and canary deploys.
- [x] **FLAG-02**: User sees booking disabled with localized "5월말 오픈 예정" copy, and booking APIs do not create seat locks or payment attempts while `BOOKING_ENABLED=false`.
- [ ] **M1-01**: Operator can complete M1 integrated smoke tests and canary deploy, then open the advertising/signup surface on 2026-05-15.

### Globalization

- [x] **I18N-01**: User can view all fanmeet public pages in `ko`, `en`, `th`, `zh-CN`, and `zh-TW`, with Korean remaining on `/` and foreign locales on prefixed routes.
- [x] **I18N-02**: User can complete locale-sensitive flows with localized PhoneInput labels, auth/OTP copy, email/SMS templates, time display, currency display, hreflang, and sitemap support.
- [x] **TRANS-01**: Operator can create Korean source content, generate four translated drafts, review/publish them, and show an automatic-translation label where required.
- [x] **TRANS-02**: Operator can maintain legal notices as schema-locked Korean/English manual fields, with automatic translation blocked for legal copy.

### Auth and Compliance

- [x] **AUTH-01**: User can sign up or log in through Kakao, Naver, Google, or email, with email verification expiring after 30 minutes and immediate resend available. LINE is excluded from Phase 23 by D-13.
- [x] **AUTH-02**: User account sessions enforce the three-device policy through refresh token family tracking.
- [x] **COMP-01**: User can complete required PIPA, cross-border transfer, PDPA/PIPL English notice, under-14 restriction, and marketing consent flows.
- [x] **COMP-02**: Operator can query consent audit logs by item, version, language, timestamp, IP, and user.

### Traffic and Reliability

- [x] **TRAF-01**: User entering ticketing can be admitted through a Valkey Sorted Set queue with batch admission, queue position, estimated wait, and remaining-seat updates.
- [x] **TRAF-02**: Platform enforces Cloudflare WAF, per-endpoint rate limits, bot-score challenge/blocking, and macro-pattern controls for login, signup, SMS, and booking endpoints.
- [x] **TRAF-03**: Platform can prewarm Cloud Run through Cloud Scheduler before advertising or ticketing traffic, then step down safely afterward.
- [ ] **LOAD-01**: Maintainer can run k6 10k baseline and 20k stress scenarios with p95 under 2 seconds and error rate under 1% before payment cutover.
- [ ] **DR-01**: Maintainer can execute DB PITR restore, Valkey failover, and Cloud Run rollback drills before payment cutover.
- [ ] **OPS-01**: Operator can use on-call playbooks and Sentry alerts for PG, Valkey, DB, CDN, latency, error-rate, and payment-failure incidents.
- [ ] **INFRA-01**: Platform can handle cutover traffic with pgBouncer transaction pooling, Cloud SQL HA, read replica, and tuned per-instance DB pools.

### Booking, Payment, Refund, and QR Issuance

- [x] **BOOK-01**: User can select seats across multi-floor SVG maps with existing lock ownership enforcement and event-specific ticket limits.
- [x] **BOOK-02**: User sees a 7-minute payment countdown, red warning at two minutes, 10-minute seat lock expiry, and automatic seat return after payment failure or timeout.
- [x] **BOOK-03**: Operator can configure cancellation fee rules, same-grade/change policy if enabled, and manual seat re-open controls per event.
- [ ] **PAY-01**: Operator can enable live ticketing in five minutes through Toss live keys and `BOOKING_ENABLED=true` only after all cutover gates pass.
- [x] **PAY-02**: User can pay through Toss domestic methods, overseas card, Alipay+, or truemoney, with FX disclaimer and explicit agreement where required.
- [x] **REFUND-01**: User can request cancellation/refund, preview irreversible refund details, and track refund state from request through PG processing to completion.
- [x] **REFUND-02**: Cancelled seats reopen after a random 1-10 minute hold through a delayed job unless an operator manually opens them.
- [x] **QR-01**: User receives a QR JWT/HMAC ticket after successful booking, and the system can send the QR email 24 hours before the event.
- [ ] **OPS-02**: Operator can monitor the first 24 hours of ticketing for 1-2만 concurrent users, sellout behavior, payment failures, and refund automation health.

### Admin and Event Operations

- [x] **ADMIN-01**: Operator can register and approve the fanmeet event with multilingual tabs, cast cards, multi-SVG upload, price tiers, sale settings, and review/approval RBAC.
- [x] **ADMIN-02**: Operator can manage Q&A, FAQ, notices, CS tickets, escalation rules, refund-dispute conversations, and 24-hour SLA indicators.
- [x] **ADMIN-03**: Admin access requires MFA and IP allowlist, and sensitive actions write audit logs.
- [x] **ADMIN-04**: Operator can manage banners, reservation CSV exports, seat disable/reactivate actions, cancelled-seat immediate opening, and seat-change history.
- [ ] **QR-02**: Field staff can scan QR tickets with JWT/HMAC verification, duplicate-scan detection, tamper detection, and offline fallback sync.
- [ ] **FIELD-01**: Operator can monitor event-day entry counts, no-shows, entry rate, duplicate scans, and abnormal access alerts in real time.
- [ ] **OPS-03**: Operator can follow event-day playbooks for forced refund, weather/facility/cast cancellation, on-site refund, and exchange scenarios.

### Post-Event

- [ ] **POST-01**: Operator can export entry status, no-show reservations, settlement data, and accounting inputs after the event.
- [ ] **POST-02**: Maintainer can commit a retrospective covering launch incidents, improvements, and next-event carry-forward actions by 2026-07-10.

## Future Requirements

### Policy and Product Extensions

- **POLICY-01**: User can transfer or rename a ticket if a future policy explicitly allows it.
- **PAY-03**: User can use virtual account payment after unpaid-order handling is designed.
- **REFUND-03**: User can receive partial refunds for seat-grade changes after the refund model is expanded.
- **AUTH-03**: User can use WeChat login or PASS identity verification if a later market/legal need justifies it.
- **MOBILE-01**: User can use a native mobile app after web launch proves demand.

## Out of Scope

| Feature | Reason |
|---------|--------|
| Legal counsel workflow | Explicitly excluded to hit 2026-05-15; user accepts dispute risk. |
| Notification signup | Spec removes it; SNS marketing handles D-day communication. |
| Separate fanmeet landing page | Existing event detail surface is the launch surface. |
| LaunchDarkly or external flag platform | Env/helper flags are sufficient and lower-risk. |
| WeChat login | Explicitly excluded from v2.0 scope. |
| PASS identity verification | Not required for this launch. |
| Mobile app | PROJECT.md remains web-first. |
| Virtual account payment | Unpaid-order complexity is outside this launch. |
| Partial refund | Seat-grade partial refund policy is not defined for M1-M4. |
| Dispute mediation automation | Operational/legal scope is too large for the milestone. |

## Traceability

Phase mapping was consolidated on 2026-05-04 from the initial 22-phase launch-risk checklist into six GSD execution phases. Requirement IDs are unchanged.

| Requirement | Phase | Status |
|-------------|-------|--------|
| PREF-01 | Phase 22 | Complete |
| PREF-02 | Phase 22 | Complete |
| PREF-03 | Phase 22 | Complete |
| FLAG-01 | Phase 23 | Complete |
| FLAG-02 | Phase 23 | Complete |
| I18N-01 | Phase 23 | Complete |
| I18N-02 | Phase 23 | Complete |
| TRANS-01 | Phase 23 | Complete |
| TRANS-02 | Phase 23 | Complete |
| AUTH-01 | Phase 23 | Complete |
| AUTH-02 | Phase 23 | Complete |
| COMP-01 | Phase 23 | Complete |
| COMP-02 | Phase 23 | Complete |
| TRAF-01 | Phase 24 | Complete |
| TRAF-02 | Phase 24 | Complete |
| TRAF-03 | Phase 24 | Complete |
| BOOK-01 | Phase 24 | Complete |
| BOOK-02 | Phase 24 | Complete |
| BOOK-03 | Phase 24 | Complete |
| PAY-02 | Phase 24 | Complete |
| REFUND-01 | Phase 24 | Complete |
| REFUND-02 | Phase 24 | Complete |
| QR-01 | Phase 24 | Complete |
| ADMIN-01 | Phase 25 | Complete |
| ADMIN-02 | Phase 25 | Complete |
| ADMIN-03 | Phase 25 | Complete |
| ADMIN-04 | Phase 25 | Complete |
| M1-01 | Phase 26 | Pending |
| LOAD-01 | Phase 26 | Pending |
| DR-01 | Phase 26 | Pending |
| INFRA-01 | Phase 26 | Pending |
| OPS-01 | Phase 26 | Pending |
| PAY-01 | Phase 26 | Pending |
| OPS-02 | Phase 26 | Pending |
| QR-02 | Phase 27 | Pending |
| FIELD-01 | Phase 27 | Pending |
| OPS-03 | Phase 27 | Pending |
| POST-01 | Phase 27 | Pending |
| POST-02 | Phase 27 | Pending |

**Coverage:**
- v2.0 requirements: 39 total
- Mapped to phases: 39
- Unmapped: 0

---
*Requirements defined: 2026-05-04*
*Last updated: 2026-05-04 after v2.0 phase merge for GSD execution*

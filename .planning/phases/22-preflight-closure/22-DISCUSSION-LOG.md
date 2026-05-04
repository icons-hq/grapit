# Phase 22: Preflight Closure - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.
> Originally gathered for the Operator UAT gate. After the 2026-05-04 phase merge, these decisions apply to the PREF-01 sub-gate inside Phase 22 Preflight Closure.

**Date:** 2026-05-04T16:12:52+09:00
**Phase:** 22-Preflight Closure
**Areas discussed:** Evidence acceptance policy, SMS real-device gate, Email inbox gate, Legal public/sign-off gate

---

## Evidence Acceptance Policy

| Question | Option | Description | Selected |
|----------|--------|-------------|----------|
| Evidence 판정 기준 | Strict PASS only | SMS/email/legal 각각 직접 runtime/operator evidence가 없으면 blocker | |
| Evidence 판정 기준 | Gate matrix | `PASS`, `ACCEPTED_RISK`, `BLOCKER`로 구분 | ✓ |
| Evidence 판정 기준 | Minimal preflight | 기존 테스트/문서 evidence로 닫고 M1에서 재확인 | |
| Caveat 승인자 | Operator approval only | 실제 운영자가 risk를 승인 | |
| Caveat 승인자 | Maintainer + operator approval | maintainer가 기술 risk를 적고 operator가 business risk 승인 | ✓ |
| Caveat 승인자 | Maintainer approval only | 1인 개발 기준으로 maintainer만 승인 | |
| 문서 위치 | v2.0-only evidence ledger | Phase 22 전용 ledger 작성, prior docs는 참조만 | ✓ |
| 문서 위치 | Backpatch prior phase files | Phase 14/15/16 문서까지 직접 수정 | |
| 문서 위치 | Hybrid | Phase 22 ledger + prior docs에 superseded link 추가 | |
| 상태 용어 | `PASS / ACCEPTED_RISK / BLOCKER` | Launch gate 의미가 명확함 | ✓ |
| 상태 용어 | `complete / partial / pending` | 기존 verification 문서 느낌 | |
| 상태 용어 | `green / yellow / red` | 빠르게 읽히지만 정의가 필요 | |

**User's choice:** Gate matrix, maintainer + operator approval, v2.0-only evidence ledger, `PASS / ACCEPTED_RISK / BLOCKER`.
**Notes:** Existing Phase 14/15/16 docs are canonical refs. Phase 22 now also owns the validation backfill sub-scope after the phase merge.

---

## SMS Real-Device Gate

| Question | Option | Description | Selected |
|----------|--------|-------------|----------|
| 최소 PASS 시나리오 | Signup OTP happy path only | send-code, SMS receipt, verify success, signup step3 | |
| 최소 PASS 시나리오 | Happy path + failure copy | Success plus wrong/expired/system-error copy separation | ✓ |
| 최소 PASS 시나리오 | Full matrix | Success, wrong, expired, cooldown, rate limit, China reject | |
| 관측 window | No observation window | 실기기 성공만 있으면 PASS | |
| 관측 window | Short targeted observation | UAT 직후 1시간 `sms.verify_failed`, `CROSSSLOT`, Sentry valkey 확인 | ✓ |
| 관측 window | 72h observation | Phase 14의 72h 관측 유지 | |
| 증거 형태 | Operator screenshot + timestamp | 화면 캡처와 시간만 기록 | |
| 증거 형태 | Screenshot + sanitized logs | 화면 캡처와 마스킹된 Cloud Run/Sentry logs | ✓ |
| 증거 형태 | Video recording + full logs | 영상과 전체 로그 | |
| 실패 처리 | Stop as BLOCKER | 실패 원인만 기록하고 Phase 24로 이관 | |
| 실패 처리 | Fix only if same surface | Phase 14 SMS path regression이면 Phase 22에서 수정 계획 포함 | ✓ |
| 실패 처리 | Fix all SMS-related issues | 5-country SMS/provider/cost까지 처리 | |

**User's choice:** Happy path + failure copy, short targeted observation, screenshot + sanitized logs, fix only if same surface.
**Notes:** Global SMS/provider/cost scope is deferred to Phase 23 Launch Foundation unless existing SMS fragility blocks preflight closure.

---

## Email Inbox Gate

| Question | Option | Description | Selected |
|----------|--------|-------------|----------|
| PASS 기준 | Resend accepted + one inbox | Resend API success/id와 Gmail 수신 | ✓ |
| PASS 기준 | Gmail/Naver/Daum all observed | 3사 mailbox 위치 모두 기록 | |
| PASS 기준 | Provider dashboard only | Resend/Cloud Run/Sentry만 확인 | |
| Naver/Daum 미확인 | ACCEPTED_RISK by default | Gmail PASS + Resend accepted면 approval 조건으로 risk accepted | ✓ |
| Naver/Daum 미확인 | BLOCKER if untested | Gmail PASS여도 Naver/Daum 미확인은 blocker | |
| Naver/Daum 미확인 | Deferred observation | Phase 26 M1 smoke로 넘김 | |
| 사용자 경로 | Password reset request only | reset email 수신만 확인 | |
| 사용자 경로 | Reset email -> confirm -> login | 이메일 수신, 비밀번호 변경, 새 비밀번호 login | ✓ |
| 사용자 경로 | Reset + signup verification email | 향후 email verification까지 포함 | |
| 증거 처리 | Screenshot only | 메일 화면만 캡처 | |
| 증거 처리 | Redacted evidence bundle | email id, Cloud Run/Sentry result, Gmail screenshot; PII/token/link redaction | ✓ |
| 증거 처리 | Full raw evidence private | 원본 로그 private 보관 | |

**User's choice:** Resend accepted + Gmail inbox, Naver/Daum as accepted risk by default, reset email -> confirm -> login, redacted evidence bundle.
**Notes:** Naver/Daum still need explicit maintainer/operator approval to close as `ACCEPTED_RISK`.

---

## Legal Public/Sign-Off Gate

| Question | Option | Description | Selected |
|----------|--------|-------------|----------|
| 기술 검증 범위 | Public URLs only | `/legal/terms`, `/legal/privacy`, `/legal/marketing` HTTP 200 | |
| 기술 검증 범위 | Public URLs + footer/dialog + robots/canonical | URLs, Footer, dialogs, production robots/canonical | ✓ |
| 기술 검증 범위 | Full SEO/legal audit | sitemap, Search Console, structured data, legal copy diff | |
| Sign-off 수준 | Factual sign-off only | factual fields만 operator 확인 | ✓ |
| Sign-off 수준 | Full legal counsel sign-off | 변호사 검토 없이는 PASS 불가 | |
| Sign-off 수준 | No sign-off | 테스트 통과만으로 PASS | |
| Mailbox 확인 | Include support/privacy mailbox receipt | `support@heygrabit.com`, `privacy@heygrabit.com` 수신 확인 | ✓ |
| Mailbox 확인 | Include support only | 고객센터만 확인 | |
| Mailbox 확인 | Exclude mailbox | 법적 연락처는 문구만 확인 | |
| 실패 처리 | Document as BLOCKER only | 실패만 기록하고 Phase 24로 이관 | |
| 실패 처리 | Fix evidence/docs/test gaps only | Phase 16 launch surface 직접 gap은 Phase 22에서 수정 계획 포함 | ✓ |
| 실패 처리 | Fix all legal/compliance issues | PIPA/PDPA/PIPL까지 처리 | |

**User's choice:** Public URLs + footer/dialog + robots/canonical, factual sign-off only, include support/privacy mailbox receipt, fix evidence/docs/test gaps only.
**Notes:** Multinational consent/legal schema lock remains Phase 23 Launch Foundation scope.

---

## the agent's Discretion

None.

## Deferred Ideas

- Five-country SMS policy, provider cost monitoring, and global SMS launch behavior belong to Phase 23 Launch Foundation unless existing SMS fragility blocks preflight closure.
- Multinational consent, legal schema lock, PIPA/PDPA/PIPL expansion, and audit log behavior belong to Phase 23 Launch Foundation.
- Naver/Daum mailbox behavior can be rechecked in Phase 26 M1 Canary + Cutover Gates if left as `ACCEPTED_RISK` in Phase 22.

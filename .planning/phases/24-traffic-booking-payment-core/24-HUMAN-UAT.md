---
status: partial
phase: 24-traffic-booking-payment-core
source: [24-VERIFICATION.md]
started: 2026-05-08T10:32:42Z
updated: 2026-05-10T10:05:59Z
---

# Phase 24: Human UAT

## Current Test

[awaiting human testing]

## Tests

### 1. Cloudflare WAF/rate-limit/challenge/block rules 실제 Zone 반영 확인
expected: runbook의 queue-entry/lock-seat/prepare-reservation/confirm-payment 규칙이 활성화되고 동작한다
result: [pending]

### 2. Cloud Scheduler → prewarm API(OIDC+control-token) 실제 호출 검증
expected: scale-up/step-down job이 의도한 서비스에 성공하고 감사 가능한 실행 로그가 남는다
result: [pending]

### 3. Toss sandbox 실결제 경로(국내카드/해외카드/Alipay+/truemoney) E2E
expected: sync/pending/recovery 분기와 안내문구가 실제 redirect/webhook 왕복에서 일치한다
result: [pending]

### 4. 모바일/데스크톱 멀티층 좌석 선택 UX 최종 확인
expected: 층 전환 시 선택/타이머/복구 흐름이 실제 브라우저에서 안정 동작한다
result: [pending]

## Summary

total: 4
passed: 0
issues: 0
pending: 4
skipped: 0
blocked: 0

## Gaps

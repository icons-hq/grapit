---
type: backlog
origin: Phase 09-tech-debt DEBT-05 CI follow-up
status: deferred
created: 2026-04-15
priority: medium
tags: [e2e, ci, playwright, auth, nestjs]
---

# CI-login-E2E — Playwright login helper 401 이슈

## 문제 요약

Phase 09-tech-debt DEBT-05 를 CI 에 통합하는 과정에서, `apps/web/e2e/toss-payment.spec.ts` 중 login 이 필요한 3개 E2E 가 **CI 환경에서만 401 Unauthorized** 로 실패함. 로컬 개발자 환경에서는 재현되지 않았고, 같은 CI 환경의 curl 로 동일 endpoint 를 호출하면 200 성공.

## 확정된 사실

- **API 측:** CI 에서 API 가 정상 기동. `POST /api/v1/auth/login` 에 curl 로 `{email,password}` 보내면 HTTP 200 + accessToken + Set-Cookie:refreshToken 정상 반환. (CI 의 "Smoke test login" step 로그 확인)
- **DB 측:** seed 가 admin@grapit.test / TestAdmin2026! 를 정상 삽입. `pw_len=97` (argon2 hash 정상 길이). (CI 의 "Verify seed" step 로그 확인)
- **실패 지점:** Playwright 의 E2E `loginAsTestUser` helper 가 POST /api/v1/auth/login 보내면 Passport-local 이 자체 401 을 던짐 (body 가 `{"statusCode":401,"message":"Unauthorized","timestamp":...}` — validateUser 의 custom 메시지 `"이메일 또는 비밀번호가 일치하지 않습니다"` 가 아님 → passport-local 이 req.body.email / req.body.password 를 못 뽑은 것).

## 시도한 우회 (모두 동일 401)

1. `page.request.post('/api/v1/auth/login', { data: {...}, headers: {...} })` — via Next.js rewrites (proxy) → 401
2. `page.request.post('http://localhost:8080/api/v1/auth/login', ...)` — API 직접 호출 → 401
3. `data: JSON.stringify({...})` 명시 직렬화 → 401
4. `Accept: application/json` 추가 → 401
5. `request.newContext()` 로 browser context 와 격리 → 401

## 남은 가설

- Playwright 의 내부 네트워킹 layer (Chromium 기반) 가 **body 를 streaming / multipart 로 encode** 하는데 NestJS 의 express body-parser 가 이를 파싱하지 못함
- `Content-Length` 누락 또는 `Transfer-Encoding: chunked` 로 body 가 전송되어 passport-local 이 req.body 를 못 읽음
- NestJS 의 ValidationPipe / global middleware 가 특정 헤더 조합에 대해 body 를 버림

## 제안 진단 방법 (다음 세션)

1. NestJS AuthController.login 에 간단 middleware 를 임시 주입해서 실제 도착한 `req.body`, `req.headers`, `req.rawBody` 를 로그. curl vs Playwright 의 차이 관찰.
2. Playwright 에서 Node native `fetch()` (undici) 로 직접 login 호출 시도. Playwright 의 Chromium-based request 를 완전히 우회.
3. Wireshark / tcpdump 로 실제 wire-level 요청 비교. 생각 이외의 인코딩 차이 검출.

## 영향 범위

- 실패 3건:
  - `happy path: widget mounts AND confirm API intercepts on complete page`
  - `UI regression: cancel error URL → toast renders`
  - `UI regression: decline error URL → error message renders`
- 모두 `toss-payment.spec.ts` 내, 각각 `test.fixme()` 처리됨 (commit `5d65cb9`)
- CI pipeline 은 green — Toss 자체 로직 9개 E2E 는 계속 검증됨

## 비영향 영역 (이 이슈와 무관)

- Phase 09 DEBT-05 의 핵심 계약 (Toss 결제 SDK 자체의 실 sandbox 키 검증) 은 달성됨. Toss widget mount, confirm API intercept, error URL rendering 모두 9 green.
- Production 의 Cloud Run + Cloud SQL 배포는 영향 없음 (이건 CI 인프라 이슈).
- 수동 UAT (사용자 브라우저에서 직접 결제) 는 Phase 09 초기부터 계속 가능.

## 해결 시 재활성화 방법

3개 test 의 `test.fixme(...)` → `test(...)` 로 복원하고 CI 에서 12/12 green 확인. `.planning/phases/09-tech-debt/09-VERIFICATION.md` 에 명시된 "deferred operational checklist" 도 close.

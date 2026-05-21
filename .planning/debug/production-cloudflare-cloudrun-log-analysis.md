---
status: resolved
trigger: "Production Cloudflare and Cloud Run error log deep analysis"
created: "2026-05-18T18:18:06+09:00"
updated: "2026-05-18T18:18:06+09:00"
---

# Production Cloudflare / Cloud Run 오류 심층 분석 보고서

작성 시각: 2026-05-18 18:18 KST

## 1. 결론 요약

현재 배포된 production latest revision 기준으로는 Cloud Run application 5xx가 재현되지 않았다. `grabit-api-00107-sb7`, `grabit-web-00075-f8t` 모두 100% traffic을 받고 있고, live smoke 기준 주요 public endpoint는 `200`을 반환했다.

다만 최근 24시간 로그에는 세 가지 운영 이슈가 분명히 남아 있다.

1. 2026-05-17 18:41-20:58 KST 사이 `429`가 대량 발생했다. 주요 원인은 이전 revision의 global/default throttler와 shared Cloudflare IP가 맞물린 것이다.
2. 2026-05-18 15:58-17:19 KST 사이 SMS 발송 실패가 반복됐다. Twilio Verify가 특정 한국 번호 prefix를 fraud block 처리했고, provider code는 `60410`이다.
3. Cloudflare HTTP analytics에는 최근 24시간 `520`이 최소 196건 보인다. Cloud Run request log에는 대응되는 5xx가 없어서, application exception보다 Cloudflare edge와 origin/load balancer 사이 연결 실패 또는 스캐너성 비정상 request에 가깝다.

최신 revision 이후 남은 실질 사용자 영향은 `SMS_RECIPIENT_BLOCKED` 계열과 Naver social callback의 withdrawn/missing linked user 처리 UX다. 반면 2026-05-17의 `429` 대량 발생은 이미 이후 revision에서 hotfix가 반영된 과거 incident로 분류된다.

## 2. 조사 범위와 데이터 소스

대상 production:

- GCP project: `grapit-491806`
- Region: `asia-northeast3`
- Cloud Run services: `grabit-api`, `grabit-web`
- Public hosts: `https://heygrabit.com`, `https://api.heygrabit.com`, `https://cdn.heygrabit.com`

현재 live revision:

| Service | Latest ready revision | Image SHA | Traffic |
| --- | --- | --- | --- |
| `grabit-api` | `grabit-api-00107-sb7` | `fd1affd41025433013e31054e8cf0407e9c2db08` | 100% |
| `grabit-web` | `grabit-web-00075-f8t` | `fd1affd41025433013e31054e8cf0407e9c2db08` | 100% |

사용한 로그:

- Cloud Run request logs: 최근 24시간 `httpRequest.status >= 400`
- Cloud Run request logs: 최근 7일 `httpRequest.status >= 500`
- Cloud Run stderr/error logs: 최근 24시간 및 latest revision별 3시간
- Cloudflare GraphQL HTTP analytics: 최근 약 23시간 50분
- Cloudflare WAF/security event dataset: 현재 OAuth/plan 권한에서 `authz`로 조회 불가

Cloudflare WAF/security event 원문은 조회하지 못했다. 대신 Cloudflare HTTP analytics의 edge/origin status, Cloud Run request log, live response header의 `server: cloudflare`, `cf-ray`, `via: 1.1 google`을 교차 확인했다.

## 3. 현재 상태

Live smoke:

| URL | Result |
| --- | --- |
| `https://heygrabit.com/` | `200`, Cloudflare 경유 |
| `https://api.heygrabit.com/api/v1/health` | `200`, Cloudflare 경유 |
| `https://api.heygrabit.com/api/v1/home/banners` | `200` |
| `https://api.heygrabit.com/api/v1/home/new?locale=ko` | `200` |
| `https://api.heygrabit.com/api/v1/home/hot?locale=ko` | `200` |

Latest revision health:

- `grabit-api-00107-sb7`: 최근 3시간 `stderr`/`ERROR` entry 0건, `>=500` request 0건
- `grabit-web-00075-f8t`: 최근 3시간 `stderr`/`ERROR` entry 0건
- Latest revision의 `>=400` request는 대부분 unauthenticated API 접근과 missing asset/scan request다.

## 4. Cloud Run 오류 분석

### 4.1 최근 24시간 request status

최근 24시간 `>=400` request log는 총 9,485건이었다.

| Status | Count | Last seen UTC | 판단 |
| --- | ---: | --- | --- |
| `400` | 36 | 2026-05-18T08:19:02Z | SMS/email validation 실패 중심 |
| `401` | 782 | 2026-05-18T08:55:49Z | 비로그인/만료 세션 접근 |
| `403` | 6 | 2026-05-17T12:57:33Z | seat lock 권한/상태 거절 |
| `404` | 2,299 | 2026-05-18T09:13:13Z | favicon/robots/스캐너 path/missing asset |
| `409` | 1 | 2026-05-17T10:09:07Z | conflict성 business response |
| `410` | 1 | 2026-05-17T11:39:51Z | expired/gone성 business response |
| `429` | 6,360 | 2026-05-17T11:58:31Z | 과거 throttler incident |

### 4.2 429 대량 발생

`429`는 최신 revision에서 발생한 것이 아니라 2026-05-17 18:41-20:58 KST 사이 이전 revision에 집중됐다.

상위 endpoint:

| Count | UTC window | Revisions | Endpoint |
| ---: | --- | --- | --- |
| 1,318 | 10:11:16-11:03:33 | `grabit-api-00098-j5k`, `00099-nhc` | `/api/v1/sms/send-code` |
| 809 | 09:41:05-09:41:56 | `grabit-api-00096-gw4` | `/api/v1/home/new` |
| 809 | 09:41:05-09:41:56 | `grabit-api-00096-gw4` | `/api/v1/home/hot` |
| 809 | 09:41:05-09:41:56 | `grabit-api-00096-gw4` | `/api/v1/home/banners` |
| 809 | 09:41:05-09:41:56 | `grabit-api-00096-gw4` | `/api/v1/health` |
| 808 | 09:41:05-09:41:56 | `grabit-api-00096-gw4` | `/api/v1/performances` |
| 528 | 11:05:54-11:22:19 | `grabit-api-00099-nhc`, `00100-zld` | `/api/v1/auth/email-verification/verify` |
| 163 | 11:19:10-11:58:31 | `grabit-api-00100-zld`, `00101-2vq` | `/api/v1/auth/register` |
| 127 | 10:08:46-10:57:28 | `grabit-api-00098-j5k`, `00099-nhc` | `/api/v1/sms/verify-code` |
| 121 | 10:06:06-11:22:23 | `grabit-api-00098-j5k`, `00099-nhc`, `00100-zld` | `/api/v1/auth/email-verification/resend` |

해석:

- `/home/*`, `/performances`, `/health`의 09:41 UTC spike는 read endpoint까지 global throttler가 잡힌 상태에서 load/probe traffic이 들어간 것으로 보인다.
- `/sms/*`, `/email-verification/*`, `/auth/register`의 10:06-11:58 UTC spike는 signup campaign 중 shared Cloudflare IP 기준 throttling이 사용자 인증 경로를 막은 패턴이다.
- 현재 코드에는 `SmsController`와 email verification controller에 `@SkipThrottle()` hotfix가 반영되어 있다.
- latest revision `grabit-api-00107-sb7`에서는 동일 `429` 재발이 보이지 않는다.

Root cause:

- Cloudflare 뒤에서 origin이 본 `remoteIp`가 실제 사용자 IP가 아니라 Cloudflare edge IP로 뭉쳐 보이는 상태에서, NestJS default/IP throttler가 공용 edge IP 단위로 과하게 동작했다.
- 그래서 provider나 DB failure가 아니라 application guard layer가 signup/read path를 먼저 차단했다.

권장 조치:

- Cloud Run/Nest에서 `CF-Connecting-IP` 또는 trusted proxy 기반 real client IP를 rate-limit key로 쓰도록 재설계한다.
- public read, signup, email verification, SMS처럼 launch-critical endpoint는 global default throttler 대신 endpoint별 정책과 provider-level abuse control로 분리한다.
- Cloudflare WAF/rate limiting은 dashboard/API에서 별도 export 가능한 상태로 만들어 origin log와 같은 시간축에 붙인다.

### 4.3 최근 7일 5xx

최근 7일 API 5xx는 총 62건이었다.

| Revision | Window UTC | Count | Status |
| --- | --- | ---: | --- |
| `grabit-api-p24whesmoke2` | 2026-05-11T11:26:01-2026-05-13T00:25:01 | 18 | 15x `500`, 3x `503` |
| `grabit-api-00067-55l` | 2026-05-14T06:05:59-06:06:33 | 2 | `500` |
| `grabit-api-00072-sz6` | 2026-05-15T01:19:31-01:29:47 | 9 | `500` |
| `grabit-api-00073-zw8` | 2026-05-15T01:41:34 | 1 | `500` |
| `grabit-api-00079-lhg` | 2026-05-15T06:23:32 | 1 | `502` |
| `grabit-api-00086-ps4` | 2026-05-16T09:49:47-09:49:49 | 16 | `500` |
| `grabit-api-00087-7hc` | 2026-05-16T13:53:18-13:53:31 | 15 | `500` |

상위 route:

- `/api/v1/home/new`, `/api/v1/home/hot`, `/api/v1/home/banners`: 각 14건
- `/api/v1/performances/:id`: 7건
- `/api/v1/admin/banners`: 4건
- `/api/v1/internal/prewarm/services/grabit-api`: 2건
- `/api/v1/auth/refresh`: 2건
- `/api/v1/admin/performances/:id`: 2건
- `/api/v1/payments/confirm`: 1건 `502`

해석:

- 5xx는 모두 현재 latest revision 이전에 발생했다.
- `/home/*` 500은 public read path가 과거 revision에서 반복적으로 깨진 흔적이다. 현재 live smoke에서는 정상 응답한다.
- `internal/prewarm` 503은 Cloud Scheduler 기반 prewarm/step-down 작업의 권한 또는 allowlist 조건 실패 가능성이 높고, 사용자 트래픽 장애라기보다 운영 자동화 실패로 분류된다.
- `/payments/confirm`의 단일 `502`는 결제 confirm 경로에서 origin/app 또는 upstream provider 계층이 순간적으로 실패한 흔적이다. 단일 건이라도 결제 경로이므로 별도 추적이 필요하다.

권장 조치:

- `/payments/confirm` 단일 `502`는 Toss request id, reservation/payment row, Cloud Trace를 기준으로 별도 payment incident note를 만든다.
- prewarm `503`은 Scheduler header/signature와 `PREWARM_ALLOWED_SERVICE_NAME` 설정을 확인한다.
- public read 500은 이미 최신 revision에서 사라졌지만, deploy 직후 smoke가 `/home/*`, `/performances/:id`, `/admin/banners`를 반드시 포함하도록 CI/CD post-deploy smoke를 고정한다.

## 5. Cloud Run stderr/error 분석

### 5.1 Twilio Verify 60410

최근 48시간 `Twilio Verify API 403` 로그는 9줄이었다.

분포:

- `grabit-api-00105-rhc`: 8건
- `grabit-api-00106-fp6`: 1건

로그 내용:

- event: `sms.send_failed`
- provider: Twilio Verify
- providerStatus: `403`
- providerCode: `60410`
- message: destination phone number temporarily blocked by Twilio due to fraudulent activities
- phone: masked E.164, 같은 한국 번호 prefix로 반복

코드상 매핑:

- `TwilioVerifyApiError.isRecipientBlocked`이면 `SMS_RECIPIENT_BLOCKED`가 붙은 `BadRequestException`으로 매핑된다.
- 즉 이 건은 backend 500이 아니라 사용자가 “현재 이 번호로는 인증번호를 보낼 수 없습니다” 계열 응답을 받는 provider policy block이다.

Root cause:

- Grabit application failure가 아니라 Twilio Verify의 fraud/risk policy가 특정 번호를 SMS channel에서 차단한 것이다.
- signup campaign 또는 반복 테스트 중 같은 번호/prefix가 짧은 시간에 과다 사용되어 provider risk flag가 올라갔을 가능성이 높다.

권장 조치:

- Twilio Console에서 error `60410` 대상 번호/prefix의 unblock 가능 여부와 Verify service risk 설정을 확인한다.
- production SMS 테스트 번호를 운영팀 전용 allowlist/사전 승인 번호로 분리한다.
- frontend copy는 “번호가 차단됨”과 “잠시 후 재시도”를 구분해서 사용자에게 다른 번호 사용 또는 고객센터 문의를 안내해야 한다.

### 5.2 Naver social callback error

최근 24시간 `AuthController`에서 Naver callback error가 4회 기록됐다.

로그:

- `Social callback failed: provider=naver`
- `UnauthorizedException: 연결된 사용자 계정을 찾을 수 없습니다`
- code path: `AuthService.findOrCreateSocialUser()`

코드상 조건:

- `social_accounts`에는 provider/providerId가 존재한다.
- 그런데 연결된 `users` row가 없거나 `accountStatus === 'withdrawn'`이면 `UnauthorizedException`을 던진다.
- controller는 catch 후 `/auth/callback?error=server_error&provider=naver`로 redirect한다.

Root cause:

- 탈퇴/삭제된 user와 남아 있는 social account link 간 불일치 또는 이미 withdrawn 처리된 계정의 social login 재시도다.
- 사용자에게는 실제 원인보다 `server_error`로 보일 가능성이 있다.

권장 조치:

- social callback catch에서 `UnauthorizedException`을 generic `server_error`가 아니라 `account_unavailable` 또는 `withdrawn_account`류의 명시적 error로 redirect한다.
- withdrawal flow에서 social link cleanup이 production latest에 반영됐는지 확인한다. 현재 production image SHA는 `origin/main`의 `fd1affd...`이며, 로컬 `main`은 `origin/main`과 서로 다른 SHA로 갈라져 있다.
- 기존 production DB에 남은 orphan social account가 있으면 read-only audit 후 cleanup한다.

### 5.3 Next.js Server Action mismatch

2026-05-17T10:38:43Z에 web stderr에 다음 오류가 있었다.

- `Failed to find Server Action "x". This request might be from an older or newer deployment.`

해석:

- Next.js rolling deploy 중 구버전 client가 신버전 server action id를 호출하거나 반대로 호출한 deployment skew 패턴이다.
- 현재 latest web revision에서는 최근 3시간 error가 0건이다.

권장 조치:

- server action을 user-critical form path에 쓴다면 deployment skew에 대한 retry/fallback UX를 둔다.
- Cloud Run web revision traffic cutover 직후 이전 client asset cache와 server action id mismatch를 관찰하는 alert를 둔다.

## 6. Cloudflare 오류 분석

### 6.1 Cloudflare HTTP analytics

최근 약 23시간 50분 Cloudflare HTTP analytics에서 `520`은 최소 196건이었다. GraphQL group query가 `limit=100`에 도달했으므로 실제 전체 건수는 더 많을 수 있다.

Host별 집계(조회된 상위 100 group 기준):

| Host | Count |
| --- | ---: |
| `heygrabit.com` | 106 |
| `api.heygrabit.com` | 89 |
| `www.heygrabit.com` | 1 |

특징:

- `edgeResponseStatus=520`, `originResponseStatus=0`이다.
- Cloud Run request log에는 같은 시간대의 5xx가 대응되지 않는다.
- 2026-05-18 14:02 KST 전후 `api.heygrabit.com`에 HK client country로 `/zz.php`, `/market/coinList`, `/api/index/goods`, `/mms-api/coins/hot/tickers` 같은 명백한 scanner path가 집중됐다.
- `heygrabit.com /`에도 JP/KR/US 등에서 산발적 `520`이 보인다.

Root cause 후보:

1. 스캐너/bot이 존재하지 않는 path와 비정상 host/path 조합으로 edge-origin 연결을 유발했다.
2. Cloudflare edge와 GCP HTTPS load balancer/Cloud Run 사이에서 connection reset/timeout이 발생했고, origin까지 정상 request log가 도달하지 않았다.
3. 일부 root path `520`은 사용자가 볼 수 있는 일시적 Cloudflare error였을 수 있지만, 최신 live smoke와 Cloud Run log상 지속 장애는 아니다.

권장 조치:

- Cloudflare WAF에서 WordPress/PHP/crypto exchange scanner path를 block/challenge한다.
- `520`이 root path에서 반복되는 국가/colo가 있으면 Cloudflare dashboard의 Ray ID 기반 event export가 필요하다.
- Cloudflare Logpush 또는 Workers/Ruleset logging을 활성화해서 `cf-ray`, colo, edge status, origin status를 BigQuery/Cloud Logging으로 남긴다.

### 6.2 Cloudflare 429

Cloudflare HTTP analytics에서도 `429`가 관찰된다. Cloud Run origin request log의 `429`와 같은 endpoint/time window에 겹치므로, edge WAF가 만든 별도 429라기보다 origin이 반환한 throttler response가 Cloudflare를 통해 전달된 것으로 보는 것이 타당하다.

대표 window:

- 2026-05-17T09:41Z: `/api/v1/home/new`, `/api/v1/performances` 등 read path 429
- 2026-05-17T10:11-11:03Z: `/api/v1/sms/send-code` 429
- 2026-05-17T11:05-11:22Z: `/api/v1/auth/email-verification/verify` 429
- 2026-05-17T11:54-11:58Z: `/api/v1/auth/register` 429

## 7. 사용자 영향도

High:

- 2026-05-17 18:41-20:58 KST signup/read path `429`: signup campaign conversion에 직접 영향. 현재는 hotfix 후 재발 없음.
- SMS `60410`: 특정 번호/prefix 사용자는 인증번호를 받을 수 없음. 현재도 provider policy block이면 재발 가능.

Medium:

- Cloudflare `520`: 일부 사용자가 순간적으로 Cloudflare error page를 봤을 수 있음. Cloud Run 최신 revision 장애 증거는 없음.
- Naver social callback `server_error`: 기존 social link가 withdrawn/missing user를 가리키는 사용자는 login UX가 부정확함.

Low:

- favicon/apple-touch-icon/robots/missing `_next` asset `404`: browser/bot noise 중심. favicon과 app icon은 운영 polish 항목으로 정리 가능.
- direct IP/WordPress/PHP scanner `404`: 공격 시도 흔적이지만 현재 app exploit 증거는 없음.

## 8. 우선순위 액션

P0 - 이미 완화됨, 회귀 방지 필요:

- signup/read path throttler hotfix가 latest revision 이후에도 유지되는지 regression test를 고정한다.
- rate-limit key를 Cloudflare edge IP가 아니라 real client IP 기준으로 바꾼다.

P1 - 현재 사용자 영향 가능:

- Twilio Verify `60410` 운영 대응: Twilio Console unblock/appeal, 테스트 번호 분리, blocked-number UX copy 보강.
- Naver social withdrawn/missing link handling: `server_error` redirect 대신 명시적 account state error로 분기하고, orphan social account read-only audit를 수행한다.

P2 - 운영 관측성:

- Cloudflare WAF/security events 접근 권한을 보강하거나 Logpush를 켠다.
- Cloudflare `520`을 Ray ID 기준으로 추적할 수 있게 edge log를 보존한다.
- Cloud Run post-deploy smoke에 `/home/*`, `/performances/:id`, `/payments/confirm` dry-run/sandbox path, `/auth/*` critical path를 포함한다.

## 9. 재현/검증 명령

```bash
gcloud run services list \
  --platform=managed \
  --region=asia-northeast3 \
  --project=grapit-491806

gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name=("grabit-api" OR "grabit-web") AND logName="projects/grapit-491806/logs/run.googleapis.com%2Frequests" AND httpRequest.status>=400' \
  --project=grapit-491806 \
  --freshness=24h \
  --limit=10000 \
  --format=json

gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name=("grabit-api" OR "grabit-web") AND logName="projects/grapit-491806/logs/run.googleapis.com%2Frequests" AND httpRequest.status>=500' \
  --project=grapit-491806 \
  --freshness=7d \
  --limit=1000 \
  --format=json

gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="grabit-api" AND textPayload:"Twilio Verify API 403"' \
  --project=grapit-491806 \
  --freshness=48h \
  --limit=200 \
  --format=json
```

Cloudflare GraphQL은 현재 OAuth login으로 HTTP analytics만 조회 가능했다. WAF/security event dataset은 `authz`로 차단됐다.

## 10. 다음 조사 포인트

- `payments/confirm` 2026-05-15T06:23:32Z 단일 `502`의 Toss/provider trace 확인
- Cloudflare `520` root path의 Ray ID export 또는 dashboard drill-down
- production DB에서 orphan `social_accounts`와 withdrawn user link audit
- Twilio Verify `60410` 대상 번호/prefix에 대한 provider-side unblock 가능 여부 확인

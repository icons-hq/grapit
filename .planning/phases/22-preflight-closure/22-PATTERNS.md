# Phase 22: Preflight Closure - Pattern Map

**Mapped:** 2026-05-04
**Files analyzed:** 20 file/surface entries
**Analogs found:** 20 / 20

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `.planning/phases/22-preflight-closure/22-HUMAN-UAT.md` | documentation / evidence artifact | manual event-driven + request-response evidence | `git show bd8220e:.planning/phases/14-.../14-HUMAN-UAT.md`, `15-HUMAN-UAT.md`, `16-HUMAN-UAT.md`, `20-HUMAN-UAT.md` | exact |
| `.planning/phases/22-preflight-closure/22-EVIDENCE-LEDGER.md` | documentation / evidence ledger | batch traceability | `.planning/phases/22-preflight-closure/22-UI-SPEC.md`, `.planning/milestones/v1.0-phases/05-polish-launch/05-VERIFICATION.md` | role-match |
| `.planning/phases/22-preflight-closure/22-VALIDATION-BASELINE.md` | documentation / validation baseline | batch transform | `.planning/milestones/v1.1-MILESTONE-AUDIT.md`, `git show bd8220e:.planning/phases/21-.../21-VERIFICATION.md` | exact |
| `.planning/phases/22-preflight-closure/22-HARDENING-REGISTER.md` | documentation / risk register | batch risk classification | `.planning/milestones/v1.0-phases/04-booking-payment/04-SECURITY.md`, `20-VERIFICATION.md`, `08-VERIFICATION.md`, `15-VERIFICATION.md` | role-match |
| `.planning/phases/22-preflight-closure/22-VERIFICATION.md` | documentation / verification report | batch verification | `git show bd8220e:.planning/phases/21-.../21-VERIFICATION.md`, `.planning/milestones/v1.0-phases/05-polish-launch/05-VERIFICATION.md` | exact |
| `scripts/smoke-valkey-production.mjs` | utility / smoke script | request-response + file-I/O + ops observation | `scripts/smoke-valkey-production.mjs` | exact |
| `apps/api/src/modules/sms/sms.service.ts` | service | request-response + Valkey CRUD + provider I/O | `apps/api/src/modules/sms/sms.service.ts` | exact |
| `apps/web/components/auth/phone-verification.tsx` | component | event-driven request-response | `apps/web/components/auth/phone-verification.tsx` | exact |
| `apps/api/test/sms-cluster-crossslot.integration.spec.ts` | test | integration / cluster Valkey | `apps/api/test/sms-cluster-crossslot.integration.spec.ts` | exact |
| `apps/api/src/modules/auth/email/email.service.ts` | service | email I/O request-response | `apps/api/src/modules/auth/email/email.service.ts` | exact |
| `apps/api/src/modules/auth/email/email.service.spec.ts` | test | unit / mocked provider | `apps/api/src/modules/auth/email/email.service.spec.ts` | exact |
| `apps/web/app/auth/reset-password/page.tsx` | component / page | request-response | `apps/web/app/auth/reset-password/page.tsx` | exact |
| `apps/web/app/auth/reset-password/__tests__/reset-password.test.tsx` | test | component request-response | `apps/web/app/auth/reset-password/__tests__/reset-password.test.tsx` | exact |
| `apps/web/app/legal/{terms,privacy,marketing}/page.tsx`, `apps/web/app/legal/robots.ts` | route / static page | static request-response | existing legal route files | exact |
| `apps/web/components/layout/footer.tsx` | component | static navigation + mailto | `apps/web/components/layout/footer.tsx` | exact |
| `apps/web/content/legal/__tests__/legal-content.test.ts` | test | static content validation | `apps/web/content/legal/__tests__/legal-content.test.ts` | exact |
| `apps/web/app/legal/__tests__/metadata.test.ts` | test | metadata transform validation | `apps/web/app/legal/__tests__/metadata.test.ts` | exact |
| `apps/api/src/modules/admin/upload.service.ts` | service | R2/file-I/O | `apps/api/src/modules/admin/upload.service.ts` | exact |
| `apps/api/src/modules/admin/upload.service.spec.ts` | test | unit / mocked S3 + file-I/O | `apps/api/src/modules/admin/upload.service.spec.ts` | exact |
| `apps/api/test/booking-cluster-lua.integration.spec.ts` | test | integration / Valkey CRUD | `apps/api/test/booking-cluster-lua.integration.spec.ts` | exact |

## Pattern Assignments

### `.planning/phases/22-preflight-closure/22-HUMAN-UAT.md` (documentation, manual event-driven evidence)

**Analogs:** historical Phase 14/15/16/20 `HUMAN-UAT.md` artifacts from commit `bd8220e`.

**SMS real-device checklist pattern** (`14-HUMAN-UAT.md` lines 19-38):

```markdown
## SC-1: 프로덕션 실기기 회원가입 SMS 인증 성공 (LOCKED D-20)

**Steps:**
1. 실제 휴대폰(iOS 또는 Android 실기기) 으로 `https://heygrabit.com/signup` 접속
2. 회원가입 3단계 (전화번호 인증) 에서 **실제 수신 가능한 번호** 입력 → "인증번호 발송" 클릭
3. SMS 수신 확인 — 문구: `[Grabit] 인증번호 NNNNNN (3분 이내 입력)`
4. 수신한 6자리 코드 입력 → "확인" 클릭
5. **Expected:** 4단계 (비밀번호 설정) 로 진행됨. 에러 메시지 없음.

**체크리스트:**
- [ ] SMS 수신 시간 < 30s
- [ ] 코드 입력 후 성공 응답 시간 < 2s
- [ ] 에러 alert 미표시
- [ ] 회원가입 완료까지 진행
```

**Email inbox + observation pattern** (`15-HUMAN-UAT.md` lines 28-47, 55-76):

```markdown
## SC-1: 프로덕션 3사 inbox 수신 검증 (LOCKED D-14)

**Steps:**
1. https://heygrabit.com/auth/forgot-password 접속 (또는 직접 API 호출)
2. 수신 메일 주소 입력
3. "비밀번호 재설정 링크 받기" 클릭
4. inbox 에서 subject/from/body/link 확인

**체크리스트:**
- [ ] Gmail inbox 수신 시각: __________

## SC-2: Silent failure 관측성 확인 (Sentry + Cloud Logging)
- [ ] Sentry email-service 이벤트 0 건 확인 시각: __________
```

**Legal sign-off + public URL pattern** (`16-HUMAN-UAT.md` lines 20-46, 75-97, 110-118):

```markdown
| 항목 | 현재 markdown 값 | 확인 증빙 | 상태 |
|------|------------------|-----------|------|
| 사업자명 | `(주)아이콘스` | 사업자등록증 | pending operator sign-off |

- [ ] **UAT-3:** mailbox 수신 검증 — 외부 메일에서 `support@heygrabit.com`으로 송신
- [ ] **UAT-4:** mailbox 수신 검증 — 외부 메일에서 `privacy@heygrabit.com`으로 송신
- [ ] **UAT-5:** status: `curl -fsSI https://heygrabit.com/legal/terms | head -1`
- [ ] **UAT-8:** prod 임의 페이지에서 Footer "이용약관" 클릭 → `/legal/terms` 이동

**Cutover Approval:** pending external legal/operator sign-off
```

**Valkey smoke / redaction pattern** (`20-HUMAN-UAT.md` lines 22-52, 258-291):

```markdown
## Production Runtime Contract

- [ ] Cloud Run service: `grabit-api`
- [ ] Production API origin: `https://api.heygrabit.com`
- [ ] Memorystore instance: `grabit-valkey`
- [ ] Live Memorystore mode: `CLUSTER`
- [ ] Runtime mode comparison result: PASS / FAIL

## PII And Secret Redaction Rules

Never record actual secret or customer values.

Banned values:
- full `redis://` connection values
- `Authorization` header values
- `Cookie` header values
- JWT-like token values
- phone numbers
```

**Apply to Phase 22:** Combine the four analogs into one operator artifact with sections ordered SMS, Email, Legal, Valkey/R2/hardening. Use Phase 22 statuses `PASS`, `ACCEPTED_RISK`, `BLOCKER`; keep raw OTPs, full phone numbers, reset links, cookies, auth headers, and secrets out.

---

### `.planning/phases/22-preflight-closure/22-EVIDENCE-LEDGER.md` (documentation, batch traceability)

**Analogs:** `.planning/phases/22-preflight-closure/22-UI-SPEC.md`, `.planning/milestones/v1.0-phases/05-polish-launch/05-VERIFICATION.md`.

**Required ledger table shape** (`22-UI-SPEC.md` lines 153-166):

```markdown
| Column | Required Content |
|--------|------------------|
| Gate | `SMS`, `Email`, `Legal`, `Validation Backfill`, or `Hardening` |
| Requirement | `PREF-01`, `PREF-02`, or `PREF-03` |
| Status | Exact allowed status label |
| Evidence | Relative file path, log query, screenshot path, or Sentry/Cloud Run reference after redaction |
| Checked At | KST timestamp |
| Owner | Maintainer, operator, or named role |
| Risk / Caveat | Required for `ACCEPTED_RISK` and `ACCEPTED_CAVEAT`; use `-` for clean `PASS` |
| Next Action | Required for `BLOCKER`; otherwise `-` |
```

**Evidence status rules** (`22-UI-SPEC.md` lines 178-181):

```markdown
- `PASS` requires direct evidence and may use `CheckCircle2`.
- `ACCEPTED_RISK` must use warning color and must show maintainer/operator approval date.
- `BLOCKER` must use destructive color and must show owner plus next action.
- Do not collapse `ACCEPTED_RISK` into success copy or success color.
```

**Verification table pattern** (`05-VERIFICATION.md` lines 41-48, 54-87):

```markdown
| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC1 | ... | ✓ VERIFIED | ... |

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/web/components/layout/mobile-tab-bar.tsx` | MobileTabBar 4탭 컴포넌트 | ✓ VERIFIED | ... |
```

**Apply to Phase 22:** Make the evidence ledger the canonical gate matrix. Each row must be independently classifiable and must link to `22-HUMAN-UAT.md`, `22-VALIDATION-BASELINE.md`, `22-HARDENING-REGISTER.md`, or a redacted artifact path.

---

### `.planning/phases/22-preflight-closure/22-VALIDATION-BASELINE.md` (documentation, batch transform)

**Analogs:** `.planning/milestones/v1.1-MILESTONE-AUDIT.md`, `21-VERIFICATION.md` from commit `bd8220e`.

**Baseline blocker and matrix pattern** (`v1.1-MILESTONE-AUDIT.md` lines 196-207, 227-249):

```markdown
## Blockers

### 1. Missing Phase Verification Artifacts

Workflow rule: if a phase is missing `VERIFICATION.md`, it is a blocker.

| Phase | Status | Evidence |
|-------|--------|----------|
| 06-social-login-bugfix | missing verification | `06-VALIDATION.md` exists, summaries exist, but no `06-VERIFICATION.md` |

## Requirement Matrix

| Requirement | Phase | Final | Evidence |
|-------------|-------|-------|----------|
| AUTH-01 | 6 | orphaned | No `06-VERIFICATION.md`; absent from all verification files |
| R2-04 | 8 | partial | SUMMARY lists it; no `08-VERIFICATION.md` |
```

**Non-fabrication backfill pattern** (`21-VERIFICATION.md` lines 16-20, 24-44, 91-99):

```markdown
Phase 21의 목표는 runtime 기능 구현이 아니라, ... 실제 기존 evidence에 맞게 복구하는 것이다.
SUMMARY claim은 근거로 쓰지 않고, 생성된 target artifact, 원본 phase evidence, static guard command, commit file scope를 역방향으로 확인했다.

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 3 | generated artifact는 실제 code/ops evidence를 참조하고 없는 evidence를 satisfied로 표시하지 않는다. | VERIFIED | ... |

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| R2-04 | ... | 커스텀 도메인 설정 | PARTIAL PRESERVED | ... deferred custom-domain work is not converted into a satisfied claim. |
```

**Apply to Phase 22:** Convert historical statuses into Phase 22 vocabulary: `COMPLETE`, `ACCEPTED_CAVEAT`, `BLOCKER`. Cite historical artifacts by `git show bd8220e:<path>` where the current tree no longer contains the phase folder. Do not rewrite Phase 14/15/16 history as newly executed evidence.

---

### `.planning/phases/22-preflight-closure/22-HARDENING-REGISTER.md` (documentation, batch risk classification)

**Analogs:** `.planning/milestones/v1.0-phases/04-booking-payment/04-SECURITY.md`, Phase 20/08/15 verification artifacts.

**Accepted risk log pattern** (`04-SECURITY.md` lines 13-22, 26-48):

```markdown
| Threat ID | Category | Disposition | Status | Evidence |
|-----------|----------|-------------|--------|----------|
| T-04-07 | Spoofing | accept | CLOSED | No webhook signature verification. Accepted risk: ... Risk documented below. |

### T-04-07 — Spoofing: No Webhook Signature Verification

**Risk:** ...
**Accepted because:** ...
**Residual risk:** ...
**Review trigger:** ...
```

**Runtime hardening caveat pattern** (`20-VERIFICATION.md` lines 32-42, 46-58, 107-133):

```markdown
| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 7 | Cloud Run revision has recorded Valkey ping, Lua lock path, and Socket.IO propagation smoke evidence. | HUMAN NEEDED | ... no production run evidence exists. |

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `scripts/smoke-valkey-production.mjs` | repeatable production smoke command | VERIFIED WITH WARNING | ... |

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `.github/workflows/deploy.yml` | 124 | `--session-affinity` with two-socket smoke | WARNING | ... |
```

**R2 hardening chronology pattern** (`08-VERIFICATION.md` lines 55-68, 78-91):

```markdown
### CORS Chronology

- Phase 08: AllowedHeaders included content-type for browser PUT.
- Quick 260427-pcf: allowed headers expanded to content-length and x-amz-* checksum/signing headers.
- Quick 260427-pcf: production admin poster upload was verified on 2026-04-28.

| R2-04 | PARTIAL | ... custom-domain cutover was explicitly deferred until domain ownership. |
```

**Email human-needed pattern** (`15-VERIFICATION.md` lines 40-53, 73-79):

```markdown
| Check | Status | Source | Needed Evidence |
|-------|--------|--------|-----------------|
| Naver inbox | HUMAN NEEDED | `15-HUMAN-UAT.md` SC-1 checklist | Formal Naver inbox receipt timestamp and spam/not-spam result. |
| Sentry email-service zero-count | HUMAN NEEDED | `15-HUMAN-UAT.md` SC-2 checklist | Sentry dashboard confirmation ... |

False-claim guard: unchecked mailbox and Sentry evidence remains HUMAN NEEDED or PARTIAL.
```

**Apply to Phase 22:** Use columns `Area`, `Finding`, `Evidence`, `Disposition`, `Owner`, `Accepted By`, `Due/Checked At`, `Next Action`. Dispositions should be `concrete fix`, `ACCEPTED_RISK`, or `BLOCKER`.

---

### `.planning/phases/22-preflight-closure/22-VERIFICATION.md` (documentation, batch verification)

**Analogs:** `21-VERIFICATION.md`, `05-VERIFICATION.md`, `20-VERIFICATION.md`.

**Frontmatter + goal pattern** (`21-VERIFICATION.md` lines 1-18):

```markdown
---
phase: 21-verification-artifact-backfill
verified: 2026-05-04T03:18:06Z
status: passed
score: "19/19 must-haves verified"
overrides_applied: 0
---

# Phase 21: Verification Artifact Backfill Verification Report

**Phase Goal:** missing `VERIFICATION.md`와 requirement evidence 계약 복구 (gap closure)
```

**Required artifacts + key links + data-flow pattern** (`21-VERIFICATION.md` lines 48-76):

```markdown
| Artifact | Expected | L1 Exists | L2 Substantive | L3 Wired | Status | Details |
|----------|----------|-----------|----------------|----------|--------|---------|
| `.planning/phases/06-social-login-bugfix/06-VERIFICATION.md` | ... | yes | yes | yes | VERIFIED | ... |

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `06-VERIFICATION.md` | `06-02-SUMMARY.md` | AUTH-01 requirement row and frontmatter | WIRED | ... |

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `13-VERIFICATION.md` | Static caveat evidence | ... | yes, preserves mixed evidence and open UAT rows | VERIFIED |
```

**Human-needed final status pattern** (`20-VERIFICATION.md` lines 117-133):

```markdown
### 1. Production Smoke Approval

**Test:** Fill approved smoke env/auth/fixture values and run `pnpm --filter @grabit/web exec node ../../scripts/smoke-valkey-production.mjs --check all`.
**Expected:** `20-HUMAN-UAT.md` records real revision-scoped PASS evidence ...
**Why human:** Requires production auth, safe fixture approval, Cloud Run traffic/revision context, PSC/private networking, and Sentry/Cloud Logging observation.

### Gaps Summary

... Do not mark Phase 20 passed until `20-HUMAN-UAT.md` contains real checked PASS evidence.
```

**Apply to Phase 22:** Final verification must explicitly state whether Phase 23 can start. If any ledger row remains `BLOCKER`, status must not be `passed`. If accepted risks remain, list maintainer/operator approvals.

---

### `scripts/smoke-valkey-production.mjs` (utility, request-response + file-I/O)

**Analog:** same file.

**Imports and artifact path pattern** (lines 1-14):

```javascript
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const webRequire = createRequire(new URL('../apps/web/package.json', import.meta.url));
const { io } = webRequire('socket.io-client');

const defaultArtifactUrl = new URL('../.planning/phases/20-valkey-production-connectivity-contract/20-HUMAN-UAT.md', import.meta.url);
const artifactPath = process.env.GRABIT_SMOKE_ARTIFACT ?? fileURLToPath(defaultArtifactUrl);
```

**Env/help/redaction pattern** (lines 35-63, 85-97):

```javascript
function usage() {
  return `
Optional environment:
  GRABIT_SMOKE_ARTIFACT                  Evidence markdown path. Default: script-root 20-HUMAN-UAT.md

  Security:
  The script records command shape, revision, mode, PASS/FAIL, and sanitized summaries only.
  It redacts redis:// and rediss:// values, Authorization, Cookie, JWT, phone, paymentKey, orderId, and private customer data markers.
`;
}

function redact(value) {
  return String(value)
    .replace(REDIS_URL_PATTERN, '[redacted redis url]')
    .replace(/\bAuthorization:\s*Bearer\s+[^\s`'")]+/gi, 'Authorization: Bearer <redacted>')
    .replace(/\bCookie:\s*[^`\n\r]+/gi, 'Cookie: <redacted>')
    .replace(PHONE_PATTERN, '<phone:redacted>');
}
```

**Evidence write pattern** (lines 774-827, 831-867):

```javascript
async function runChecks(config) {
  const startedUtc = new Date().toISOString();
  const checks = [];

  if (config.check === 'health' || config.check === 'all') {
    checks.push(await captureCheck('Health Ping Smoke', () => checkHealth(config)));
  }
  if (config.check === 'logs' || config.check === 'all') {
    checks.push(await captureCheck('Log And Sentry Cleanliness', () => checkLogs(config, cloudRun, logSinceOverride || startedUtc)));
  }

  const evidence = {
    startedUtc,
    completedUtc: new Date().toISOString(),
    commandShape: commandShape(config.check),
    artifactPath: config.artifactPath,
    checks,
    overallOk: modeContractOk && allChecksOk,
  };

  await writeArtifact(evidence);
  return evidence;
}

async function writeArtifact(evidence) {
  await mkdir(dirname(evidence.artifactPath), { recursive: true });
  await appendFile(evidence.artifactPath, redact(lines.join('\n')), 'utf8');
}
```

**Apply to Phase 22:** If planner chooses a code fix, change only the default artifact path and help text to Phase 22, preserving `GRABIT_SMOKE_ARTIFACT` override and redaction. If planner avoids code change, every Phase 22 command must set `GRABIT_SMOKE_ARTIFACT=.planning/phases/22-preflight-closure/artifacts/valkey-smoke.md` or a documented equivalent.

---

### SMS source/test surfaces

#### `apps/api/src/modules/sms/sms.service.ts` (service, request-response + Valkey CRUD)

**Imports / DI pattern** (lines 1-11, 131-140):

```typescript
import {
  Inject, Injectable, BadRequestException, GoneException, HttpException,
  HttpStatus, Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Sentry from '@sentry/nestjs';
import type IORedis from 'ioredis';
import { REDIS_CLIENT } from '../booking/providers/redis.provider.js';

@Injectable()
export class SmsService {
  constructor(
    configService: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: IORedis,
  ) {
```

**Valkey hash-tag key contract** (lines 83-126):

```typescript
const E164_RE = /^\+\d{6,15}$/;
function assertE164(s: string): void {
  if (!E164_RE.test(s)) {
    throw new Error(`[sms] non-E164 key input: ${s.slice(0, 4)}***`);
  }
}
export const smsOtpKey           = (e164: string): string => { assertE164(e164); return `{sms:${e164}}:otp`; };
export const smsAttemptsKey      = (e164: string): string => { assertE164(e164); return `{sms:${e164}}:attempts`; };
export const smsVerifiedKey      = (e164: string): string => { assertE164(e164); return `{sms:${e164}}:verified`; };
```

**Verify/error/Sentry pattern** (lines 405-461):

```typescript
const result = (await this.redis.eval(
  VERIFY_AND_INCREMENT_LUA,
  3,
  smsOtpKey(e164),
  smsAttemptsKey(e164),
  smsVerifiedKey(e164),
  code,
  String(OTP_MAX_ATTEMPTS),
  String(VERIFIED_FLAG_TTL_SEC),
)) as [string, number];

switch (status) {
  case 'VERIFIED':
    return { verified: true };
  case 'WRONG':
    return { verified: false, message: '인증번호가 일치하지 않습니다' };
  case 'EXPIRED':
    throw new GoneException('인증번호가 만료되었습니다. 재발송해주세요');
}

Sentry.withScope((scope) => {
  scope.setTag('provider', 'valkey');
  scope.setLevel('error');
  Sentry.captureException(err);
});
this.logger.error({ event: 'sms.verify_failed', phone: e164, err: (err as Error).message });
return { verified: false, message: '인증번호 확인에 실패했습니다. 잠시 후 다시 시도해주세요.' };
```

**Apply to Phase 22:** Any SMS fix must preserve distinct `WRONG`, `EXPIRED`/`NO_MORE_ATTEMPTS`, and Valkey/system-error copy. Observation queries should look for `sms.verify_failed`, `CROSSSLOT`, and Sentry tag `provider=valkey`.

#### `apps/web/components/auth/phone-verification.tsx` (component, event-driven request-response)

**Server-message-priority pattern** (lines 129-155, 274-281):

```typescript
const res = await apiClient.post<{ verified: boolean; message?: string }>(
  '/api/v1/sms/verify-code',
  { phone, code },
);
if (res.verified) {
  clearTimer();
  onVerified(code);
} else {
  const fallback = '인증번호가 일치하지 않습니다';
  const serverMessage =
    typeof res.message === 'string' && res.message.length > 0
      ? res.message
      : null;
  setVerifyError(serverMessage ?? fallback);
}

{verifyError && (
  <p role="alert" className="text-caption text-error animate-in fade-in duration-150">
    {verifyError}
  </p>
)}
```

**Apply to Phase 22:** Failure-copy UAT screenshots should cover wrong code, expired/resend, and system error. Do not collapse backend messages into the wrong-code fallback.

#### `apps/api/test/sms-cluster-crossslot.integration.spec.ts` (test, cluster integration)

**Testcontainers cluster pattern** (lines 1-25, 72-158):

```typescript
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import IORedis, { Cluster } from 'ioredis';
import {
  VERIFY_AND_INCREMENT_LUA,
  smsOtpKey,
  smsAttemptsKey,
  smsVerifiedKey,
} from '../src/modules/sms/sms.service.js';

describe('SMS OTP — Valkey Cluster mode (hash-tag regression guard)', () => {
  beforeAll(async () => {
    container = await new GenericContainer('valkey/valkey:8')
      .withExposedPorts(6379)
      .withCommand(['valkey-server', '--cluster-enabled', 'yes'])
      .start();
    await boot.call('CLUSTER', 'ADDSLOTSRANGE', '0', '16383');
    cluster = new IORedis.Cluster([{ host, port }], { natMap, lazyConnect: true });
    await cluster.connect();
  }, 180_000);
});
```

**CROSSSLOT guard pattern** (lines 160-174, 258-287):

```typescript
await expect(
  cluster.eval(
    VERIFY_AND_INCREMENT_LUA,
    3,
    `sms:otp:${PHONE}`,
    `sms:attempts:${PHONE}`,
    `sms:verified:${PHONE}`,
    '123456',
    '5',
    '600',
  ),
).rejects.toThrow(/CROSSSLOT/);

const s1 = await cluster.call('CLUSTER', 'KEYSLOT', smsOtpKey(PHONE));
const s2 = await cluster.call('CLUSTER', 'KEYSLOT', smsAttemptsKey(PHONE));
const s3 = await cluster.call('CLUSTER', 'KEYSLOT', smsVerifiedKey(PHONE));
expect(s1).toBe(s2);
expect(s2).toBe(s3);
```

**Apply to Phase 22:** For SMS/Valkey hardening fixes, keep this spec or an equivalent focused integration run in validation.

---

### Email reset source/test surfaces

#### `apps/api/src/modules/auth/email/email.service.ts` (service, email I/O)

**Imports and production hard-fail pattern** (lines 1-5, 32-73):

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import * as Sentry from '@sentry/nestjs';

const apiKey = this.configService.get<string>('RESEND_API_KEY');
const fromEmail = this.configService.get<string>('RESEND_FROM_EMAIL');
const isNonDev = nodeEnv !== 'development' && nodeEnv !== 'test';

if (isNonDev && !apiKey) {
  throw new Error('[email] RESEND_API_KEY is required outside development/test environments. ...');
}
if (isNonDev) {
  if (!fromEmail || !EMAIL_PATTERN.test(fromEmail)) {
    throw new Error('[email] RESEND_FROM_EMAIL must be a valid email outside development/test. ...');
  }
  this.from = fromEmail;
}
```

**Resend accepted id + Sentry pattern** (lines 75-126):

```typescript
const { data, error } = await this.resend.emails.send({
  from: this.from,
  to,
  subject: '[Grabit] 비밀번호 재설정',
  react: PasswordResetEmail({ resetLink }),
});

if (!error) {
  return { success: true, id: data?.id };
}

Sentry.withScope((scope) => {
  scope.setTag('component', 'email-service');
  scope.setTag('provider', 'resend');
  scope.setContext('email', {
    from: this.from,
    toDomain,
    attempts: attempt,
  });
  Sentry.captureException(new Error(`Resend send failed: ${error.message}`));
});
return { success: false, error: error.message };
```

**Apply to Phase 22:** Email `PASS` evidence must include Resend accepted id, Gmail receipt, reset confirm, login, and Cloud Run/Sentry observation. Do not store full recipient addresses or reset links in artifacts.

#### `apps/api/src/modules/auth/email/email.service.spec.ts` (test, mocked provider)

**Mocking and config pattern** (lines 1-45):

```typescript
vi.mock('resend', () => {
  const sendMock = vi.fn();
  return {
    Resend: vi.fn().mockImplementation(() => ({
      emails: { send: sendMock },
    })),
    __sendMock: sendMock,
  };
});

function makeConfig(env: Record<string, string | undefined>): ConfigService {
  return {
    get: vi.fn(<T>(key: string, defaultValue?: T): T | undefined => {
      const v = env[key];
      return (v !== undefined ? v : defaultValue) as T | undefined;
    }),
  } as unknown as ConfigService;
}
```

**PII/Sentry assertions** (lines 138-181, 217-240):

```typescript
expect(sentryMod.__withScopeMock).toHaveBeenCalledTimes(1);
expect(sentryMod.__captureExceptionMock).toHaveBeenCalledTimes(1);
expect(sentryMod.__scopeStub.setContext).toHaveBeenCalledWith('email', {
  from: 'no-reply@heygrabit.com',
  toDomain: 'example.com',
  attempts: 1,
});
const serialized = JSON.stringify([allSetContextCalls, allSetTagCalls]);
expect(serialized).not.toContain('user@example.com');
```

**Apply to Phase 22:** Use these tests as the automated guard if email service behavior is touched.

#### `apps/web/app/auth/reset-password/page.tsx` and `__tests__/reset-password.test.tsx` (component/page + test)

**Request/confirm fetch pattern** (`page.tsx` lines 60-75, 173-210):

```typescript
await fetch(apiUrl('/api/v1/auth/password-reset/request'), {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  credentials: 'include',
  body: JSON.stringify(data),
});

const res = await fetch(apiUrl('/api/v1/auth/password-reset/confirm'), {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  credentials: 'include',
  body: JSON.stringify(data),
});

if (res.ok) {
  toast.success('비밀번호가 변경되었습니다. 다시 로그인해주세요.');
  router.push('/auth');
  return;
}
```

**Exact API-origin regression pattern** (`reset-password.test.tsx` lines 62-93, 110-149):

```typescript
vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.heygrabit.com');
expect(fetchMock).toHaveBeenCalledWith(
  'https://api.heygrabit.com/api/v1/auth/password-reset/request',
  expect.objectContaining({
    method: 'POST',
    credentials: 'include',
  }),
);

const [url, init] = fetchMock.mock.calls[0];
expect(String(url)).toBe(
  'https://api.heygrabit.com/api/v1/auth/password-reset/confirm',
);
expect((init as RequestInit).method).toBe('POST');
```

**Apply to Phase 22:** Manual email UAT should follow request -> Gmail receipt -> confirm -> login. If code changes, focused web test is the analog.

---

### Legal source/test surfaces

#### `apps/web/app/legal/{terms,privacy,marketing}/page.tsx`, `apps/web/app/legal/robots.ts` (static route)

**Static metadata/canonical/robots pattern** (`terms/page.tsx` lines 1-25, `robots.ts` lines 1-10):

```typescript
import type { Metadata } from 'next';
import termsMd from '@/content/legal/terms-of-service.md?raw';
import { TermsMarkdown } from '@/components/legal/terms-markdown';
import { getLegalRobots } from '../robots';

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: '이용약관 — Grabit',
  alternates: {
    canonical: 'https://heygrabit.com/legal/terms',
  },
  robots: getLegalRobots(),
};

export function getLegalRobots() {
  const isProd =
    process.env.GRABIT_ENV === 'production' ||
    (process.env.GRABIT_ENV == null && process.env.NODE_ENV === 'production');
  return { index: isProd, follow: isProd };
}
```

**Apply to Phase 22:** Public legal URL checks should verify `/legal/terms`, `/legal/privacy`, `/legal/marketing`, canonical URL, and production robots behavior without adding new legal marketing copy.

#### `apps/web/components/layout/footer.tsx` and footer test (component + test)

**Footer legal/support link pattern** (`footer.tsx` lines 1-29):

```tsx
<Link href="/legal/terms" className="hover:underline">
  이용약관
</Link>
<Link href="/legal/privacy" className="font-semibold hover:underline">
  개인정보처리방침
</Link>
<a href="mailto:support@heygrabit.com" className="hover:underline">
  고객센터
</a>
```

**Regression test pattern** (`footer.test.tsx` lines 5-52):

```typescript
it('개인정보처리방침 링크가 /legal/privacy 로 연결되며 font-semibold 강조를 유지한다 (정통망법)', () => {
  render(<Footer />);
  const link = screen.getByText('개인정보처리방침').closest('a');
  expect(link?.getAttribute('href')).toBe('/legal/privacy');
  expect(link?.className).toContain('font-semibold');
});

it('Footer 에 /legal/marketing 링크가 등장하지 않는다', () => {
  const { container } = render(<Footer />);
  expect(container.innerHTML).not.toContain('/legal/marketing');
});
```

**Apply to Phase 22:** Footer checks are part of Legal `PASS`; do not expose `/legal/marketing` globally unless a later phase changes the contract.

#### Legal content/metadata tests

**Placeholder/business identity pattern** (`legal-content.test.ts` lines 13-61):

```typescript
const placeholderPatterns = [
  /\[사업자명:/,
  /\[대표자명:/,
  /000-00-00000/,
  /YYYY-MM-DD/,
];

it.each(Object.entries(legalDocuments))(
  '%s does not expose launch placeholder values',
  (_filename, content) => {
    for (const pattern of placeholderPatterns) {
      expect(content).not.toMatch(pattern);
    }
  },
);

expect(termsOfServiceMd).toContain('사업자명: (주)아이콘스');
expect(privacyPolicyMd).toContain('SMS 발송**: Infobip Limited 및 그 계열사');
```

**Metadata test pattern** (`metadata.test.ts` lines 18-38, 40-54, 117-132):

```typescript
const pageModules = import.meta.glob<LegalPageModule>('../*/page.tsx');

async function loadLegalPage(
  globKey: '../terms/page.tsx' | '../privacy/page.tsx' | '../marketing/page.tsx',
  contractImport: string,
) {
  const loader = pageModules[globKey];
  if (!loader) {
    throw new Error(`${contractImport} 모듈이 아직 생성되지 않았습니다.`);
  }
  return loader();
}

expect(mod.metadata.alternates?.canonical).toBe(
  'https://heygrabit.com/legal/terms',
);
expect(getLegalRobots()).toEqual({ index: false, follow: false });
```

**Apply to Phase 22:** If legal route/content changes are needed, run both content and metadata suites and reflect factual sign-off separately from automated proof.

---

### R2 source/test surfaces

#### `apps/api/src/modules/admin/upload.service.ts` (service, R2/file-I/O)

**Imports/S3 client/local fallback pattern** (lines 1-49):

```typescript
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

this.isLocalMode = !accountId;

if (this.isLocalMode) {
  this.s3 = null;
  this.logger.warn(
    'R2_ACCOUNT_ID not configured — running in local file storage mode',
  );
} else {
  this.s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    forcePathStyle: true,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}
```

**Presigned URL + path safety pattern** (lines 51-88, 90-120):

```typescript
const key = `${folder}/${randomUUID()}.${extension}`;

if (this.isLocalMode) {
  return {
    uploadUrl: `${apiBase}/api/v1/admin/upload/local/${key}`,
    publicUrl: `${apiBase}/api/v1/admin/upload/local/${key}`,
    key,
    mode: 'local' as const,
  };
}

const command = new PutObjectCommand({
  Bucket: this.bucketName,
  Key: key,
  ContentType: contentType,
});
const uploadUrl = await getSignedUrl(this.s3!, command, { expiresIn: 600 });

private validateLocalPath(key: string): string {
  const uploadDir = path.resolve(path.join(process.cwd(), 'uploads'));
  const filePath = path.resolve(path.join(uploadDir, key));
  if (!filePath.startsWith(uploadDir + path.sep) && filePath !== uploadDir) {
    throw new BadRequestException('Invalid file path');
  }
  return filePath;
}
```

**Apply to Phase 22:** R2 hardening rows should distinguish production R2 mode from local fallback. In production evidence, `mode: local` or `/uploads/` style URLs should be `BLOCKER` or accepted explicitly.

#### `apps/api/src/modules/admin/upload.service.spec.ts` (test, mocked S3/file-I/O)

**S3 mock + R2 mode assertions** (lines 1-22, 50-127):

```typescript
vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://r2.example.com/signed-upload-url'),
}));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(() => ({})),
  PutObjectCommand: vi.fn().mockImplementation((input: Record<string, unknown>) => ({ input })),
}));

expect(S3Client).toHaveBeenCalledWith(
  expect.objectContaining({
    forcePathStyle: true,
    region: 'auto',
    endpoint: 'https://test-account-id.r2.cloudflarestorage.com',
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  }),
);
```

**Local fallback tests** (lines 129-170):

```typescript
mockConfigService = createMockConfigService({
  R2_ACCOUNT_ID: '',
});
service = new UploadService(mockConfigService as unknown as ConstructorParameters<typeof UploadService>[0]);

expect(service.isLocalMode).toBe(true);
expect(result.mode).toBe('local');
expect(result.uploadUrl).toMatch(
  /^http:\/\/localhost:8080\/api\/v1\/admin\/upload\/local\/posters\//,
);
```

**Apply to Phase 22:** If R2 source changes are made, keep these tests focused around checksum, mode, public URL, and local fallback.

---

### Valkey booking hardening surface

#### `apps/api/test/booking-cluster-lua.integration.spec.ts` (test, integration / Valkey CRUD)

**Cluster topology pattern** (lines 1-20, 80-148):

```typescript
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import IORedis, { Cluster } from 'ioredis';
import { BookingService } from '../src/modules/booking/booking.service.js';

describe('BookingService Lua scripts — Valkey Cluster mode', () => {
  beforeAll(async () => {
    container = await new GenericContainer('valkey/valkey:8')
      .withExposedPorts(6379)
      .withCommand(['valkey-server', '--cluster-enabled', 'yes'])
      .start();
    await boot.call('CLUSTER', 'ADDSLOTSRANGE', '0', '16383');
    cluster = new IORedis.Cluster([{ host, port }], {
      natMap,
      lazyConnect: true,
      scaleReads: 'master',
    });
    service = createBookingService(cluster);
  }, 180_000);
});
```

**Cluster lock behavior pattern** (lines 159-227, 229-260):

```typescript
await expect(
  cluster.eval(
    `redis.call('SADD', KEYS[1], ARGV[1])`,
    3,
    legacyUserSeatsKey,
    legacyLockKey,
    legacyLockedSeatsKey,
    seatId,
    userId,
  ),
).rejects.toThrow(/CROSSSLOT/);

await expect(service.lockSeat(userId, showtimeId, seatId))
  .resolves
  .toMatchObject({
    success: true,
    lockId: lockKey,
    seatId,
  });

await expect(service.unlockSeat(userId, showtimeId, seatId))
  .resolves
  .toBe(true);
```

**Apply to Phase 22:** For Valkey hardening, use this alongside `scripts/smoke-valkey-production.mjs` to separate local cluster correctness from production runtime proof.

## Shared Patterns

### Status Vocabulary

**Sources:** `22-CONTEXT.md` lines 21-25, 47-49; `22-UI-SPEC.md` lines 146-148, 178-181.

```markdown
Gate statuses: `PASS`, `ACCEPTED_RISK`, `BLOCKER`
Validation statuses: `COMPLETE`, `ACCEPTED_CAVEAT`, `BLOCKER`

`PASS` requires direct evidence.
`ACCEPTED_RISK` requires maintainer technical risk approval and operator business launch risk approval.
`BLOCKER` requires owner plus next action.
```

**Apply to:** `22-HUMAN-UAT.md`, `22-EVIDENCE-LEDGER.md`, `22-VALIDATION-BASELINE.md`, `22-HARDENING-REGISTER.md`, `22-VERIFICATION.md`.

### Redaction / Secret Hygiene

**Sources:** `20-HUMAN-UAT.md` lines 258-279; `18-VERIFICATION.md` lines 34-39, 87-95; `email.service.spec.ts` lines 158-181; `scripts/smoke-valkey-production.mjs` lines 85-97.

```markdown
Never record:
- raw OTPs
- full phone numbers
- full recipient email addresses, except public sender addresses when needed
- reset links or reset tokens
- cookies, bearer tokens, auth headers, JWTs
- Redis URLs, Secret Manager values, R2 keys, Resend tokens
```

**Apply to:** all Phase 22 artifacts and smoke output.

### Human Evidence Is Not Automated Proof

**Sources:** `21-VERIFICATION.md` lines 18-20; `20-VERIFICATION.md` lines 117-133; `15-VERIFICATION.md` lines 73-79.

```markdown
Do not convert missing dashboard/mailbox/device evidence into `PASS`.
Use `ACCEPTED_RISK` or `BLOCKER` when direct evidence is absent.
Historical artifacts may be cited as context, but Phase 22 evidence must be recorded separately.
```

**Apply to:** SMS real-device gate, Gmail/reset-to-login gate, legal sign-off/mailbox gate, Sentry/Cloud Run observation, R2 live config, Valkey production smoke.

### Runtime Observation Pattern

**Sources:** `SmsService.verifyCode` lines 455-461; `EmailService.sendPasswordResetEmail` lines 103-119; `smoke-valkey-production.mjs` lines 774-827.

```markdown
Observation bundle:
- UAT timestamp in KST
- Cloud Run log query or Sentry dashboard/API result
- provider tag or component tag, when present
- redacted screenshot/log path
- status and next action
```

**Apply to:** SMS `sms.verify_failed` / `CROSSSLOT` / `provider=valkey`, email `component=email-service`, Valkey smoke logs, R2 provider/config evidence.

### No New Phase 22 UI by Default

**Source:** `22-UI-SPEC.md` lines 18-39, 191-203.

```markdown
Default contract: no new user-facing UI.
Evidence ledger docs use Markdown tables and checklist sections only.
If shipped SMS/email/legal surfaces are touched, preserve current flow and only fix failed gate behavior.
```

**Apply to:** all planning docs; any conditional web component/page fixes.

## No Analog Found

No file/surface lacked a usable analog. Two Phase 22 artifacts have no exact filename predecessor and should use role-match analogs:

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `.planning/phases/22-preflight-closure/22-EVIDENCE-LEDGER.md` | documentation / evidence ledger | batch traceability | No prior `EVIDENCE-LEDGER.md`; `22-UI-SPEC.md` provides the exact table contract and `05-VERIFICATION.md` provides evidence table style. |
| `.planning/phases/22-preflight-closure/22-HARDENING-REGISTER.md` | documentation / risk register | batch risk classification | No prior hardening register; copy risk disposition from `04-SECURITY.md` and runtime warning/caveat tables from Phase 20/08/15 verification artifacts. |

## Metadata

**Analog search scope:** `.planning/phases`, `.planning/milestones`, `.planning/quick`, `.planning/debug`, `apps/api/src/modules`, `apps/api/test`, `apps/web/app`, `apps/web/components`, `apps/web/content`, `scripts`.

**Files scanned:** `rg --files -uu` over `.planning`, `apps/api`, `apps/web`, and `scripts`; targeted analog reads stopped after strong matches for Markdown evidence, SMS, email, legal, R2, and Valkey.

**Pattern extraction date:** 2026-05-04

**Git worktree note:** `.planning/STATE.md` was already modified before this mapper wrote `22-PATTERNS.md`; it was read as context only and not changed.

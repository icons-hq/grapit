---
phase: 21
slug: verification-artifact-backfill
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-05-04
---

# Phase 21 - Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Static artifact checks with `test` and `rg` |
| **Config file** | none |
| **Quick run command** | `test -f .planning/phases/06-social-login-bugfix/06-VERIFICATION.md && test -f .planning/phases/08-r2/08-VERIFICATION.md && test -f .planning/phases/13-grapit-grabit-rename/13-VERIFICATION.md && test -f .planning/phases/15-resend-heygrabit-com-cutover-transactional-email-secret-mana/15-VERIFICATION.md` |
| **Full suite command** | `rg -n "\\| AUTH-01 \\|" .planning/phases/06-social-login-bugfix/06-VERIFICATION.md && rg -n "\\| R2-01 \\|" .planning/phases/08-r2/08-VERIFICATION.md && rg -n "\\| R2-02 \\|" .planning/phases/08-r2/08-VERIFICATION.md && rg -n "\\| R2-03 \\|" .planning/phases/08-r2/08-VERIFICATION.md && rg -n "\\| R2-04 \\|" .planning/phases/08-r2/08-VERIFICATION.md && rg -n "AUTH-01" .planning/phases/06-social-login-bugfix/06-02-SUMMARY.md && rg -n "^requirements-completed: \\[R2-01, R2-02, R2-03, R2-04\\]$" .planning/phases/08-r2/08-03-SUMMARY.md` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run the quick artifact existence command plus the `rg` command for the edited phase.
- **After every plan wave:** Run the full suite command and the false-claim guard checks below.
- **Before `$gsd-verify-work`:** Full suite must be green.
- **Max feedback latency:** 10 seconds.

False-claim guard checks:

```bash
rg -n "SATISFIED" \
  .planning/phases/13-grapit-grabit-rename/13-VERIFICATION.md \
  .planning/phases/15-resend-heygrabit-com-cutover-transactional-email-secret-mana/15-VERIFICATION.md
rg -n "\\bpassed\\b" \
  .planning/phases/13-grapit-grabit-rename/13-VERIFICATION.md \
  .planning/phases/15-resend-heygrabit-com-cutover-transactional-email-secret-mana/15-VERIFICATION.md
rg -n "human_needed" \
  .planning/phases/13-grapit-grabit-rename/13-VERIFICATION.md \
  .planning/phases/15-resend-heygrabit-com-cutover-transactional-email-secret-mana/15-VERIFICATION.md
rg -n "HUMAN NEEDED" \
  .planning/phases/13-grapit-grabit-rename/13-VERIFICATION.md \
  .planning/phases/15-resend-heygrabit-com-cutover-transactional-email-secret-mana/15-VERIFICATION.md
rg -n "PARTIAL" \
  .planning/phases/13-grapit-grabit-rename/13-VERIFICATION.md \
  .planning/phases/15-resend-heygrabit-com-cutover-transactional-email-secret-mana/15-VERIFICATION.md
```

The first command is an inspection point, not an automatic failure. Any satisfied or passed row in Phase 13/15 verification must cite an existing evidence artifact.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 21-01-01 | 01 | 1 | AUTH-01 | T-21-01 | Only evidence-backed AUTH-01 rows are marked satisfied. | static artifact | `rg -n "\\| AUTH-01 \\|" .planning/phases/06-social-login-bugfix/06-VERIFICATION.md && rg -n "AUTH-01" .planning/phases/06-social-login-bugfix/06-02-SUMMARY.md` | No, Wave 1 creates | pending |
| 21-02-01 | 02 | 1 | R2-01, R2-02, R2-03, R2-04 | T-21-02 | R2 CORS chronology distinguishes Phase 08 evidence from later quick hardening. | static artifact | `rg -n "\\| R2-01 \\|" .planning/phases/08-r2/08-VERIFICATION.md && rg -n "\\| R2-02 \\|" .planning/phases/08-r2/08-VERIFICATION.md && rg -n "\\| R2-03 \\|" .planning/phases/08-r2/08-VERIFICATION.md && rg -n "\\| R2-04 \\|" .planning/phases/08-r2/08-VERIFICATION.md && rg -n "^requirements-completed: \\[R2-01, R2-02, R2-03, R2-04\\]$" .planning/phases/08-r2/08-03-SUMMARY.md` | No, Wave 1 creates | pending |
| 21-03-01 | 03 | 1 | artifact audit gap | T-21-03 | Deferred rename evidence remains partial or human-needed, not falsely passed. | static artifact | `test -f .planning/phases/13-grapit-grabit-rename/13-VERIFICATION.md && rg -n "human_needed" .planning/phases/13-grapit-grabit-rename/13-VERIFICATION.md && rg -n "HUMAN NEEDED" .planning/phases/13-grapit-grabit-rename/13-VERIFICATION.md && rg -n "PARTIAL" .planning/phases/13-grapit-grabit-rename/13-VERIFICATION.md` | No, Wave 1 creates | pending |
| 21-04-01 | 04 | 1 | artifact audit gap | T-21-04 | Deferred email evidence remains partial or human-needed, not falsely passed. | static artifact | `test -f .planning/phases/15-resend-heygrabit-com-cutover-transactional-email-secret-mana/15-VERIFICATION.md && rg -n "human_needed" .planning/phases/15-resend-heygrabit-com-cutover-transactional-email-secret-mana/15-VERIFICATION.md && rg -n "HUMAN NEEDED" .planning/phases/15-resend-heygrabit-com-cutover-transactional-email-secret-mana/15-VERIFICATION.md && rg -n "PARTIAL" .planning/phases/15-resend-heygrabit-com-cutover-transactional-email-secret-mana/15-VERIFICATION.md` | No, Wave 1 creates | pending |

*Status: pending / green / red / flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements. No package installation or test framework setup is required.

The first execution wave must create or update:

- [ ] `.planning/phases/06-social-login-bugfix/06-VERIFICATION.md`
- [ ] `.planning/phases/08-r2/08-VERIFICATION.md`
- [ ] `.planning/phases/13-grapit-grabit-rename/13-VERIFICATION.md`
- [ ] `.planning/phases/15-resend-heygrabit-com-cutover-transactional-email-secret-mana/15-VERIFICATION.md`
- [ ] `.planning/phases/06-social-login-bugfix/06-02-SUMMARY.md`
- [ ] `.planning/phases/08-r2/08-03-SUMMARY.md`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| None | N/A | Phase 21 is a static artifact backfill phase. | N/A |

All Phase 21 behaviors have automated static verification. Existing human-needed evidence in Phase 13, Phase 15, and Phase 20 must stay documented as human-needed instead of being converted into a Phase 21 manual verification task.

---

## Validation Sign-Off

- [x] All tasks have automated static verification or Wave 0 dependencies.
- [x] Sampling continuity: no 3 consecutive tasks without automated verify.
- [x] Wave 0 covers all missing verification artifact references.
- [x] No watch-mode flags.
- [x] Feedback latency < 10s.
- [x] `nyquist_compliant: true` set in frontmatter.

**Approval:** approved 2026-05-04

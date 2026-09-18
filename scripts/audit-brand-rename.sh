#!/usr/bin/env bash
# scripts/audit-brand-rename.sh — Phase 13 rename audit gate.
# Runs SC-1 + SC-4 checks at plan completion.
# Revision 2 (D-10): line-level allowlist (4 entries) via grep -v regex.
#
# Uses `git grep` (ripgrep is not always available in CI/hook environments).
# git grep automatically honors .gitignore and only inspects tracked files.
set -euo pipefail

echo "=== SC-4: .planning/milestones/ 변경 금지 ==="
CHANGED=$(git diff --name-only main...HEAD -- '.planning/milestones/' 2>/dev/null | wc -l | tr -d ' ')
if [ "$CHANGED" -gt 0 ]; then echo "FAIL: milestones touched"; exit 1; fi

echo "=== SC-4: 완료된 phase 폴더 변경 금지 (active 13-grapit-grabit-rename 예외) ==="
CHANGED=$(git diff --name-only main...HEAD -- \
  '.planning/phases/0[1-9]-*' \
  '.planning/phases/1[012]-*' \
  '.planning/phases/09.1-*' \
  '.planning/phases/10.1-*' \
  '.planning/quick/' 2>/dev/null | wc -l | tr -d ' ')
if [ "$CHANGED" -gt 0 ]; then echo "FAIL: completed phases touched"; exit 1; fi

echo "=== SC-1: grapit residue (D-10 line-level allowlist: 4 entries) ==="
# D-10 allowlist (line-level regex):
#   1. grapit_dev         (D-01: docker-compose.yml password)
#   2. /grapit/\.env      (D-03: legacy local filesystem path)
#   3. grapit-cloudrun@   (D-05: SA in deploy.yml + provision-valkey.sh)
#   4. @social\.grabit\.com (D-07 exception — already grabit, but audit ensures NOT heygrabit)
ALLOWLIST='grapit_dev|/grapit/\.env|grapit-cloudrun@|@social\.grabit\.com'

# Find all lines containing 'grapit' (case-sensitive) across tracked files, excluding allowed.
# deploy.yml 은 Plan 03 scope (AR_REPO/WEB_SERVICE/API_SERVICE 등 grapit 참조는 Plan 03에서 처리)이므로
# Plan 01 audit 범위에서는 deploy.yml 을 제외한다. Plan 03 에서 별도 audit 이 deploy.yml 을 포함한다.
# git grep excludes via pathspec (`:(exclude)...`). `:!...` shorthand.
MATCHES=$(git grep -I 'grapit' -- \
  ':(exclude).planning' \
  ':(exclude).playwright-mcp' \
  ':(exclude)pnpm-lock.yaml' \
  ':(exclude)scripts/audit-brand-rename.sh' \
  ':(exclude).github/workflows/deploy.yml' \
  2>/dev/null || true)
RESIDUE=$(printf '%s\n' "$MATCHES" | grep -vE "$ALLOWLIST" | grep -c 'grapit' || true)
if [ "${RESIDUE:-0}" -gt 0 ] 2>/dev/null; then
  echo "FAIL: unexpected grapit residue (non-allowlisted lines):"
  printf '%s\n' "$MATCHES" | grep -vE "$ALLOWLIST" | grep 'grapit' || true
  exit 1
fi

echo "=== SC-1 Allowlist Sanity (each allowlisted pattern must exist — D-10 positive check) ==="
grep -q 'grapit_dev' docker-compose.yml || { echo "FAIL: D-01 grapit_dev missing"; exit 1; }
SA_DEPLOY=$(grep -c 'grapit-cloudrun@' .github/workflows/deploy.yml 2>/dev/null || echo 0)
[ "$SA_DEPLOY" -ge 2 ] || { echo "FAIL: D-05 SA not retained in deploy.yml: $SA_DEPLOY"; exit 1; }
SA_VALKEY=$(grep -c 'grapit-cloudrun@' scripts/provision-valkey.sh 2>/dev/null || echo 0)
[ "$SA_VALKEY" -ge 2 ] || { echo "FAIL: D-05 SA not retained in provision-valkey.sh: $SA_VALKEY"; exit 1; }
grep -Fxq '@AGENTS.md' CLAUDE.md || { echo "FAIL: D-03 CLAUDE.md AGENTS pointer missing"; exit 1; }
grep -Fq '(docs/03-ARCHITECTURE.md)' AGENTS.md || { echo "FAIL: D-03 architecture reference missing"; exit 1; }
grep -Fq 'root `.env` is the local environment file.' docs/03-ARCHITECTURE.md || { echo "FAIL: D-03 root .env guidance missing"; exit 1; }
grep -q '@social\.grabit\.com' apps/api/src/modules/auth/auth.service.ts || { echo "FAIL: D-07 exception @social.grabit.com missing"; exit 1; }

echo "=== ALL CHECKS PASSED ==="

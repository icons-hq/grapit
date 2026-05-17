---
quick_id: 260517-r9q
slug: social-email-bypass-hotfix
created_at: 2026-05-17T10:38:05Z
---

# Social Email Bypass Hotfix Plan

## Goal

Production social signup users can be blocked by email verification when providers return synthetic or unreliable email addresses. Social signup should complete immediately after phone verification and consent capture.

## Tasks

1. Keep normal email/password signup email verification unchanged.
2. Mark newly completed social users as `isEmailVerified=true` at creation time.
3. Repair existing social-linked users with `isEmailVerified=false` on their next OAuth login, then issue the normal authenticated session.
4. Verify auth service/controller behavior and API build before production deploy.

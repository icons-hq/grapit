---
quick_id: 260517-r9q
slug: social-email-bypass-hotfix
created_at: 2026-05-17T10:38:05Z
---

# Signup Verification Bypass Hotfix Plan

## Goal

Production signup users can be blocked by email verification when social providers return synthetic or unreliable email addresses, and by local SMS rate limits during launch traffic. Social signup should complete immediately after phone verification and consent capture, and signup SMS endpoints should not be blocked by app-side throttles during the incident window.

## Tasks

1. Keep normal email/password signup email verification unchanged.
2. Mark newly completed social users as `isEmailVerified=true` at creation time.
3. Repair existing social-linked users with `isEmailVerified=false` on their next OAuth login, then issue the normal authenticated session.
4. Skip controller-level IP throttling for `/sms/send-code` and `/sms/verify-code`.
5. Remove SMS verification endpoints from the custom traffic-defense throttler.
6. Bypass app-side SMS resend cooldown and phone-axis counters while preserving Twilio provider validation/errors.
7. Verify auth/SMS behavior and API build before production deploy.

---
quick_id: 260511-mfo
slug: pdpa-pipl-gmm
status: complete
completed_at: 2026-05-11T16:23:06+09:00
branch: quick/260511-mfo-pdpa-pipl-gmm
---

# Quick Task 260511-mfo - Summary

## Completed

- Removed the signup UI rows for `cross_border_transfer`, `pdpa_notice`, and `pipl_notice`.
- Reduced the required consent contract to `terms`, `privacy`, and `pipa_required`; `marketing` remains optional.
- Updated API consent capture so inactive optional legacy consent keys are ignored while required inactive keys still fail safely.
- Added migration `0013_relax_launch_consent_requirements.sql` to deactivate and unrequire the three removed launch consent items.
- Updated booking consent copy to state Grabit does not provide customer personal data to GMMTV, iQIYI, overseas entertainment companies, or event organizers.
- Updated Korean/English privacy policies and the fanmeet milestone spec to reflect no overseas entertainment-company data sharing, Thailand notice handling, and mainland China signup limitations.
- Removed stale i18n copy keys tied to the removed required consent rows.

## Verification

- PASS: `pnpm --filter @grabit/shared test -- src/i18n/launch-copy-keys.test.ts src/schemas/auth.schema.test.ts src/schemas/consent.schema.test.ts src/schemas/booking.schema.test.ts`
- PASS: `pnpm --filter @grabit/shared typecheck`
- PASS: `pnpm --filter @grabit/web typecheck`
- PASS: `pnpm --filter @grabit/web test -- components/auth/__tests__/signup-consent.test.tsx components/auth/__tests__/signup-submit-consent.test.tsx hooks/__tests__/use-booking.test.tsx`
- PASS: `pnpm --filter @grabit/api test -- src/modules/consent/consent.service.spec.ts src/modules/auth/dto/auth-consent.dto.spec.ts src/database/schema/launch-foundation.schema.spec.ts`
- PASS: `pnpm --filter @grabit/api typecheck`

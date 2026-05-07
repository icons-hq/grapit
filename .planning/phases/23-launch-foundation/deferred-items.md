# Deferred Items

## 23-08 Typecheck Out-of-Scope Finding

- **Found during:** 23-08 verification (`pnpm --filter @grabit/web typecheck`)
- **Status:** Deferred - pre-existing outside 23-08 touched files
- **Issue:** `apps/web/components/auth/signup-step2.tsx:66` calls `onComplete()` without the newer required `consentItems` payload shape.
- **Evidence:** `git blame` shows the affected lines predate 23-08 (`8213dfbb`, 2026-03-27), while 23-08 did not modify signup auth consent UI.
- **Impact:** Full web typecheck remains blocked outside this plan's runtime booking-disabled UI scope.

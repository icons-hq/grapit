---
quick_id: 260511-mfo
slug: pdpa-pipl-gmm
status: complete
created_at: 2026-05-11T07:09:12.689Z
completed_at: 2026-05-11T16:23:06+09:00
---

# Quick Task 260511-mfo - 가입 동의 항목 정리

## Goal

회원가입 필수 동의 화면에서 `개인정보 국외이전`, `태국 PDPA 고지 확인`, `중국 PIPL 고지 확인` 체크박스를 제거한다. GMM/GMMTV 관련 팬미팅에서도 고객 개인정보를 해외 엔터사에 제공하지 않고 Grabit 내부에서만 보관한다는 정책을 개인정보처리방침과 동의 검증에 반영한다.

## Locked Decisions

- 해외 엔터사, GMMTV, iQIYI 등에 예매자 개인정보를 제공하지 않는다.
- Resend/Infobip 같은 서비스 필수 위탁/국외 처리 항목은 별도 가입 동의가 아니라 개인정보처리방침 고지로 처리한다.
- 태국 PDPA/PIPL 고지는 전체 회원가입 필수 체크박스에서 제거한다.
- 태국 사용자 안내 자체는 유지할 수 있도록 개인정보처리방침/국가별 notice copy로 남긴다.
- 기존 consent audit history와 구버전 클라이언트 호환성을 위해 consent enum key는 즉시 삭제하지 않는다.

## Implementation Plan

1. Signup consent UI에서 필수 행을 `terms`, `privacy`, `pipa_required`와 optional `marketing`으로 축소한다.
2. Shared consent schema의 launch required set을 세 필수 항목으로 축소하고 auth DTO 검증을 그 기준으로 맞춘다.
3. Backend consent guard가 signup/booking 모두 새 required set만 차단하도록 조정한다.
4. Consent seed 상태는 forward migration으로 `cross_border_transfer`, `pdpa_notice`, `pipl_notice`를 `is_required=false`로 내린다.
5. Privacy policy에 해외 엔터사 미제공, 태국 사용자 notice 유지, 중국 본토 가입 미지원 정책을 명시한다.
6. 관련 unit/component tests를 새 계약에 맞게 수정하고 targeted tests를 실행한다.

## Verification

- `pnpm --filter @grabit/shared test -- auth.schema.test.ts consent.schema.test.ts booking.schema.test.ts`
- `pnpm --filter @grabit/api test -- src/modules/consent/consent.service.spec.ts src/modules/auth/dto/auth-consent.dto.spec.ts src/database/schema/launch-foundation.schema.spec.ts`
- `pnpm --filter @grabit/web test -- components/auth/__tests__/signup-consent.test.tsx components/auth/__tests__/signup-submit-consent.test.tsx`

---
type: quick
quick_id: 260514-dw8
slug: 3-i18n
status: in_progress
date: 2026-05-14
---

# Quick Task 260514-dw8 - 회원가입 3단계 i18n 및 전화번호 입력 개선

## Goal

회원가입 진행 상태, 일반 회원가입 3단계, 소셜 가입 완료 3단계의 한국어 하드코딩을 launch locale copy로 교체하고, 전화번호 입력 UI에서 placeholder와 화면상 하이픈 자동 표시를 제거한다.

## Implementation

- `auth.signup` 및 확장된 `auth.otp` copy key를 `ko/en/th/zh-CN/ja` message와 shared launch-copy manifest에 추가한다.
- `StepIndicator`, `SignupForm`, social callback, `SignupStep3`, `PhoneVerification`, `PhoneInput`을 locale-aware로 조정한다.
- `SignupStep3.country` payload는 `KR`, `US`, `JP`, `CN`, `GB`, `CA`, `AU`, `OTHER` canonical value로 저장한다.
- 전화번호 입력창은 accessible label 기반으로 선택 가능하게 하고 placeholder는 제거한다.

## Verification

- `pnpm --filter @grabit/shared test`
- `pnpm --filter @grabit/web test`
- `pnpm --filter @grabit/web typecheck`
- 가능하면 Browser/Playwright로 `/auth` 및 locale-prefixed auth route smoke 확인

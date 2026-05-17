# Quick Task 260517-jmb: UI/UX i18n cleanup and zh-TW removal - Context

**Gathered:** 2026-05-17
**Status:** Ready for planning

<domain>
## Task Boundary

다국어 지원에서 중국어 간체(`zh-CN`)만 남기고 중국어 번체(`zh-TW`)는 사용자 UI와 locale 선택/라우팅 표면에서 삭제한다.

UI/UX 텍스트 다국어 지원 전반을 심층 분석하고, 회원가입 첫 단계의 중복 이메일 오류처럼 한국어로 하드코딩된 사용자 노출 문자열을 찾아 i18n으로 전환한다.

</domain>

<decisions>
## Implementation Decisions

### i18n Scope
- 전체 사용자 UI를 대상으로 한다.
- Public/auth/booking/admin 화면에서 사용자에게 보이는 React UI 텍스트와 클라이언트 오류를 전반 스캔한다.
- API 내부 예외, seed/admin 운영 데이터, 테스트 fixture 문자열은 사용자 UI에 직접 노출되는 경우에만 변경 대상으로 본다.

### Traditional Chinese Removal
- 사용자 locale 선택지, locale routing/navigation, locale message loading, locale-aware tests에서 `zh-TW`를 제거한다.
- `zh-CN`은 중국어 지원의 유일한 Chinese locale로 남긴다.
- DB migration history나 이미 배포된 schema drift backfill처럼 과거 호환성을 위해 필요한 기록은 무리하게 삭제하지 않는다.

### Agent Discretion
- 하드코딩 한국어 문자열은 `next-intl` message key 또는 기존 shared copy manifest 패턴을 우선 사용해 이동한다.
- 기존 locale 파일 구조와 테스트 스타일을 유지한다.
- 변경 범위가 커질 경우, 사용자 노출 가능성이 높은 auth/public/booking/admin UI surface를 우선한다.

</decisions>

<specifics>
## Specific Ideas

- 사용자가 직접 발견한 사례: 회원가입 첫 번째 단계에서 이메일 중복 빨간 오류 텍스트가 다국어 지원되지 않았다.
- 이 사례와 같은 client-side validation/error/help/status 문구를 집중적으로 찾는다.

</specifics>

<canonical_refs>
## Canonical References

- `AGENTS.md`: Grapit repository GSD and Korean response conventions.
- `.planning/STATE.md`: current project state.
- Existing `apps/web/messages/*` files and i18n routing/config files.

</canonical_refs>

# Quick Task 260516-o8e: Mobile search UX redesign and mobile home banner admin upload support - Context

**Gathered:** 2026-05-16
**Status:** Ready for planning

<domain>
## Task Boundary

Improve two production mobile UX gaps:

1. `https://heygrabit.com/search` on mobile currently shows only a prompt icon/title/body and no search input. Users cannot tell how to perform a search from the search tab itself.
2. Home mobile banner display is cropped because the mobile banner asset size is 1290 x 600px, while the current carousel uses a fixed 188px mobile slot with `object-cover`. Admin must support mobile-specific banner registration so operators can upload a mobile banner separately from the desktop banner.

</domain>

<decisions>
## Implementation Decisions

### Mobile Search UX
- Use the user's selected `1-2` option: minimal input style.
- Keep the current Grabit product tone, but add a real search input and submit affordance directly on the `/search` page.
- The empty-query state should no longer be a dead-end icon prompt. It must let mobile users type a performance or artist query and navigate to `/search?q=...`.

### Banner Model
- User replied `5-1`; this was interpreted as the intended second-question answer `2-1` because only two discussion questions existed.
- Use device-specific banners with the existing `deviceTarget` model: admin can register `desktop` and `mobile` banners separately.
- Public home carousel must select banners appropriate to the current viewport/device target so mobile sees `mobile` or `all` banners and desktop sees `desktop` or `all` banners.
- Preserve existing schema unless code inspection proves a small extension is necessary.

### Agent Discretion
- Keep implementation narrow enough for a quick task.
- Prefer existing hooks/components/i18n copy rather than introducing new libraries or broad visual redesign.
- Verify production-like mobile dimensions with browser screenshots where possible.

</decisions>

<specifics>
## Specific Ideas

- Production mobile screenshot evidence captured at `/tmp/grapit-search-mobile.png` showed a search prompt with no input.
- Production mobile home screenshot captured at `/tmp/grapit-home-mobile.png` showed current home skeleton/banner slot behavior.
- Existing code already includes `BannerDeviceTarget` values: `all`, `desktop`, `mobile`.
- Existing public carousel currently renders whatever `/api/v1/home/banners` returns and uses `Image` with `object-cover`.

</specifics>

<canonical_refs>
## Canonical References

- apps/web/app/search/page.tsx
- apps/web/components/home/banner-carousel.tsx
- apps/web/components/admin/banner-manager.tsx
- apps/web/app/admin/banners/page.tsx
- apps/api/src/modules/performance/performance.service.ts
- packages/shared/src/types/performance.types.ts
- packages/shared/src/schemas/performance.schema.ts

</canonical_refs>

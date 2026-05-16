# Quick Task 260516-mle: Mobile UI/UX refresh and mobile language selector - Context

**Gathered:** 2026-05-16
**Status:** Ready for planning

<domain>
## Task Boundary

Improve Grapit's mobile UI/UX starting from the main home page, with a research-informed senior UI/UX design lens. The change must also make mobile language selection discoverable.

Primary target: mobile core public surfaces, especially home, header/navigation, locale selector, and major home cards/sections. Desktop should remain coherent and existing product tone should not be broken.

</domain>

<decisions>
## Implementation Decisions

### Design Tone
- Use **Refined commerce**: polished, dense enough for ticket discovery, and conversion-oriented without turning the product into a marketing landing page.

### Scope
- Use **Mobile core surfaces**: improve home, header/navigation, locale selector, and major home cards/sections in this quick task.

### Mobile Language Entry
- Use **Header globe**: expose a mobile header globe icon at all times and open a mobile bottom sheet for language choice.

### Agent Discretion
- Use the existing codebase's component and i18n patterns.
- Prefer low-risk, responsive CSS/component changes over broad routing or API changes.
- Keep Korean prefixless and foreign locale-prefixed routing behavior intact.

</decisions>

<specifics>
## Specific Ideas

- Research-backed direction: mobile users scan home pages quickly, so the first viewport should answer what Grapit is, what can be booked, and how to continue.
- Language choice should be a short supplementary task, so a bottom sheet is appropriate on mobile.
- Avoid over-decorated hero treatment; make the ticketing product itself visible through search, categories, featured banners, and performance cards.

</specifics>

<canonical_refs>
## Canonical References

- Baymard 2025 mobile ecommerce/homepage navigation findings.
- Wise Design bottom sheet guidance for short mobile tasks.
- Existing Grapit locale routing and launch locale decisions in code.

</canonical_refs>

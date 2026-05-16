# Quick Task 260515-wbw: Admin-managed performance detail images and public detail UX refresh - Context

**Gathered:** 2026-05-15
**Status:** Ready for planning

<domain>
## Task Boundary

Add an admin-managed detail-image feature for performances and redesign the public performance detail page so supplied long-form event images fit the current Grapit ticketing UX.

The three supplied images are:

- `/Users/sangwopark19/Downloads/KakaoTalk_Photo_2026-05-15-23-12-48 001.jpeg`
- `/Users/sangwopark19/Downloads/KakaoTalk_Photo_2026-05-15-23-12-48 002.jpeg`
- `/Users/sangwopark19/Downloads/KakaoTalk_Photo_2026-05-15-23-12-48 003.jpeg`

</domain>

<decisions>
## Implementation Decisions

### Public Detail Image Placement

- Use a large editorial body stack, not an auto-rotating carousel.
- Detail images should appear in the main reading flow so seat guide, benefit table, and location guide are discoverable on mobile and desktop.
- Keep booking CTA and core event information easy to reach while the page becomes longer.

### Admin Management UX

- Build multi-image upload with ordering and deletion.
- The admin user should be able to upload multiple images, preview them, remove any image, and reorder images before saving.
- Do not hard-code exactly three slots.

### Supplied Images / Production Handling

- Connect the three supplied images to the real production performance after implementation and deployment.
- This implies the code path must support persisted image URLs, not only static local mock assets.

</decisions>

<specifics>
## Specific Ideas

- Current public detail page uses poster + horizontal detail/sales tabs. Research and current product-page UX patterns suggest long, high-value visual information should not be hidden behind weakly discoverable tabs on mobile.
- Use accessible, ordered images with meaningful alt text. Avoid autoplay motion.
- Use the existing admin upload infrastructure and file constraints where possible.

</specifics>

<canonical_refs>
## Canonical References

- Baymard mobile product-page imagery findings: users expect rich visual context and mobile pages often underperform when product imagery is hard to discover.
- Baymard horizontal-tabs warning: horizontal tabs can hide core product content, while vertically discoverable sections work better for mobile product detail content.
- W3C carousel accessibility guidance: carousels require keyboard operation, status communication, and pause controls when rotating; this task does not need that complexity.

</canonical_refs>

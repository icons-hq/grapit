---
status: diagnosed
trigger: "Read-only root-cause investigation for Grapit production admin SVG seat map upload failure. CWD: /Users/sangwopark19/icons/grapit. User symptom: in production admin, trying to change an SVG seat map with /Users/sangwopark19/Downloads/대극장_2층_좌석배치도.svg shows toast text in Korean: \"보안상 허용되지 않는 SVG 요소 또는 속성이 포함되어 있습니다.\" Goal: diagnose only, no file edits. Inspect admin upload path, frontend/backend SVG safety helper, tests, and the provided SVG file. Identify the exact element/attribute/rule likely causing rejection, whether this is a real security block or an over-strict validator, and what evidence should be checked in production if needed. Return concise Korean summary with file:line evidence and commands/tests you ran. Do not reveal any secrets."
created: 2026-05-26T16:17:40+09:00
updated: 2026-05-26T16:31:00+09:00
---

## Current Focus
<!-- OVERWRITE on each update - reflects NOW -->

hypothesis: "CONFIRMED: the production admin toast is caused by client-side SvgPreview unsafe SVG validation. In this file the first blocked rule is <style>; <script> and 1210 onclick attributes would also be blocked."
test: "Completed: inspected line snippets, xmllint counts, jsdom DOMParser mimic of hasUnsafeSvgPayload(), and existing web tests."
expecting: "Diagnosis complete. No code/source fix applied per read-only diagnose-only request."
next_action: "Return concise root-cause report with file:line evidence, commands run, and production evidence to check if needed."

## Symptoms
<!-- Written during gathering, then IMMUTABLE -->

expected: "Production admin should allow changing an SVG seat map when the uploaded file is a valid seat-map SVG."
actual: "Production admin shows toast text: 보안상 허용되지 않는 SVG 요소 또는 속성이 포함되어 있습니다."
errors: "보안상 허용되지 않는 SVG 요소 또는 속성이 포함되어 있습니다."
reproduction: "In production admin, try changing the SVG seat map using /Users/sangwopark19/Downloads/대극장_2층_좌석배치도.svg."
started: "Not specified."

## Eliminated
<!-- APPEND only - prevents re-investigating -->

## Evidence
<!-- APPEND only - facts discovered -->

- timestamp: 2026-05-26T16:17:40+09:00
  checked: "Memory and common patterns before code search."
  found: "Prior Grapit SVG upload work recorded that admin SVG validation rejects <style> blocks, expects data-stage in top|right|bottom|left, and counts seats by data-seat-id."
  implication: "Known-pattern candidate: current source SVG may still contain document-wide CSS or non-contract seat attributes."
- timestamp: 2026-05-26T16:20:00+09:00
  checked: "Repo file discovery and provided Downloads directory."
  found: "Relevant code files include apps/web/lib/svg/safety.ts, apps/web/components/admin/svg-preview.tsx, apps/web/lib/admin-upload.ts, apps/api/src/modules/admin/upload.service.ts, and admin/svg-preview tests. Provided SVG exists at /Users/sangwopark19/Downloads/대극장_2층_좌석배치도.svg."
  implication: "Investigation can test the actual file against the frontend safety helper and compare with backend behavior."
- timestamp: 2026-05-26T16:23:00+09:00
  checked: "Frontend and backend upload path source."
  found: "apps/web/components/admin/svg-preview.tsx reads file.text(), parses DOMParser, calls hasUnsafeSvgPayload(), and emits the exact Korean toast before requesting a presigned URL. apps/api upload code only validates folder/contentType/extension for seat-maps and returns a presigned/local upload URL."
  implication: "The observed toast is client-side safety validation; a production backend/R2 upload request should not occur when this toast appears."
- timestamp: 2026-05-26T16:27:00+09:00
  checked: "Actual SVG content counters for /Users/sangwopark19/Downloads/대극장_2층_좌석배치도.svg."
  found: "File has 1 <style> tag, 1 <script> tag, 1210 onclick attributes, 0 data-stage attributes, 0 literal STAGE text, and 0 data-seat-id/data-id attributes."
  implication: "Current toast is a genuine safety block, not only an over-strict validator. After stripping active content, the file still needs stage and seat-id contract normalization before upload can work."
- timestamp: 2026-05-26T16:31:00+09:00
  checked: "jsdom DOMParser mimic of apps/web/lib/svg/safety.ts and existing test suite."
  found: "Parser produced no parsererror. First blocked payload was tag:style; blocked counts were tag:style=1, attr:onclick=1210, tag:script=1. pnpm --filter @grabit/web test -- components/admin/__tests__/svg-preview.test.tsx passed, including the existing <style> rejection case."
  implication: "The exact visible toast is expected behavior from current tests and code. Production evidence should show no presigned upload/R2 PUT attempt when this toast appears."

## Resolution
<!-- OVERWRITE as understanding evolves -->

root_cause: "The uploaded SVG contains unsafe active/document-wide SVG content. The frontend admin upload path parses the file and calls hasUnsafeSvgPayload(); that helper blocks <style>, <script>, inline event attributes such as onclick, href/src-style external references, javascript: URLs, and unsafe style URL/expression values. The provided SVG's first blocked node is <style> at line 2, and it also contains 1210 onclick attributes plus a <script> block."
fix: "Diagnose-only; no fix applied. The asset would need conversion/sanitization into the app contract: remove <style>/<script>/onclick and other active content, flatten safe visual styling into inline safe attributes, add data-stage=\"top|right|bottom|left\" or STAGE marker, and add data-seat-id for sellable seats."
verification: "Read-only verification completed with source inspection, xmllint counts, a jsdom DOMParser mimic of the helper, and web tests. No production mutation performed."
files_changed: []

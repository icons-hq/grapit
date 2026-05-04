---
phase: 08-r2
plan: 03
status: completed
started: "2026-04-13T03:13:00Z"
completed: "2026-04-13T03:34:00Z"
duration: "21min"
tasks_completed: 2
tasks_total: 2
files_modified: []
requirements-completed: [R2-01, R2-02, R2-03, R2-04]
---

# Plan 03 Summary: R2 인프라 설정 + 검증

## Objective
Cloudflare R2 버킷 생성, API 토큰 발급, CORS 설정, 공개 접근 활성화, GCP Secret Manager 시크릿 등록, GitHub Actions secret 추가, 프로덕션 배포 및 검증

## What Was Done

### Task 1: Cloudflare R2 인프라 설정
- **버킷 생성**: `grapit-assets` (wrangler CLI)
- **공개 접근 활성화**: `https://pub-9eb4eb2187b94ca8a746f62301c0a87f.r2.dev` (wrangler CLI)
- **CORS 설정**: AllowedOrigins: 프로덕션 웹 + localhost, AllowedHeaders: content-type, Methods: GET/PUT/HEAD (wrangler CLI)
- **API 토큰 발급**: Object Read & Write, grapit-assets 스코프 (Dashboard)
- **GCP Secret Manager**: 시크릿 5개 생성 + Cloud Run SA 접근 권한 부여 (gcloud CLI)
  - r2-account-id, r2-bucket-name, r2-public-url, r2-access-key-id, r2-secret-access-key
- **GitHub Secret**: R2_PUBLIC_HOSTNAME (gh CLI)
- **로컬 .env**: R2 환경변수 6개 추가

### Task 2: 검증
- **S3 API 연결**: PutObjectCommand로 오브젝트 업로드 성공 (ETag 반환)
- **공개 URL 접근**: r2.dev URL로 HTTP 200, 정확한 내용 반환
- **유닛 테스트**: upload.service 14개 포함 전체 160개 통과
- **CI/CD**: lint/typecheck/test 통과 → deploy-api (2m38s) + deploy-web (1m46s) 성공
- **프로덕션 R2 모드**: Cloud Run 로그에 `R2_ACCOUNT_ID not configured` 경고 없음 — R2 모드 활성

## Verification Results

| Check | Result |
|-------|--------|
| R2 bucket `grapit-assets` exists | PASS |
| Public access at r2.dev URL | PASS |
| CORS AllowedHeaders includes content-type | PASS |
| S3 API credentials work (PUT + GET) | PASS |
| GCP Secret Manager 5 secrets | PASS |
| Cloud Run SA has secretAccessor role | PASS |
| GitHub Secret R2_PUBLIC_HOSTNAME | PASS |
| Production R2 mode active (no fallback warning) | PASS |
| Production health check OK | PASS |
| CI pipeline passes | PASS |

## Key Values
- R2 Public URL: `https://pub-9eb4eb2187b94ca8a746f62301c0a87f.r2.dev`
- R2 Bucket: `grapit-assets`
- R2 Account ID: `6c94bc5d14389171fcb54b8b9fc1f0eb`

## Blockers Resolved
- R2-02: CORS AllowedHeaders 와일드카드 불가 → `content-type` 명시적 지정으로 해결

## Notes
- wrangler 4.81.1로 대부분 자동화 (버킷 생성, dev-url, CORS)
- API 토큰만 Dashboard 수동 생성 (wrangler에 해당 명령 없음)
- wrangler로 업로드한 오브젝트는 S3 API ListObjects에서 안 보임 (다른 네임스페이스) — S3 API로 업로드한 오브젝트는 정상 조회/접근

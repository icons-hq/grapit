# Requirements: Grapit

**Defined:** 2026-04-09
**Core Value:** 사용자가 원하는 공연을 발견하고, 좌석을 직접 선택하여, 안정적으로 예매를 완료할 수 있는 것

## v1.1 Requirements

Requirements for v1.1 안정화 + 고도화. Each maps to roadmap phases.

**Scope note (2026-05-04):** v1.1 is closed after Phase 21. Former Phase 22-24 work is deferred into v2.0 Fanmeet Launch and remains listed in traceability as `v2.0 Phase 22-24` where relevant.

### 소셜 로그인 버그

- [x] **AUTH-01**: 소셜 로그인 재로그인 실패 버그 수정 (회원가입 후 로그아웃 → 재로그인 불가, 카카오/네이버/구글 전부)

### Valkey 마이그레이션

- [ ] **VALK-01**: @upstash/redis 제거, ioredis 단일 클라이언트로 Valkey 연결 통합
- [ ] **VALK-02**: Google Memorystore for Valkey 프로비저닝 (PSC + Direct VPC Egress)
- [x] **VALK-03**: 좌석 잠금 Lua 스크립트 Valkey 호환성 검증 및 수정
- [ ] **VALK-04**: Socket.IO Redis adapter가 ioredis로 Valkey pub/sub 정상 동작 확인
- [ ] **VALK-05**: Cloud Run → Valkey VPC 네트워킹 설정
- [ ] **VALK-06**: 성능 카탈로그 캐시 레이어 구현

### R2 프로덕션 연동

- [x] **R2-01**: Cloudflare R2 API 토큰 발급 + 버킷 생성
- [x] **R2-02**: R2 CORS 설정 (AllowedHeaders 명시적 지정)
- [x] **R2-03**: 포스터/SVG 프로덕션 업로드 및 CDN 서빙 동작
- [ ] **R2-04**: 커스텀 도메인 설정 (CDN 서빙)

### 기술부채 청산

- [x] **DEBT-01**: Password reset 이메일 기능 실구현 (console.log stub → 실제 이메일 발송)
- [ ] **DEBT-02**: 이용약관 dialog에 실제 약관 텍스트 적용
- [ ] **DEBT-03**: seat-map-viewer.test.tsx locked seat click 테스트 회귀 수정
- [ ] **DEBT-04**: admin-booking-detail-modal formatDateTime null 타입 경고 수정
- [ ] **DEBT-05**: Toss Payments E2E 테스트 검증
- [ ] **DEBT-06**: useShowtimes hook 미존재 라우트 정리

### SMS 인증

- [ ] **SMS-01**: SMS 발송 rate limiting 구현 (phone/IP 기준)
- [ ] **SMS-02**: SMS 프로바이더 실 연동 (OTP 발송/검증)
- [ ] **SMS-03**: 프로덕션/개발 환경 자동 전환 유지
- [ ] **SMS-04**: OTP 재시도 제한 및 만료 처리

### 어드민 대시보드

- [x] **ADM-01**: 오늘 요약 카드 (예매 수, 매출, 취소, 활성 공연)
- [x] **ADM-02**: 매출 추이 차트 (일별/주별 area chart)
- [x] **ADM-03**: 장르별 예매 분포 차트 (donut chart)
- [x] **ADM-04**: 인기 공연 랭킹 Top 10
- [x] **ADM-05**: 결제수단 분포 차트 (bar chart)
- [x] **ADM-06**: 통계 데이터 캐싱 + 집계 쿼리 최적화

### UX 현대화

- [x] **UX-01**: 전체 디자인 현대화 (테두리/스타일 → 모던 트렌드, 심층 리서치 기반)
- [x] **UX-02**: SVG 좌석맵 스테이지 방향 표시
- [x] **UX-03**: SVG 좌석맵 등급별 색상 범례 + 가격 표시
- [x] **UX-04**: 좌석 선택 상태 전환 애니메이션
- [x] **UX-05**: 미니맵 네비게이터 (줌 시 전체 뷰 위치)
- [x] **UX-06**: 모바일 터치 타겟 44px 최소 보장

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### UX 추가

- **UX-07**: 모바일 좌석 선택 시 햅틱 피드백 (진동)

### 어드민 추가

- **ADM-07**: Excel/CSV 내보내기
- **ADM-08**: 고급 퍼널 분석 (전환율, 코호트)
- **ADM-09**: 실시간 WebSocket 대시보드

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| PASS 본인인증 | 통신사 연동 복잡도 높음, SMS OTP로 충분 |
| 인라인 SVG 좌석맵 편집기 | 4-8주 소요, 외부 도구 업로드로 충분 |
| Admin RBAC | 1인 관리자, 팀 확장 시 추가 |
| Admin 다크모드 | 내부 도구, 우선순위 낮음 |
| Valkey Cluster | 단일 노드로 현재 규모 충분 |
| SMS fallback 프로바이더 | Twilio/SOLAPI 단일 프로바이더로 충분 |
| R2 이미지 리사이징/WebP 변환 | Next.js Image 컴포넌트로 클라이언트 최적화 |
| SMS 로그인 시 매번 인증 | 전환율 저하, 가입 시 1회만 |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| AUTH-01 | Phase 6, Phase 21 | Complete |
| VALK-01 | Phase 7 | Pending |
| VALK-02 | Phase 7, Phase 20 | Pending |
| VALK-03 | Phase 7, Phase 19, Phase 20, v2.0 Phase 24 | Complete |
| VALK-04 | Phase 7, Phase 20 | Pending |
| VALK-05 | Phase 7, Phase 20, v2.0 Phase 24 | Pending |
| VALK-06 | Phase 7 | Pending |
| R2-01 | Phase 8, Phase 21, v2.0 Phase 23 | Complete |
| R2-02 | Phase 8, Phase 21, v2.0 Phase 23, v2.0 Phase 24 | Complete |
| R2-03 | Phase 8, Phase 21, v2.0 Phase 23 | Complete |
| R2-04 | Phase 8, Phase 21, v2.0 Phase 23 | Pending |
| DEBT-01 | Phase 9, Phase 18, v2.0 Phase 23 | Complete |
| DEBT-02 | Phase 9, v2.0 Phase 23 | Pending |
| DEBT-03 | Phase 9, v2.0 Phase 23 | Pending |
| DEBT-04 | Phase 9, v2.0 Phase 23 | Pending |
| DEBT-05 | Phase 9, v2.0 Phase 23 | Pending |
| DEBT-06 | Phase 9, v2.0 Phase 23 | Pending |
| SMS-01 | Phase 10 | Pending |
| SMS-02 | Phase 10, v2.0 Phase 22, v2.0 Phase 24 | Pending |
| SMS-03 | Phase 10 | Pending |
| SMS-04 | Phase 10 | Pending |
| ADM-01 | Phase 11 | Complete |
| ADM-02 | Phase 11 | Complete |
| ADM-03 | Phase 11 | Complete |
| ADM-04 | Phase 11 | Complete |
| ADM-05 | Phase 11 | Complete |
| ADM-06 | Phase 11 | Complete |
| UX-01 | Phase 12 | Complete |
| UX-02 | Phase 12, Phase 19 | Complete |
| UX-03 | Phase 12, Phase 19 | Complete |
| UX-04 | Phase 12, Phase 19 | Complete |
| UX-05 | Phase 12, Phase 19 | Complete |
| UX-06 | Phase 12, Phase 19 | Complete |

**Coverage:**
- v1.1 requirements: 33 total
- Mapped to phases: 33/33
- Gap closure remapped from v1.1 audit: 21/33
- Open after audit gap planning: 26/33
- Unmapped: 0

---
*Requirements defined: 2026-04-09*
*Last updated: 2026-05-04 after v1.1 scope closure and Phase 22-24 v2.0 deferral*

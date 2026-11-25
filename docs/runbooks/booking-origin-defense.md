# 예매 원본 접근과 매크로 대응

## 운영 경로

공개 웹과 API는 Cloudflare의 기존 세 Worker Route를 통과한다. 운영 Worker는 Google HTTPS 부하 분산기의 웹·API 호스트에 라우팅 자격을 첨부한다. Google URL map은 이를 검사해 백엔드를 선택한다. 미인증 요청과 미등록 호스트는 공개 홈으로 돌려보낸다. 원본 연결은 TLS를 검증하며 redirect를 자동 추적하지 않는다. 자격값은 Secret Manager와 운영 Worker secret으로 관리한다. URL map 열람 권한도 이 자격을 볼 수 있는 범위로 관리한다.

Cloud Run 웹과 API의 ingress는 `internal-and-cloud-load-balancing`이다. Google 내부 Scheduler 호출은 같은 프로젝트의 기존 기본 URL과 OIDC audience를 사용한다. Toss와 소셜 로그인은 공개 API 주소를 사용한다. 선택적 방문 분석은 `https://analytics.origin.heygrabit.com`에서 기존 두 분석 경로만 Google로 직접 보낸다. 분석 데이터·관리자 응답은 Cloudflare를 통하지 않는다.

## 전환과 복구

- Google 부하 분산기에 기존 인증서를 유지하면서 DNS 전용 원본 호스트의 Google 관리 인증서를 연결한다. `scripts/managed-demo/configure-origin-routes.mjs`는 현재 URL map 지문을 이용해 Google에서 유효성을 검증한다. 운영 작업에 `--apply`를 명시하면 검증한 map을 적용한다. 비밀이 들어 있는 URL map 원문은 로그 또는 이슈에 올리지 않는다.
- 인증서 활성, 보호된 웹·API, 분석 config, 분석 호스트의 예매 경로 거부를 확인한다. Worker를 전환한 뒤 공개 예매·로그인과 실시간 연결을 점검한다. 마지막으로 두 Cloud Run ingress를 제한하고 기본 URL의 외부 거부, Scheduler 최근 성공, 공개 콜백 경유를 확인한다. `GRABIT_ORIGIN_RESTRICTED`는 다음 배포의 ingress를 유지한다.
- 장애 시 먼저 마지막 정상 서명 Worker와 URL map을 복원한다. 기본 Cloud Run URL을 쓰던 Worker로 되돌려야 할 때는 운영 권한자가 Cloud Run ingress를 먼저 복구하고 공식 서비스 정상화 및 경보를 확인한다. Worker를 먼저 되돌리면 원본 접근 거부로 공개 서비스가 중단된다.
- 예매 행동 판정은 새 좌석 잠금에만 적용한다. 원래 대기 순번과 입장·좌석·결제 만료 시각은 기존 계약을 따른다. 같은 좌석의 재시도는 한 번으로 집계한다. 브라우저를 식별하는 서명된 쿠키는 15분, 회차별 행동 집합은 30초 동안만 유지한다. IP와 국가는 판정에 사용하지 않는다.
- 추가 확인은 기존 입장·브라우저·구매자·회차에 결합한다. 팬이 확인을 끝내면 같은 예매 화면에서 원하는 좌석을 다시 선택한다. 확인 중 좌석을 자동 점유하지 않는다. 기존 결제 준비·승인·복구, QR 입장과 환불에는 이 검사를 적용하지 않는다. `GRABIT_BOOKING_MACRO`가 배포 시 Turnstile 서버 secret을 연결한다. 오작동 시 API 및 배포 변수를 false로 돌리면 바인딩이 남아 있어도 추가 확인만 중지된다. 기존 속도 제한은 계속 적용된다.

## 디도스 알림

Cloudflare 기본 HTTP 디도스 알림은 계정 전체를 감시한다. 헤이그랩잇 전용 알림은 기존 5분 백그라운드 작업이 이 zone의 최근 15분 HTTP 디도스 완화 이벤트 표본을 읽어 Cloud Monitoring에 전달한다. API 토큰 권한은 대상 zone의 Analytics Read로 제한한다. 웹 요청과 결제 작업은 이 조회 결과를 기다리지 않는다.

두 경보 모두 기존 운영 장애 메일 채널을 사용한다. 전용 정책은 `grabit.zone_ddos_mitigated` 로그에 반응하며 30분 동안 중복 통지를 제한한다. `grabit.zone_ddos_checked`는 조회 성공, `grabit.zone_ddos_monitor_error`는 조회 실패다. 실제 장애를 판단할 때는 대기열 지연, 승인 오류, Cloudflare 이벤트를 함께 확인한다. 표본 기반 전용 알림과 계정 기본 알림은 같은 사건을 함께 알릴 수 있다.

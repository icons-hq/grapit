# 2026-11-12 기존 Cloudflare 접속 기록 확보

사용자가 요청한 2026-11-11 00:00 KST(`2026-11-10T15:00:00Z`)부터의 기존 접속 집계를 **운영 변경 없이 읽기 전용으로 확보했다.** 데이터는 `/tmp/grabit-access-history.json`에 저장했다.

## 확인 결과

| KST 날짜 | Zone 전체 HTTP 요청 | Zone HTML pageViews | 공개 호스트 2xx HTML 요청 추정 | 구간 |
| --- | ---: | ---: | ---: | --- |
| 2026-11-11 | 107,396 | 7,219 | 7,257 | 00:00–24:00 완료 시간 구간 |
| 2026-11-12 | 16,184 | 1,501 | 1,496 | 00:00–약 12:26, 당일·현재 시간 부분 집계 |

데이터 수신 시각은 **2026-11-12 12:26:38 KST**다. 공개 호스트 필터의 정확한 이벤트 상한은 `2026-11-12T03:26:18Z` 미만이다. Zone 전체 시계열은 12:00 KST 이전 완료 시간 36개와 조회 당시 진행 중인 12시 시간 1개를 분리했다. 최근 값은 공급자 집계 지연 때문에 바뀔 수 있다.

11월 11일 가장 큰 구간은 15시 KST로, Zone 요청 **39,088건**, Zone HTML pageViews **2,437건**이다.

## 지표를 표시할 때 지켜야 할 정의

- `httpRequests1hGroups.sum.requests`는 zone 전체의 요청 수다. API·정적 파일·봇·모니터링·위협 요청을 포함하므로 방문자 수가 아니다. 기존 hourly 노드에는 hostname 필터가 없다.
- `httpRequests1hGroups.sum.pageViews`의 공식 스키마 설명은 성공한 HTML 요청이다. 해당 전체 시간의 `avg.sampleInterval`은 모두 **1**이었다. 따라서 “Cloudflare HTML 페이지 요청”으로 표시할 수 있으나 “실제 방문자”나 “봇을 제외한 방문”이라고 표시하지 않는다.
- 공개 호스트 집계는 `httpRequestsAdaptiveGroups`에서 `clientRequestHTTPHost_in=[heygrabit.com,www.heygrabit.com]`, `requestSource=eyeball`, `edgeResponseContentTypeName=html`, `200 <= edgeResponseStatus < 300`으로 필터했다. 이 필터의 봇·모니터링 요청은 제외되지 않는다. 이번 반환 시간들의 sampleInterval은 **1~1.12**이므로 **추정 건수**다. Cloudflare가 이미 표본에서 확대 추정한 `count`에 sampleInterval을 다시 곱하면 안 된다.
- `sum.visits`는 같은 HTML 필터에서 Referer가 요청 hostname과 다른 요청(외부·직접 유입)이다. 세션이나 사람을 중복 제거한 수가 아니다.
- `uniq.uniques`는 시간 안의 고유 IP 개수다. 원본 IP는 조회하지 않았으며 반환된 시간별 수치를 일 단위 고유 방문자로 더하면 안 된다.
- 두 HTML 지표는 데이터셋·호스트 범위·샘플링이 다르다. **7,219와 7,257을 더하거나 서로 정확히 일치해야 하는 값으로 취급하지 않는다.**

공식 근거: [Zone Analytics 지표 정의](https://developers.cloudflare.com/analytics/account-and-zone-analytics/zone-analytics/), [hostname 필터 예제](https://developers.cloudflare.com/analytics/graphql-api/tutorials/end-customer-analytics/), [GraphQL sampling 설명](https://developers.cloudflare.com/analytics/graphql-api/sampling/). `sum.pageViews`, `avg.sampleInterval`, `sum.visits` 설명은 현재 인증으로 조회한 공식 GraphQL introspection에서도 확인했다.

## 봇 분류와 현재 플랜의 한계

Zone 조회 결과는 `Free Website`다. 이는 **Workers 계정 구독 요금제와 다른 값**이므로 기존 개인정보 조사에서 미확정인 Workers Logs의 3일/7일 보관을 이 정보로 확정하면 안 된다.

현재 GraphQL Settings의 `httpRequestsAdaptiveGroups.availableFields`에는 `dimensions_botManagementDecision`, `dimensions_botScore`가 없다. 따라서 공개 페이지 요청을 신뢰할 수 있는 사람/봇 판정별로 나눌 수 없다. legacy `ipClassMap`의 집계는 가능하며, 11월 11일 전체 요청 중 `searchEngine=289`, `monitoringService=1,447`, `unknown=1,183`, `allowlist=5`, `noRecord=104,472`였다. `noRecord`·`unknown`은 사람이라는 뜻이 아니다. 이 분류는 전체 요청의 분류이므로 모니터링 요청 수를 HTML pageViews에서 바로 빼서 사람의 페이지뷰를 계산할 수도 없다.

## 조회 가능 범위와 재사용 경로

현재 인증으로 `POST https://api.cloudflare.com/client/v4/graphql`의 **query만** 실행했다. zone은 `heygrabit.com`이며, 파일에는 개인별 이벤트·원본 IP·URL 경로·쿼리·cookie·authorization·회원 식별자를 저장하지 않았다. API 토큰 값도 출력·파일 저장하지 않았다.

공식 Settings API 응답 기준:

| 노드 | 사용 가능 | 과거 조회 범위 | 1회 기간 | 최대 행 |
| --- | --- | ---: | ---: | ---: |
| `httpRequests1hGroups` | true | 262,800초(약 73시간) | 259,200초(72시간) | 10,000 |
| `httpRequestsAdaptiveGroups` | true | 2,678,400초(31일) | 2,592,000초(30일) | 10,000 |

이 값은 [Settings node](https://developers.cloudflare.com/analytics/graphql-api/features/discovery/settings/)로 확인했다. 같은 토큰이라도 권한·플랜 변경 시 다시 확인해야 한다. 과거 hourly 값을 장기 보관하려면 조회 가능 기간 안에 **이 집계 행만** 별도 저장해야 한다. 이번 파일은 독립적인 스냅샷이며 자동 수집 작업을 새로 만들지 않았다.

파일의 `graphqlQuery`에 실제 조회문을 담았고, `dailyKst`, `zoneHourly`, `publicHtmlHourly`로 집계를 구분했다. 기존 자료에서 어제의 전체 요청과 페이지 요청 추이는 볼 수 있지만 과거의 브라우저 행동·회원별 세션·전환·유입 기여도를 새로 복원했다고 표현하지 않는다. Cloudflare 조회가 성공하여 GCP 로그 원문을 읽거나 로그 집계 대체 경로를 실행할 필요가 없었다.

JSON 파싱, 시간별 합계와 일별 합계 일치, 완료 시간 36개와 부분 시간 1개의 구분을 확인했다. 운영 DB·서비스·재고·방문 수집 설정은 변경하지 않았다.

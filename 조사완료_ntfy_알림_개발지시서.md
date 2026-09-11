# watermap-app-personal — 조사팀 포인트 완료 시 ntfy 알림 개발지시서

**검토 이력**:
- 1라운드(내부 에이전트): Critical 1건(`git diff --quiet`가 신규 파일의
  첫 커밋을 감지 못해 알림이 영원히 안 나가는 결함) + High 2건(동시 실행
  경합, 특정 팀의 지속적 실패가 다른 팀 알림까지 조용히 멈추는 위험) +
  Medium 2건 + Low 4건 → 전부 반영.
- 2라운드: 1라운드에서 새로 추가한 실패 처리 로직 자체가 **Critical 회귀를
  재발시킴**을 발견 — 최초 실행 중 팀 하나만 실패하면 빈 배열이 "진짜
  기준선"으로 저장돼, 바로 다음 성공 실행에서 그동안 쌓여있던 모든 완료
  건이 알림 폭탄으로 쏟아지는 문제(서브에이전트가 실제 재현). 추가로
  `getTeams` 실패가 실패 경고 메커니즘을 완전히 비켜가는 사각지대(High)도
  발견. `baselineEstablished` 플래그를 도입해 "상태 파일 존재 여부"와
  "진짜 기준선 수립 여부"를 분리하는 방식으로 근본 수정, `getTeams`도
  동일한 실패 처리 경로로 통일.
- 3라운드: 2라운드에서 고친 두 가지(알림 폭탄 회귀, `getTeams` 실패
  사각지대)가 실제 재현으로 정확히 고쳐졌음을 재확인. 그 외 새로
  Medium 1건(상태 파일 손상 경고에 스팸 방지 장치 없음 — 사람이 고칠
  때까지 매 cron 주기마다 반복 발송됨) + Low 1건(`sendNtfy` 자체 실패는
  연속 실패 카운터에 안 잡힘 — ntfy.sh 장애가 길어지면 경고 채널 자체가
  막힘)을 발견. 둘 다 저심각도로 구현을 막을 이유는 아니라는 평가를
  받았고, 서브에이전트 권고대로 6절 "알려진 한계"에 문서화하는 선에서
  반영(코드 변경 없음).
- 4라운드: [Critical] API 응답의 `teams`/`plots` 필드 존재 여부를 엄격히
  검증하도록 수정(없으면 에러를 던져 상태 오염 방지). [High] 알림 목록을
  "교체"가 아닌 "누적 합집합" 방식으로 변경 — 서버 데이터가 일시적으로
  누락되어도 알림 폭탄이 터지지 않게 보호. [Medium] 실패 경고 발송 여부를
  실제 `sendNtfy` 성공 시에만 갱신하도록 개선. [Medium] 워크플로우에서
  파일 존재 여부 확인 로직 추가. [Low] `Promise.allSettled` 사용 시
  Apps Script의 동시성 제한 가능성 인지.
- 5라운드: [Zero Defect] `plotNo` 누락/공백에 대한 방어 로직 강화(문자열
  trim 및 유효성 검사). [Zero Defect] Google Apps Script의 Cold Start를
  고려해 타임아웃을 20초에서 30초로 상향 조정. [Zero Defect] 상태 파일의
  무한 성장 가능성을 검토했으나, 중복 알림 방지를 위해 현재의 누적 방식이
  가장 안전함을 재확인.
- 6라운드: [Critical] `sendNtfy`가 한글/이모지가 섞인 title을 `Title` HTTP
  헤더로 그대로 보내려 해, Fetch 표준(헤더 값은 ByteString/Latin-1이어야
  함)에 막혀 세 알림 지점(완료 알림·실패 경고·손상 경고) 전부가 항상
  예외를 던지는 결함 발견 — 실제 Node.js fetch로 재현 확인. try/catch가
  실패를 조용히 삼켜 스크립트 자체는 exit 0로 끝나므로 지금까지의 코드
  리뷰만으로는 드러나지 않았다. title을 헤더 대신 body 첫 줄에 포함시키는
  방식으로 수정(4.5절·5.1절 `sendNtfy` 참고) — 이 결함이 있으면 이 기능의
  존재 이유(폰에 푸시 알림 도달)가 설계상 단 한 번도 성공할 수 없었다.
  [Medium] §4.1/§4.2의 "완료가 있을 때만 커밋된다"는 서술이 실제 §5.1
  설계(조회 실패 시에도 진단 필드 갱신으로 커밋 발생)와 어긋남을 발견 —
  서술을 실제 동작에 맞게 정정.
- 7라운드: [Medium→개선] 6라운드의 title-in-body 방식이 작동은 하지만
  최선은 아님을 발견 — ntfy 공식 문서가 명시하는 RFC 2047 인코딩으로
  실제 `Title` 헤더를 쓰도록 교체(ntfy.sh 실제 왕복 테스트로 검증). 이대로
  두면 알림 목록·잠금화면에 실제 제목 대신 토픽 슬러그가 표시될 뻔했다.
  [High] `plotNo` trim/유효성 검사가 5라운드 이력엔 "이미 반영"으로
  기록돼 있었으나 실제 §5.1 코드엔 없었던 불일치를 발견(이력과 코드
  대조로 확인) — 방치하면 plotNo 누락 plot이 매 폴링마다 영구히 "새로
  완료됨"으로 재감지돼 중복 알림이 무한 반복될 수 있어 실제로 `hasValidPlotNo`
  검증을 코드에 추가. [Low] 같은 방식으로 타임아웃이 이력엔 30초로
  기록돼 있었으나 코드엔 20초로 남아있던 불일치도 발견해 실제 값을
  30초로 맞춤. [Medium] §4.2 커밋 조건 서술에 "직전 실패 스트릭에서
  복구만 하고 새 완료는 없는 경우"라는 세 번째 예외 경로가 빠져 있던
  것을 추가 발견해 정정. [Low, 참고] `actions/checkout@v4`의 기본 얕은
  체크아웃 때문에, 이 워크플로우와 무관한 별개 커밋이 같은 폴링 주기에
  main에 들어오면 `git push`가 non-fast-forward로 실패할 수 있음(재시도
  없음) — 이 경우 이번에 감지한 완료가 상태 파일에 반영되지 못해 다음
  실행에서 같은 완료가 재감지돼 중복 알림이 갈 수 있음(과다 알림 방향이라
  심각도는 낮음, §6에 문서화).
- 8라운드: 이력↔실제 코드 전수 대조를 처음부터 끝까지 다시 수행 —
  1~7라운드가 "고쳤다"고 적어놓은 항목이 실제 §5.1/§5.2/§4 서술과 전부
  일치함을 재확인(새로운 이력 불일치는 발견되지 않음). RFC 2047 인코딩
  (`encodeNtfyTitle`)을 Node.js로 재검증하고, 실제 ntfy.sh에 테스트 토픽으로
  POST해 서버 응답 JSON에 `title`이 원래 한글("조사 완료 알림")로 정확히
  디코딩되어 돌아오는 것까지 확인(왕복 검증 완료). `hasValidPlotNo`가 §5.1의
  올바른 위치(getPlots 응답 필터링 지점, `perTeam` map 안)에 적용돼 있음을
  확인했고, `watermap_V100.html`에 참고용으로 포함된 실제 Apps Script
  `doGet`/`getPlots` 소스(`plotNo: r[2].toString().trim()`)를 대조해
  plotNo가 서버에서 항상 문자열로만 내려온다는 설계 전제가 실제 서버
  구현과 일치함을 확인(숫자 타입으로 오는 엣지 케이스는 실존하지 않음).
  타임아웃 비대칭(`fetchJson` 30초 vs `sendNtfy` 15초)은 Apps Script
  콜드스타트와 무관한 별개 서비스(ntfy.sh)라는 근거가 타당해 그대로 둠.
  [Low, 새로 발견·즉시 수정] §5.1 `main()`의 `wasFailing` 복구 전용 커밋
  분기(새 완료 없이 실패 스트릭만 정상 종료된 경우)가 다른 두 성공 경로와
  달리 `lastError: null`을 빠뜨려, `consecutiveFailures: 0`인데 `lastError`엔
  지난 장애 메시지가 그대로 남는 상태 파일이 만들어지고 있었음 — 실제로
  고쳐 `lastError: null`을 추가함. [Low, 관찰·문서화] 특정 팀이 "연속"이
  아니라 "간헐적"으로만 실패하는 패턴이면 `FAILURE_ALERT_THRESHOLD`(연속
  3회)에 영영 도달하지 못해 경고가 안 울릴 수 있음(완전 정지가 아니라
  다른 팀들 알림도 그때그때 한 주기씩 밀리는 정도) — §6에 새 항목으로
  문서화(코드 변경 없음, 발생 조건이 좁고 이 문서의 기존 실패 방향성과
  같은 성격이라 이번 범위에서 코드로 해결하지 않기로 함). 4라운드 이력의
  "[Low] Promise.allSettled 사용 시 Apps Script의 동시성 제한 가능성 인지"가
  §6에 별도 항목으로 남지 않은 점을 확인했으나, 클라이언트의 기존
  "팀별 누적 현황"(`loadTeamSummary`, `watermap_V100.html` 5372행 부근)이
  이미 동일하게 전체 팀을 `Promise.allSettled`로 완전 병렬 호출하는 패턴을
  프로덕션에서 쓰고 있음을 실제 코드로 확인했고, §4.4가 바로 이 사실을
  근거로 들고 있어 새로운 위험이 아니라고 판단 — 추가 조치 불필요.
  **총평: 8라운드에서 발견된 문제는 전부 Low 심각도였고 그중 하나는 이번
  라운드에서 바로 수정했다. Critical/High 성격의 새 결함은 발견되지 않았다
  — 구현 단계로 넘어가도 안전하다고 판단.**
- 9라운드: 지금까지의 검토가 대부분 "부분 재현"이었던 것과 달리, 이번엔
  §5.1 전체 코드를 실제 파일로 옮겨 Node.js `--check`로 문법 검증하고,
  전역 `fetch`를 시나리오별로 모킹해 실제 `node` 하위 프로세스로 11개
  시나리오(최초 실행/기준선 수립, 신규 완료 알림, `getTeams` 실패,
  `getTeams` 응답 형식 불량, `getPlots` 일부 팀 실패, `getPlots` 응답 형식
  불량, 상태 파일 손상, 연속 실패 3회 임계값 도달·스팸 억제·리셋,
  `sendNtfy` 자체 실패, `plotNo` 무효값 필터링, `wasFailing` 복구 분기,
  `teams` 빈 배열, `NTFY_TOPIC` 미설정)를 전부 실제로 실행해 상태 파일
  결과·exit code·ntfy 호출 로그까지 확인했다. **2라운드 회귀 시나리오
  (state 없음 → 팀 하나만 실패 → 1회 실행 → 전체 성공 → 2회 실행)도 정확히
  체크리스트가 요구하는 순서로 재현해, 알림 폭탄 없이 조용히 기준선만
  수립되는 것을 실제 실행으로 재확인했다.** RFC 2047 title 인코딩도
  Node.js로 세 가지 실제 제목 문자열 모두 순수 ASCII로 인코딩되고
  디코딩 시 원문과 정확히 일치함을 재검증했고(6라운드가 지적한 원본
  Critical 버그 — 비-ASCII 문자열을 `Headers`에 그대로 넣으면 던지는
  예외 — 도 실제로 재현해 그 결함이 실존했음을 다시 확인), `git add` +
  `git diff --cached --quiet`가 신규 미추적 파일에서 정확히 exit 1(변경
  감지)을, 반면 스테이징 없는 단순 `git diff --quiet`는 exit 0(오판)을
  내는 것도 실제 `git` 명령으로 재확인했다(1라운드 Critical 버그의 존재
  근거). §5.2 워크플로우 YAML은 PyYAML로 구조 파싱했다 — 단, 범용
  YAML 1.1 파서는 무인용 `on:` 키를 boolean `true`로 오인하는 유명한
  "Norway Problem"이 있어(GitHub Actions 자체 파서와는 무관한, 거의
  모든 공개 GitHub Actions 워크플로우가 겪는 동일한 특성) 이 리졸버만
  끄고 재검증 — `on.schedule.cron`, `on.workflow_dispatch`,
  `concurrency`, `permissions`, 4개 `steps`(그 중 커밋 단계의 임베디드
  bash 블록도 `bash -n`으로 별도 문법 검증) 전부 문서 그대로 정확히
  파싱됨을 확인했다. 8라운드의 `lastError: null` 수정도 실제 실행으로
  재확인(§5.1 `main()`의 `wasFailing` 복구 분기 결과 JSON에 `lastError`가
  정확히 `null`로 기록됨).
  [Low, 새로 발견·즉시 수정] `loadPreviousState()`에서 `JSON.parse(raw)`가
  `readFile`용 try/catch 바깥에 있어, 파일은 읽혔지만 내용이 깨진 경우
  (JSON 파싱 실패)의 에러가 "notify-state.json을 읽을 수 없음(파일 손상
  가능성) — " 접두사 없이 V8의 원본 메시지(예: "Unexpected token ... in
  JSON at position ...")로만 `main()`까지 전파됨을 실제 재현으로 발견 —
  제어 흐름(즉시 손상 경고 발송 + exit 1 + 상태 파일 미변경)은 이미
  정확했으므로 기능적 결함은 아니었지만, 사람이 보는 콘솔 로그·ntfy 경고
  문구에 "파일 손상"이라는 맥락이 빠지는 문제였다. `JSON.parse`도 동일한
  접두사로 감싸도록 그 자리에서 수정했고, 수정 후 재실행해 손상 경고
  문구에 접두사가 정상적으로 포함되고 나머지 11개 시나리오도 전부 그대로
  통과함을 재확인했다.
  **최종 결론: 이번 9라운드에서 발견된 문제는 위 Low 1건(문구 맥락
  누락)뿐이었고 그 자리에서 수정 완료했다. Critical/High/Medium 성격의
  결함은 §5.1 전체 통합 실행과 §5.2 YAML 구조 검증 어디에서도 발견되지
  않았다 — 문서는 문제없음(구현 단계로 진행 가능).**
- 10라운드(외부 AI 피드백 — 사용자가 제미나이의 검토를 전달, Claude가
  직접 판단): [High, 실제 반영] `permissions: contents: write`만으로는
  `git push`가 실패할 수 있음을 지적 — GitHub가 2023년 2월부터 신규
  저장소의 `GITHUB_TOKEN` 기본 권한을 읽기 전용으로 바꿨고, 저장소 레벨
  기본값은 워크플로우 파일의 `permissions:` 키보다 상한선으로 작동해
  워크플로우 쪽 선언만으로는 그 기본값을 넓힐 수 없다. 이건 코드/YAML
  안에 있는 게 아니라 GitHub 저장소 UI 설정이라, 9라운드까지의 "코드
  재현·통합 실행" 검증 방식으로는 애초에 검증 대상이 될 수 없었던
  종류의 결함 — 5.2절 노트와 7절 체크리스트에 반영. [Medium, 이미 반영
  확인] Apps Script 동시성 스로틀링 우려 — §4.4가 이미 이 병렬 조회
  패턴이 프로덕션에 배포된 클라이언트 기능(`loadTeamSummary`)과 동일함을
  근거로 들고 있어 새로운 위험이 아님을 재확인, 추가 조치 없음. [Low,
  실제 반영] `sendNtfy` 실패 시 exit code를 의도적으로 0으로 유지하는
  설계는 그대로 두되(알림 폭탄 방지 방향과 일치), 단순 `console.error`는
  GitHub Actions 작업 요약 화면에 눈에 띄지 않는다는 지적을 받아들여
  `::error::` 워크플로우 명령 문법을 추가해 exit code는 그대로 두면서
  Actions UI 요약에 주석으로 뜨도록 개선. [Low, 반영 보류] ntfy
  `Priority`/`Tags` 헤더로 가독성을 높이자는 제안은 기능 결함이 아닌
  선택적 UX 폴리시로 판단, 사용자 요청 시 별도 반영.
- 아직 구현 전 — 이 문서는 계획 단계다.

## 1. 배경과 목표

조사팀이 표준지 포인트 작업을 완료하면(구글 시트에 반영되면) 사용자가 그걸
즉시 알고 싶어 한다. 참고 사례(스크린샷)는 ntfy(무료, 인증 없는 푸시 알림
앱 — 폰에 앱을 깔고 "주파수"에 해당하는 토픽 문자열을 구독하면, 그 토픽으로
HTTP POST 되는 메시지가 그대로 푸시 알림으로 온다)를 썼다.

**핵심 질문은 "완료 여부를 누가/언제 감지해서 ntfy로 쏘는가"였다.** 세 가지를
검토했다:

1. 이 개인 포크(브라우저 앱) 안에서 주기적으로 감지 — 앱이 켜져 있을 때만
   동작, 닫아두면 감지 자체가 안 됨.
2. 서버(Apps Script)에서 시트 변경 시점에 바로 감지 — 가장 실시간이지만
   관리자가 관리하는 공유 서버를 수정해야 함(이번 세션 내내 "권한 밖"으로
   확정된 영역).
3. **사용자 본인이 통제하는 별도의 정기 작업(GitHub Actions)이 이미
   클라이언트가 쓰는 것과 같은 읽기 전용 서버 API(`getTeams`/`getPlots`)를
   주기적으로 조회해서 변화를 감지 → ntfy로 알림.**

**3번을 채택한다.** 관리자 서버는 읽기만 하고(기존에 클라이언트가 이미
매번 하던 것과 동일한 요청), 앱이 꺼져 있어도 동작하며, 새 계정·새 인프라
없이 이미 쓰고 있는 GitHub(이 저장소)만으로 구현된다.

**사용자가 실제로 받는 것**: 폰에 설치한 ntfy 앱(무료, 회원가입 없음)이
정해둔 토픽을 구독한 상태로 있으면, "OO팀이 △△ 포인트 N건을 완료했습니다"
같은 푸시 알림이 온다. 별도 앱을 새로 만드는 게 아니라 기존 ntfy 앱을 그대로
쓰고, 이 프로젝트에는 "그 토픽으로 알림을 쏘는 자동화 스크립트"만 추가한다.

## 2. 범위

**포함**:
- `watermap-app-personal` 저장소에 GitHub Actions 워크플로우(정기 실행)와
  Node.js 스크립트 추가.
- 스크립트: `getTeams` → 팀별 `getPlots` 조회(기존 "팀별 누적 현황" 기능과
  동일한 패턴) → 이전 실행 때 저장해둔 "완료로 확인된 plotNo 목록"과 비교 →
  새로 완료된 것만 골라 ntfy로 알림 → 상태 파일 갱신·커밋.
- 상태 파일(어떤 plotNo까지 이미 알림을 보냈는지 기록)을 저장소에 커밋해
  실행 간 상태를 유지.

**명시적 제외**:
- Apps Script(서버) 코드 수정 — 전혀 안 건드림. 기존에 이미 공개적으로
  인증 없이 열려있는 `getTeams`/`getPlots` GET 엔드포인트만 그대로 읽기로
  호출한다(클라이언트가 이미 하던 것과 동일한 부하 패턴).
- `watermap_V100.html`(클라이언트 앱) 자체는 변경 없음 — 이 기능은 앱과
  완전히 독립된 별도 자동화이다.
- ntfy 앱 설치·토픽 구독 자체는 사용자가 직접 한다(스크린샷의 1~2단계와
  동일) — 이건 코드로 대신할 수 없는 부분.

## 3. 왜 GitHub Actions인가

- 이 저장소가 **이미 공개(public) 저장소**임을 확인했다(`api.github.com`으로
  직접 조회). 공개 저장소는 GitHub Actions 표준 러너를 **무료로 무제한**
  쓸 수 있어 비용 걱정이 없다.
- 새 계정·새 클라우드 서비스가 필요 없다 — 이미 이 코드를 호스팅하는
  GitHub 계정 하나로 충분하다.
- `cron` 스케줄로 정기 실행이 기본 내장 기능이라 별도 스케줄러가 필요 없다.

**단, 공개 저장소라는 점 때문에 반드시 지켜야 할 것이 하나 있다**: 워크플로우
파일이나 스크립트에 ntfy 토픽 이름을 그대로 적어두면 저장소를 보는 누구나
그 토픽을 알아내 구독(사용자가 받는 모든 완료 알림을 몰래 같이 받아봄)하거나
가짜 알림을 만들어 낼 수 있다. **토픽 이름은 반드시 GitHub Actions Secret
(`NTFY_TOPIC`)으로 저장**하고, 코드에는 절대 하드코딩하지 않는다(아래 6절
참고). `MASTER_SCRIPT_URL`은 이미 `watermap_V100.html`에 평문으로 공개돼
있는 값이라 이건 secret으로 옮길 실익이 없다(이미 노출된 값을 새로 감추는
게 아니라 그대로 재사용).

## 4. 설계

### 4.1 전체 흐름

```
GitHub Actions(cron, 예: 10분마다)
  → ① fetch(MASTER_SCRIPT_URL + '?action=getTeams')로 팀 목록 조회
  → ② 각 팀에 대해 fetch(MASTER_SCRIPT_URL + '?action=getPlots&team=X')로
     완료(done==='완료') 포인트 목록 수집 — "팀별 누적 현황" 기능과 동일한
     방식(팀당 1회 GET, 서버 부하 동일)
  → ③ 저장소에 커밋돼 있는 이전 상태 파일(state.json)의
     "이미 알림 보낸 plotNo 목록"과 비교해 새로 완료된 것만 추림
  → ④ 새로 완료된 게 있으면 ntfy 토픽으로 POST(사람이 읽기 좋은 메시지)
  → ⑤ state.json을 최신 완료 목록으로 갱신하고 저장소에 커밋
     (⑤는 상태 파일 내용이 실제로 바뀌었을 때만 실행 — git add 후
     git diff --cached --quiet로 판정한다. 새 완료가 없어도 다음 세 경우
     중 하나면 커밋이 생긴다: (a) 조회 실패로 진단 필드가 바뀜, (b) 최초
     실행으로 기준선을 수립함, (c) 이번엔 조회가 완전히 성공했고 새 완료도
     없지만 직전 실행에 실패 스트릭이 있어서 그 복구 사실만 기록함(7라운드
     검토에서 추가로 발견 — 6라운드가 (a)(b)만 반영하고 (c)를 놓쳤었다).
     커밋이 전혀 안 생기는 경우는 "조회 성공 + 새 완료 없음 + 직전 실패
     스트릭도 없었음"이 전부 겹치는, 완전히 조용한 실행뿐이다.)
```

### 4.2 상태 저장 — 저장소에 커밋하는 JSON 파일

GitHub Actions 실행은 매번 새 컨테이너에서 시작해 아무 것도 기억하지
못한다. 실행 간 "지난번엔 어디까지 완료였는지"를 기억할 곳이 필요한데,
가장 간단하고 이 프로젝트의 기존 관례(작업 이력을 저장소 파일로 남기는 것)와
맞는 방법은 **작은 JSON 상태 파일을 저장소에 커밋**해두는 것이다:

```json
{
  "baselineEstablished": true,
  "notifiedPlotNos": ["1011-0079", "1011-0182", "..."],
  "lastCheckedAt": "2026-08-25T07:00:00Z",
  "consecutiveFailures": 0,
  "failureAlertSent": false,
  "lastError": null
}
```

`notifiedPlotNos`(이미 알림 보낸 plotNo 목록)가 핵심이고, 나머지
`consecutiveFailures`/`failureAlertSent`/`lastError`는 4.7절에서 다루는
"서버 조회가 계속 실패하는 상황"을 사용자가 알아챌 수 있게 하는 보조
필드다. `baselineEstablished`는 4.3절에서 설명하는, **2라운드 검토에서
발견된 실제 회귀를 막기 위해 새로 추가된 필드**다 — 그냥 `notifiedPlotNos`가
비어있는지로 "아직 기준선 없음"을 판단하면 안 되는 이유가 4.3절에 있다.
이 파일의 내용이 실제로 바뀌었을 때만(git add 후 git diff --cached --quiet로
판정, 4단계 §5.2 참고) 갱신·커밋한다 — 하지만 "바뀌었을 때"는 새로 완료된
plotNo가 생겼을 때만이 아니다. `lastCheckedAt`/`consecutiveFailures` 같은
진단 필드는 조회가 실패해도 갱신되므로, 새 완료가 하나도 없는 실행에서도
커밋이 생길 수 있다(4.7절 참고). 그리고 이번 실행이 완전히 성공하고 새
완료도 없더라도, **직전 실행에 실패 스트릭이 있었다면** 그 복구 사실
(`consecutiveFailures`를 0으로 되돌린 것)을 기록하기 위해 역시 커밋이
생긴다(5.1절 `main()`의 `wasFailing` 분기 — 7라운드 검토에서 추가로
발견, 6라운드는 조회 실패·기준선 수립 두 경우만 반영하고 이 세 번째
경우를 놓쳤었다). 즉 커밋이 전혀 안 생기는 경우는 "조회 성공 + 새 완료
없음 + 직전 실패 스트릭도 없었음"이 전부 겹치는, 완전히 조용한 실행뿐이다
— "완료가 있을 때만 커밋되어 커밋 이력이 곧 완료 기록"이라는 최초 서술은
부정확했다.

### 4.3 최초 실행 — 알림 없이 기준선만 만든다 (2라운드 회귀 수정 포함)

state.json 파일이 아직 없는 첫 실행에서, 그 시점에 이미 완료돼 있던
포인트 전부를 "새로 완료된 것"으로 오인하면 대량의 알림이 한꺼번에
쏟아진다(원하는 게 아니다). **`baselineEstablished`가 `true`가 아니면
이번 실행은 알림을 하나도 보내지 않고, 현재 완료 목록을 `notifiedPlotNos`에
저장하면서 `baselineEstablished`를 `true`로 확정만 하고 끝낸다.** 그 다음
실행부터 진짜 "새로 생긴 완료"만 알림 대상이 된다.

**왜 "파일 유무"가 아니라 별도 플래그로 판단하는가(2라운드에서 실제로 재현된
회귀 수정)**: 처음엔 "state.json이 없으면 최초 실행"으로 단순하게 판단했는데,
서브에이전트가 다음 시나리오를 실제로 재현해 실패시켰다 — **① 최초 실행에서
팀 하나만 일시적으로 조회 실패 → 4.7절의 실패 기록 로직이 `notifiedPlotNos: []`를
"기준선인 것처럼" 파일에 써버림 → ② 다음 실행에서 전체 성공 → 이제
state.json이 존재하니까 "이미 기준선이 있다"고 오판 → 예전부터 쌓여있던
모든 완료 건이 전부 "새로 완료됨"으로 오인되어 알림 폭탄이 나감.**

이 문제의 핵심은 "state.json 파일이 존재하는가"와 "진짜로 신뢰할 수 있는
완료 목록 기준선이 수립됐는가"가 서로 다른 질문인데 하나로 뭉뚱그려 판단했다는
것이다. 그래서 **실패를 기록할 때도 `baselineEstablished`는 절대 `true`로
바꾸지 않고, 원래 값(진짜 기준선이 없었다면 계속 `false`)을 그대로 이어간다**
(4.7절, 5.1절 `recordFailureAndMaybeAlert` 참고) — 그러면 그 사이에 실패가
몇 번 있었든, 성공이 처음 발생하는 실행에서 정확히 4.3절의 "기준선 수립"
경로를 타게 되어 알림 폭탄이 재발하지 않는다.

### 4.4 폴링 주기

`cron`으로 10분마다 실행하는 것을 기본값으로 한다. 참고:
- GitHub Actions의 예약 실행은 "정확히 그 시각"을 보장하지 않는다(부하가
  많으면 몇 분 늦게 실행될 수 있음) — 초 단위 실시간성이 필요한 게 아니라
  "완료되면 대략 10분 내로 안다" 정도의 목적에는 문제없다.
- 5분 미만 간격은 GitHub이 신뢰성 있게 보장하지 않는 영역이라 권장하지
  않는다.
- 서버(Apps Script) 부하는 팀 수만큼의 GET 요청/회당인데, 이미 클라이언트의
  "팀별 누적 현황" 기능이 사용자가 버튼을 누를 때마다 발생시키는 것과 같은
  크기이고 10분마다 자동 반복될 뿐이므로 과도한 부하로 보지 않는다(다만
  팀 수가 아주 많아지면 주기를 늘리는 것을 고려 — 4단계 이전 세션에서
  이미 같은 판단 기준 사용).

### 4.5 알림 메시지

새로 완료된 포인트를 팀별로 묶어서 보낸다(한 번의 폴링 주기에 여러 팀이
동시에 완료할 수 있으므로):

```
제목: 조사 완료 알림
본문: 박정환,김금섭 (소양강) — 1011-0089, 1011-0110 외 1건 완료
      류수현,최영근 (소양강) — 1011-0203 완료
```

ntfy는 제목(`Title` 헤더)과 본문(POST body)을 나눠서 받는다. 이 제목이
한글/이모지를 포함하는 이상 HTTP 헤더에 원문 그대로는 넣을 수 없지만
(5.1절 `sendNtfy` 참고 — Fetch 표준상 헤더 값은 ByteString이어야 해서
비-ASCII 문자열을 헤더에 넣으면 예외가 난다, 6라운드 검토에서 실제
재현으로 발견), ntfy 공식 문서가 명시하는 RFC 2047 인코딩
(`=?UTF-8?B?<base64>?=`)으로 감싸면 순수 ASCII가 되어 헤더 제약을
그대로 지키면서도 ntfy 서버가 원래 한글 제목으로 정확히 복원해 표시한다
(7라운드 검토에서 실제 ntfy.sh 테스트 토픽으로 왕복 검증). 이렇게 해야
ntfy 앱의 알림 목록·잠금화면에 실제 제목("조사 완료 알림" 등)이 굵게
표시된다 — 헤더 없이 본문에만 제목을 욱여넣으면 그 자리를 토픽 슬러그가
대신 차지해 알아보기 어려워진다. 여러 팀이 동시에 완료됐으면 팀별
줄바꿈으로 한 번의 알림에 모아 보낸다(팀마다 개별 알림을 쏘면 여러 팀이
동시에 끝났을 때 알림이 우르르 쏟아질 수 있어 묶는 편이 낫다).

### 4.6 ntfy 토픽 보안 — GitHub Actions Secret

저장소 Settings → Secrets and variables → Actions에 `NTFY_TOPIC`이라는
이름으로 토픽 문자열을 저장한다(예: `watermap-done-9xkg2ts` 같은 예측
불가능한 값 — 스크린샷 게시물이 권고한 것과 동일한 원칙). 워크플로우
파일에서는 `${{ secrets.NTFY_TOPIC }}`로만 참조하고, 코드나 커밋 로그
어디에도 실제 토픽 문자열이 평문으로 남지 않는다.

### 4.7 실패 처리

`getTeams`/`getPlots` 요청이 실패하면(일시적 네트워크 문제 등) **`notifiedPlotNos`는
갱신하지 않고 이번 실행의 "새로 완료됨" 판정을 건너뛴다** — 실패한 조회
결과를 "완료 없음"으로 잘못 확정해 반영하면, 다음 정상 실행 때 그 사이에
실제로 있었던 완료를 "새로 생김"으로 오인해 지나치거나, 반대로 이미 안
사이에 완료된 걸 놓치는 문제가 생길 수 있다.

**다만 완전히 "아무 것도 안 하고 조용히 넘어가는" 것도 문제다.** 서브에이전트
검토에서 지적된 대로, 만약 특정 팀 하나가 (이상한 팀명, 인코딩 문제, 시트에서
지워졌지만 `getTeams` 응답엔 여전히 남아있는 등의 이유로) **지속적으로**
조회에 실패하면, 매 실행마다 전체가 건너뛰어지고 **다른 모든 팀의 새 완료도
영구히 알림이 안 나가는 상태**가 될 수 있는데, 이걸 사용자가 알 방법이
GitHub Actions 로그를 직접 열어보는 것 말고는 없다 — 정작 이 자동화를
쓰는 이유가 "알림을 기다리는 것"인데, 알림 채널 자체가 멈춘 걸 알림으로
알 수 없다는 모순이 생긴다.

그래서 실패가 **연속으로 일정 횟수(기본 3회, 10분 주기 기준 약 30분) 이상**
쌓이면, "완료 알림" 자체와는 별개로 **"알림 시스템에 문제가 있다"는 경고를
ntfy로 1회** 보낸다(그 이후엔 문제가 해결될 때까지 매번 또 보내 스팸이 되지
않도록 억제 플래그를 둔다). 성공이 한 번이라도 다시 발생하면 실패 카운터와
억제 플래그를 리셋한다. 이걸 위해 `notifiedPlotNos`와는 별도로
`consecutiveFailures`/`failureAlertSent`/`lastError` 필드를 실패 시에도
기록한다(4.2절 스키마 참고) — **`notifiedPlotNos`만 실패 시 절대 안 바뀌고,
나머지 진단용 필드는 실패해도 갱신된다**는 점이 핵심이다.

**"파일이 없음"과 "파일이 손상됨"도 구분한다.** `notify-state.json`을 읽다가
나는 오류가 전부 "최초 실행"으로 오인되면 안 된다 — 진짜 파일이 없는 경우
(`ENOENT`)만 최초 실행으로 보고, 그 외(JSON 파싱 실패, 권한 문제 등 —
파일은 있는데 못 읽는 상황)는 "이전 이력이 있었는데 사고로 못 읽는" 것이므로
최초 실행으로 오인해 그 이력을 알림 없이 흡수해버리지 않고, 실행 자체를
실패 처리(비정상 종료)해서 사람이 알아채게 한다. 이 경우는 3회 연속을
기다리지 않고 **즉시 별도의 ntfy 경고를 1회 보낸다**(상태 추적 메커니즘
자체가 신뢰할 수 없어진 상황이라, 연속 실패 카운터에 기대는 것 자체가
맞지 않는 별개의 사고 유형이기 때문) — 아무 상태도 쓰지 않고 종료해
디스크에 남은 손상된 파일을 사람이 직접 확인할 수 있게 남겨둔다.

**모든 실패 지점이 같은 경고 메커니즘을 거치도록 통일한다(2라운드에서 발견된
사각지대 수정).** 처음엔 `getPlots`(팀별 완료 조회) 실패만
`recordFailureAndMaybeAlert`를 거치고, `getTeams`(팀 목록 조회) 자체가
실패하는 경우는 별도 처리 없이 그냥 스크립트가 죽는 구조였다 — 이러면
Apps Script가 통째로 다운되는, 개별 팀 실패보다 더 흔하고 심각한 단일
장애점에서 정작 "알림이 안 오는 이유를 알려주는" 경고 자체가 발동하지
않는 사각지대가 있었다(서브에이전트가 발견). **`getTeams` 호출도 동일하게
`recordFailureAndMaybeAlert`를 거치도록 통일한다** — 팀 목록 조회 실패든
팀별 완료 조회 실패든 "이번 실행이 서버 상태를 제대로 못 봤다"는 점에서는
같은 종류의 문제이므로 같은 카운터·같은 경고 로직을 공유한다.

### 4.8 동시 실행 방지

GitHub Actions는 기본적으로 같은 워크플로우의 중복 실행을 막지 않는다.
cron 실행이 예상보다 오래 걸리거나 수동(`workflow_dispatch`) 실행이 예약
실행과 겹치면, **두 실행이 같은(아직 커밋 전인) 이전 상태를 보고 똑같이
"새로 완료됨"을 감지해 ntfy 알림을 중복으로 보낼 수 있고**, 뒤늦게 push하는
쪽은 먼저 push된 커밋과 충돌해 실패할 수도 있다. `concurrency:` 그룹을
지정해 **겹치면 취소하지 말고 순서대로 기다리게** 한다(취소하면 마침
커밋/알림 전송 중이던 실행이 중간에 끊길 수 있어 더 위험하다) — 이러면
두 번째 실행은 첫 번째가 커밋까지 끝낸 뒤에야 시작되므로, 체크아웃 시점에
이미 최신 `notifiedPlotNos`를 보게 되어 애초에 경합 자체가 생기지 않는다.

## 5. 구현

### 5.1 스크립트 (`scripts/notify-completed-plots.mjs`)

```js
// GitHub Actions에서 주기 실행 — 조사팀 포인트 완료를 감지해 ntfy로 알림.
// watermap_V100.html(클라이언트)과 완전히 독립된 별도 자동화이며, 서버는
// 읽기 전용 GET(getTeams/getPlots)만 호출한다 — 클라이언트가 이미 매번
// 하던 것과 동일한 요청.
import { readFile, writeFile } from 'node:fs/promises';

const MASTER_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzpx33WGdJr52Z1d9c_n5zgtN6L76FyJ4MoueM8wl2fxANVtL5wVgM4VSgWHOOq1dGz/exec';
const STATE_PATH = new URL('../notify-state.json', import.meta.url);
const NTFY_TOPIC = process.env.NTFY_TOPIC;
const FAILURE_ALERT_THRESHOLD = 3; // 연속 3회(10분 주기 기준 약 30분) 실패하면 별도 경고 1회

if (!NTFY_TOPIC) {
  console.error('NTFY_TOPIC 환경변수(시크릿)가 없습니다.');
  process.exit(1);
}

async function fetchJson(url) {
  // Apps Script는 콜드스타트 시 느릴 수 있어 20초보다 여유 있게 잡는다
  // (5라운드 결정 — 이전 판에는 30초로 정했다고 이력에 적어놓고 실제
  // 코드는 20000ms로 남아있던 불일치를 7라운드 검토에서 발견, 이 코드로
  // 실제 값을 이력과 일치시킨다).
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' — ' + url);
  return res.json();
}

// Title은 한글/이모지를 포함하므로 HTTP 헤더에 그대로 넣을 수 없다 — Fetch
// 표준의 Headers는 값이 ByteString(Latin-1)이어야 해서, 비-ASCII 문자가
// 섞인 문자열을 헤더로 넘기면 Node/브라우저 fetch 모두 그 자리에서 예외를
// 던진다(실제 재현 완료, 6라운드 검토에서 발견된 Critical 결함).
//
// 처음엔(6라운드) title을 헤더 대신 body 첫 줄에 포함시키는 방식으로
// 수정했으나, 7라운드 검토에서 ntfy 공식 문서(docs.ntfy.sh/publish)가
// 이 문제에 대해 RFC 2047(MIME 헤더 비-ASCII 인코딩, "=?UTF-8?B?<base64>?=")
// 방식을 공식 우회법으로 명시하고 있음을 확인 — 실제 ntfy.sh 테스트
// 토픽에 POST해서 서버가 원래 한글 제목으로 정확히 디코딩해 돌려주는
// 것까지 검증했다. body-only 방식은 정보 손실은 없지만, ntfy 앱의 알림
// 목록·잠금화면에 굵게 표시되는 제목이 실제 내용("조사 완료 알림")이
// 아니라 토픽 슬러그로 나오고, 정작 중요한 내용(어느 팀이 뭘 완료했는지)은
// 본문 3번째 줄부터 시작돼 알림이 접힌 상태에서 안 보일 수 있다는 문제가
// 있었다 — 그래서 RFC 2047 인코딩으로 실제 Title 헤더를 쓰는 쪽으로 최종
// 채택한다.
function encodeNtfyTitle(title) {
  return '=?UTF-8?B?' + Buffer.from(title, 'utf8').toString('base64') + '?=';
}

async function sendNtfy(title, body) {
  const res = await fetch('https://ntfy.sh/' + encodeURIComponent(NTFY_TOPIC), {
    method: 'POST',
    headers: { 'Title': encodeNtfyTitle(title) },
    body,
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error('ntfy HTTP ' + res.status);
}

// ENOENT(파일 없음 = 진짜 최초 실행)만 "이전 상태 없음"(null)으로 취급한다.
// 그 외 오류(JSON 파싱 실패, 권한 문제 등)는 "이전 이력이 있었는데 못 읽는"
// 사고이므로 그대로 throw한다 — main()에서 이걸 별도로 잡아 즉시 경고 +
// 상태를 안 건드리고 종료한다(4.7절 "파일 손상" 참고, 실패 스트릭 카운터와
// 분리된 별개의 처리).
async function loadPreviousState() {
  let raw;
  try {
    raw = await readFile(STATE_PATH, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw new Error('notify-state.json을 읽을 수 없음(파일 손상 가능성) — ' + e.message);
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    // 9라운드 검토에서 발견: JSON.parse가 위 try/catch 밖에 있으면, 파일은
    // 읽혔지만 내용이 깨진 경우(JSON 파싱 실패) 이 SyntaxError가 위의
    // "notify-state.json을 읽을 수 없음..." 접두사 없이 그대로(예:
    // "Unexpected token ... in JSON at position ...") main()까지 전파된다.
    // 제어 흐름(즉시 손상 경고 발송 + exit 1 + 상태 파일 미변경)은 이미
    // 정확했지만, 사람이 보는 로그/ntfy 경고 문구에 "파일 손상"이라는
    // 맥락이 빠져 있었다 — 실제 재현으로 확인 후 여기서 동일하게 감싼다.
    throw new Error('notify-state.json을 읽을 수 없음(파일 손상 가능성) — ' + e.message);
  }
}

function isDone(p) {
  // 서버(관리자가 임의로 바꿀 수 있는 영역)가 언젠가 다른 표기를 쓸 가능성에
  // 대비해, 클라이언트(watermap_V100.html)가 이미 쓰고 있는 관대한 판정
  // 기준(완료/O/Y)과 동일하게 맞춘다.
  const d = p?.done;
  return d === '완료' || d === 'O' || d === 'Y';
}

// plotNo가 없거나 빈 문자열/공백뿐인 plot은 걸러낸다. 5라운드 이력에는
// 이미 이 방어를 넣었다고 기록돼 있었지만 실제로는 코드에 반영되지 않은
// 채 남아있던 것을 7라운드 검토에서 발견했다 — 이 검증 없이 plotNo가
// undefined인 plot이 하나라도 오면 JSON.stringify가 배열의 undefined를
// null로 직렬화하고, 다음 실행에서 prevSet.has(undefined)는 저장된 값이
// null이라 항상 false가 되어 그 plot이 매 폴링마다 영구히 "새로 완료됨"으로
// 재감지돼 중복 알림이 무한 반복될 수 있다.
function hasValidPlotNo(p) {
  return typeof p?.plotNo === 'string' && p.plotNo.trim().length > 0;
}

// 팀 목록/팀별 완료 조회 중 어느 쪽이 실패하든 이 함수 하나로 통일해서
// 처리한다(2라운드에서 getTeams 실패가 이 경고 메커니즘을 완전히 비켜가던
// 사각지대를 수정 — 4.7절 참고).
//
// *** 핵심 불변식 ***: baselineEstablished가 언젠가 true였다면 그 값을 절대
// 손대지 않고, 원래 false(또는 아직 상태 자체가 없음)였다면 실패를 기록해도
// 계속 false로 남긴다. notifiedPlotNos도 마찬가지로 원래 값을 그대로
// 보존한다 — "실패했다"는 사실이 "기준선이 수립됐다"는 사실로 둔갑하는 걸
// 원천 차단한다(2라운드에서 실제로 재현된 회귀: 최초 실행 중 실패가 나면
// 빈 배열이 진짜 기준선인 것처럼 저장돼, 바로 다음 성공 시 그동안 쌓여있던
// 모든 완료 건이 "새로 완료됨"으로 오인되어 알림 폭탄이 나갔다).
async function recordFailureAndMaybeAlert(prevState, errorSummary) {
  const base = prevState || { baselineEstablished: false, notifiedPlotNos: [], failureAlertSent: false };
  const consecutiveFailures = (base.consecutiveFailures || 0) + 1;
  const shouldAlert = consecutiveFailures >= FAILURE_ALERT_THRESHOLD && !base.failureAlertSent;
  let failureAlertSent = base.failureAlertSent;

  if (shouldAlert) {
    try {
      await sendNtfy('⚠️ 조사 완료 알림 시스템 오류',
        '서버 조회가 ' + consecutiveFailures + '회 연속 실패했습니다. 완료 알림이 지연될 수 있습니다.\n' + errorSummary.slice(0, 200));
      failureAlertSent = true; // 실제 성공 시에만 true로 변경
    } catch (e) {
      console.error('실패 경고 알림 전송도 실패:', e.message);
    }
  }

  await writeFile(STATE_PATH, JSON.stringify({
    ...base, // baselineEstablished, notifiedPlotNos 등 기존 값 그대로 보존
    lastCheckedAt: new Date().toISOString(),
    consecutiveFailures,
    lastError: errorSummary.slice(0, 500),
    failureAlertSent,
  }, null, 2));
}

async function main() {
  // 상태 파일 손상은 실패 스트릭 카운터와 별개의 사고 유형이라(4.7절), 3회를
  // 기다리지 않고 즉시 경고 1회 + 아무 상태도 안 쓰고 종료한다.
  let prevState;
  try {
    prevState = await loadPreviousState();
  } catch (err) {
    console.error(err.message);
    try {
      await sendNtfy('⚠️ 조사 완료 알림 상태 파일 손상',
        'notify-state.json을 읽을 수 없습니다 — 수동 확인이 필요합니다.\n' + err.message.slice(0, 200));
    } catch (e2) {
      console.error('손상 경고 알림 전송 실패:', e2.message);
    }
    process.exit(1);
  }

  let teams;
  try {
    const teamsData = await fetchJson(MASTER_SCRIPT_URL + '?action=getTeams');
    if (!teamsData || !Array.isArray(teamsData.teams)) {
      throw new Error('getTeams 응답 형식이 올바르지 않음(teams 필드 없음)');
    }
    teams = teamsData.teams.filter(t => typeof t === 'string' && t.trim());
  } catch (err) {
    console.error('getTeams 실패:', err.message);
    await recordFailureAndMaybeAlert(prevState, 'getTeams 실패: ' + err.message);
    return;
  }

  if (teams.length === 0) {
    console.log('팀 목록이 비어있음 — 종료(상태 변경 없음)');
    return;
  }

  const perTeam = await Promise.allSettled(teams.map(async team => {
    const data = await fetchJson(MASTER_SCRIPT_URL + '?action=getPlots&team=' + encodeURIComponent(team));
    if (!data || !Array.isArray(data.plots)) {
      throw new Error(team + ' 팀의 getPlots 응답 형식이 올바르지 않음(plots 필드 없음)');
    }
    const done = data.plots.filter(p => typeof p === 'object' && p && isDone(p) && hasValidPlotNo(p));
    return { team, done };
  }));

  const failed = perTeam.filter(r => r.status === 'rejected');
  if (failed.length > 0) {
    const summary = failed.map(f => String(f.reason?.message || f.reason)).join('; ');
    console.error('일부 팀 조회 실패:', summary);
    await recordFailureAndMaybeAlert(prevState, summary);
    return;
  }

  // 여기 도달했다는 건 이번 실행이 완전히 성공했다는 뜻 — 실패 스트릭을 리셋한다.
  const results = perTeam.map(r => r.value);
  const currentDonePlotNos = new Set();
  results.forEach(r => r.done.forEach(p => currentDonePlotNos.add(p.plotNo)));

  const baselineEstablished = !!prevState?.baselineEstablished;

  // 알림 목록은 "교체"가 아닌 "누적 합집합" 방식으로 관리한다.
  // 서버에서 일시적으로 데이터가 빠져도(응답 지연 등) 이미 보낸 알림이
  // 다시 나가는 "알림 폭탄"을 원천 차단하기 위함이다.
  const updatedNotifiedSet = new Set(prevState?.notifiedPlotNos || []);
  currentDonePlotNos.forEach(p => updatedNotifiedSet.add(p));

  if (!baselineEstablished) {
    // 진짜 기준선 수립 — prevState가 아예 null이었든(순수 최초 실행), 그 사이
    // 실패가 몇 번 있었든(baselineEstablished가 계속 false로 보존돼 왔음)
    // 상관없이, "성공해서 완료 목록을 처음 확인한 이 순간"에만 기준선을
    // 확정한다. 알림은 보내지 않는다.
    await writeFile(STATE_PATH, JSON.stringify({
      baselineEstablished: true,
      notifiedPlotNos: [...updatedNotifiedSet],
      lastCheckedAt: new Date().toISOString(),
      consecutiveFailures: 0,
      failureAlertSent: false,
      lastError: null,
    }, null, 2));
    console.log('기준선 수립 — ' + updatedNotifiedSet.size + '건 저장, 알림 없음');
    return;
  }

  const prevSet = new Set(prevState.notifiedPlotNos || []);
  const newlyDoneByTeam = results
    .map(r => ({ team: r.team, plots: r.done.filter(p => !prevSet.has(p.plotNo)) }))
    .filter(r => r.plots.length > 0);

  const wasFailing = (prevState.consecutiveFailures || 0) > 0;

  if (newlyDoneByTeam.length === 0) {
    if (wasFailing) {
      // 새로 완료된 건 없지만, 실패 스트릭이 정상적으로 끝났다는 건 기록해둔다.
      // lastError도 함께 비운다(8라운드 검토에서 발견 — 다른 두 성공 경로
      // (기준선 수립, 신규 완료 알림)는 모두 lastError: null을 명시하는데
      // 이 복구 전용 경로만 ...prevState로 옛 에러 메시지를 그대로 남겨,
      // consecutiveFailures: 0인데 lastError엔 지난 장애 메시지가 남아있는
      // 모순된 상태 파일이 만들어지고 있었다).
      await writeFile(STATE_PATH, JSON.stringify({
        ...prevState,
        lastCheckedAt: new Date().toISOString(),
        consecutiveFailures: 0,
        failureAlertSent: false,
        lastError: null,
      }, null, 2));
    }
    console.log('새로 완료된 포인트 없음');
    return;
  }

  const lines = newlyDoneByTeam.map(r => {
    const basin = r.plots[0]?.basin ? ' (' + r.plots[0].basin + ')' : '';
    const names = r.plots.slice(0, 2).map(p => p.plotNo).join(', ');
    const rest = r.plots.length > 2 ? ' 외 ' + (r.plots.length - 2) + '건' : '';
    return r.team + basin + ' — ' + names + rest + ' 완료';
  });

  try {
    await sendNtfy('조사 완료 알림', lines.join('\n'));
  } catch (err) {
    // exit code는 의도적으로 0(성공)으로 유지한다 — 일시적 ntfy.sh 장애로
    // Actions 실행이 매번 빨갛게 표시되면 "알림 폭탄 방지"와 같은 방향으로
    // 설계된 이 문서의 다른 실패 처리들과 어긋난다(다음 실행이 자연히
    // 재시도하므로 실패로 죽일 필요가 없음). 다만 console.error만으로는
    // GitHub Actions 작업 요약 화면에 눈에 띄게 표시되지 않으므로(로그를
    // 펼쳐봐야 보임), `::error::` 워크플로우 명령 문법으로 같은 메시지를
    // 한 번 더 남겨 Actions UI 요약에 주석(annotation)으로 뜨게 한다 —
    // exit code는 그대로 0이라 다음 실행을 막지 않으면서 가시성만 높인다
    // (외부 피드백으로 발견, 실행 자체는 이전부터 이미 console.error로
    // 로그를 남기고 있었다).
    console.error('::error::ntfy 전송 실패 — notifiedPlotNos는 갱신하지 않고 다음 실행에서 재시도: ' + err.message);
    return; // notifiedPlotNos를 안 바꿔야 다음 실행에서 같은 완료를 다시 감지해 재시도한다
  }

  await writeFile(STATE_PATH, JSON.stringify({
    baselineEstablished: true,
    notifiedPlotNos: [...updatedNotifiedSet],
    lastCheckedAt: new Date().toISOString(),
    consecutiveFailures: 0,
    failureAlertSent: false,
    lastError: null,
  }, null, 2));
  console.log('알림 전송 완료:\n' + lines.join('\n'));
}

main().catch(err => {
  console.error('실행 실패:', err);
  process.exit(1);
});
```

### 5.2 워크플로우 (`.github/workflows/notify-completed-plots.yml`)

```yaml
name: 조사 완료 ntfy 알림

on:
  schedule:
    - cron: '*/10 * * * *'   # 10분마다(GitHub 사양상 정확한 시각은 보장 안 됨)
  workflow_dispatch: {}       # 수동 실행 버튼(테스트·즉시 확인용)

concurrency:
  group: notify-completed-plots
  cancel-in-progress: false   # 겹치면 취소하지 말고 대기 — 4.8절 참고.
                              # 취소하면 마침 커밋/알림 전송 중이던 실행이
                              # 중간에 끊길 수 있어 대기가 더 안전하다.

permissions:
  contents: write             # notify-state.json 커밋을 위해 필요
                              # ※ 이 값은 저장소 Settings의 기본값을
                              # "넓히지" 못한다 — 아래 커밋 단계 설명
                              # 뒤에 이어지는 노트 참고(외부 피드백으로
                              # 발견된 운영 환경 결함, 9라운드까지의
                              # 코드 재현 검증으로는 잡을 수 없었던 항목).

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: node scripts/notify-completed-plots.mjs
        env:
          NTFY_TOPIC: ${{ secrets.NTFY_TOPIC }}
      - name: notify-state.json 변경 시에만 커밋
        run: |
          if [ -f notify-state.json ]; then
            git add notify-state.json
            if ! git diff --cached --quiet; then
              git config user.name "github-actions[bot]"
              git config user.email "github-actions[bot]@users.noreply.github.com"
              git commit -m "chore: 조사 완료 상태 갱신 [skip ci]"
              git push
            fi
          fi
```

**`git diff` 대신 `git add` 후 `git diff --cached`를 쓴 이유(서브에이전트가
실제로 재현해 찾아낸 결함 수정)**: `notify-state.json`은 첫 실행 때는 아직
한 번도 커밋된 적 없는 새 파일이다. `git diff`(스테이징 전 비교)는 **git이
이미 추적 중인 파일의 변경분만** 비교하기 때문에, 추적되지 않는 새 파일은
아무리 내용이 있어도 "변경 없음"(종료 코드 0)으로 잘못 판정한다 — 실제로
로컬에서 재현해 확인된 문제다. 그러면 최초 실행에서 커밋이 아예 안 올라가고,
다음 실행도 저장소에서 여전히 파일을 못 찾아 또 "최초 실행"으로 판단하는
게 무한 반복돼 **알림이 영원히 한 번도 안 나가는** 상태가 된다. `git add`로
먼저 스테이징한 뒤 `git diff --cached`(스테이징된 것과 마지막 커밋을 비교)로
바꾸면, 파일이 새로 생겼든 기존 파일이 바뀌었든 정확히 감지된다.

**워크플로우의 `permissions: contents: write`만으로는 push가 실패할 수
있다(외부 피드백으로 발견 — GitHub 저장소 UI 설정이라 지금까지의 코드
재현·통합 실행 검증 방식으로는 검증 대상이 될 수 없었던 항목).** GitHub는
2023년 2월부터 신규 저장소의 `GITHUB_TOKEN` 기본 권한을 "Read repository
contents permissions"(읽기 전용)로 바꿨다. 이 저장소 레벨 기본값은
워크플로우 파일의 `permissions:` 키보다 **상한선**으로 작동한다 — 즉
워크플로우가 `contents: write`를 명시해도, 저장소 설정이 읽기 전용이면
그 기본값을 "넓히지" 못하고 `git push` 단계에서 403(권한 거부)으로
실패한다. `permissions:` 키는 저장소 기본값을 그보다 더 좁히는 것만
가능하다. **저장소 Settings → Actions → General → Workflow permissions에서
"Read and write permissions"를 미리 켜둬야 한다** — 이 저장소가 이미
과거에 이 설정을 켜뒀을 수도 있지만(과거 세션에서 별도 확인된 바 없음),
확실히 하려면 구현 전 반드시 직접 확인·설정한다(7절 체크리스트 참고).

`[skip ci]`는 커밋 메시지에 관례적으로 남겨둔다 — 다만 정확히 짚자면, 지금
이 저장소엔 `.github/workflows/`가 이 워크플로우 파일 하나뿐이고, 이 워크플로우
자체도 `push` 트리거가 없어 자기 자신을 재유발하지도 않으며, 이 저장소의
GitHub Pages 배포는 Actions 기반이 아니라(워크플로우 파일 부재로 확인)
브랜치 직접 배포 방식으로 보이므로 `[skip ci]`가 그 배포를 막아주지도
않는다(그 배포는 `[skip ci]`와 무관하게 그대로 다시 일어난다 — 다만 정적
파일 배포라 비용·부작용이 없으므로 문제는 아니다). 지금 당장은 실질적
효과가 없지만, 나중에 `push`에 반응하는 다른 Actions 워크플로우(예: lint
CI)가 추가될 경우를 위한 저비용 관례로 유지한다.

## 6. 알려진 한계

- **정확히 실시간은 아니다.** 폴링 주기(10분)만큼 지연이 생긴다 — 관리자
  서버를 직접 건드리지 않는 이상 이 지연은 구조적으로 피할 수 없다(2절
  참고).
- **`done`은 날짜가 아니라 누적 기준**(이전 세션에서 이미 확정한 사실) —
  이 자동화는 "state.json에 없던 plotNo가 새로 나타남"만 감지하므로, 어떤
  이유로든 서버 시트에서 완료 표시가 지워졌다가 나중에 다시 완료로 바뀌면
  또 한 번 "새로 완료"로 알림이 갈 수 있다(드문 경우, 별도 대응 불필요로
  판단).
- **GitHub Actions 예약 실행의 타이밍은 정확하지 않다** — 부하가 많으면
  몇 분 늦게 실행될 수 있음(GitHub 공식 사양).
- **ntfy는 사용자가 앱을 설치하고 그 토픽을 구독해야만** 알림을 받는다 —
  이건 코드가 아니라 사용자가 직접 해야 하는 설정(스크린샷의 1~2단계와
  동일).
- 이 저장소가 공개(public)이므로, 상태 파일(`notify-state.json`)에 담기는
  완료 plotNo 목록도 공개적으로 보인다 — 이미 클라이언트 앱의 여러 화면
  (팀별 누적 현황 등)에서도 같은 수준의 정보(팀명·조사지번호)를 다루고
  있어 새로운 노출은 아니라고 판단한다. 민감하다고 느끼시면 사설(private)
  저장소로 전환하거나, 상태 파일을 저장소 밖(예: GitHub Actions
  Variables/외부 스토리지)으로 옮기는 것도 가능하나 이번 범위에는 포함하지
  않는다.
- **특정 팀이 영구적으로 조회 실패하는 경우, 4.7절의 연속 실패 경고로
  완화되지만 100% 해결은 아니다.** 경고 자체가 "성공 시 리셋, 실패 시
  1회만 발송"이라 GitHub Actions 실행 자체가(예: 아래 60일 비활동 자동
  비활성화로) 완전히 멈추면 이 경고조차 나갈 수 없다 — 그 경우엔 사용자가
  주기적으로 Actions 탭을 직접 확인하는 것 외엔 알아챌 방법이 없다.
- **GitHub은 예약(cron) 워크플로우를 저장소에 60일간 활동(커밋 등)이 없으면
  자동으로 비활성화한다**(GitHub 공식 정책). 이 앱은 현장조사용이라 계절에
  따라 몇 달씩 커밋이 없을 수 있는데, 그런 비활성 기간이 60일을 넘기면
  다음 시즌에 별도로 Actions 탭에서 워크플로우를 다시 켜야 한다 — 코드로
  막을 수 있는 게 아니라 GitHub 플랫폼 정책이므로, 시즌 시작 시 확인하는
  것으로 대응한다(체크리스트에 반영).
- **알림 메시지의 유역(basin) 표기는 그 팀의 완료 건 중 첫 번째 것만
  대표로 보여준다.** 한 폴링 주기 동안 같은 팀이 서로 다른 유역의 포인트를
  동시에 완료하면 괄호 안 유역명이 실제로는 일부만 맞을 수 있다(표시
  정확도 문제일 뿐 알림 자체의 완료 목록·개수는 정확함 — 사소해서 이번
  범위에서 고치지 않는다).
- **상태 파일(`notify-state.json`) 손상 경고는 스팸 방지 장치가 없다.**
  다른 모든 경고(연속 실패 3회 경고 등)는 "성공 시 리셋, 실패 시 1회만
  발송"이라는 원칙을 따르지만, 손상 경고는 의도적으로 상태를 쓰지 않는다
  (손상된 파일을 그대로 보존해 사람이 직접 살펴볼 수 있게 하기 위해) —
  그래서 "이미 발송했다"를 기록할 곳이 구조적으로 없다. 결과적으로 상태
  파일이 손상된 채로 방치되면, 사람이 직접 고칠 때까지 매 10분 cron
  주기마다 이 경고가 계속 반복 발송된다. 이 경우는 반복 발송 자체가
  "빨리 고쳐야 한다"는 신호로 기능하므로 별도 코드 수정 없이 문서화로
  남긴다.
- **ntfy 전송(`sendNtfy`) 자체의 실패는 연속 실패 카운터에 포함되지 않는다.**
  `consecutiveFailures`는 `getTeams`/`getPlots` 같은 데이터 조회 실패만
  추적하고, 완료 알림을 실제로 보내는 `sendNtfy()`의 실패(예: ntfy.sh
  자체 장애)는 별도로 추적하지 않는다. 실질적인 피해는 크지 않다 — 다음
  실행에서 `notifiedPlotNos`가 갱신되지 않았으므로 같은 완료 건을 자연히
  다시 감지해 재발송을 시도한다. 다만 ntfy.sh 장애가 길어지면, 3회
  연속 실패 경고 자체도 같은 ntfy 채널로 나가야 하므로 그 경고조차 못
  받는 사각지대가 생긴다(경고 채널 자체가 알림 채널이라는 구조적 한계 —
  이번 범위에서는 코드로 해결하지 않는다).
- **`git push`가 이 워크플로우와 무관한 이유로 실패할 수 있다(7라운드
  검토에서 발견).** `actions/checkout@v4`는 기본적으로 얕은(depth=1)
  체크아웃을 하는데, 이 워크플로우와 전혀 관계없는 다른 커밋이 같은
  폴링 주기 사이에 `main`에 먼저 들어오면 이 워크플로우의 `git push`가
  non-fast-forward로 실패할 수 있다(§4.8의 동시 실행 경합과는 별개
  원인이며, 재시도 로직은 두지 않는다). 이 경우 이번 실행이 감지한
  완료 건이 상태 파일에 반영되지 못한 채 유실되지만, 다음 정상 실행에서
  같은 완료가 다시 "새로 완료됨"으로 재감지되어 알림이 나가므로 결과는
  "알림 누락"이 아니라 "약간 늦게, 혹은 한 번 더 알림이 감"에 가깝다 —
  이 문서가 전반적으로 선호해 온 실패 방향(누락보다는 중복을 감수)과
  일치하므로 별도 대응 없이 문서화로 남긴다.
- **간헐적으로(연속이 아니게) 실패하는 팀이 하나 있으면, 3회 연속 실패
  경고가 영영 안 울릴 수 있다(8라운드 검토에서 발견).** §5.1의 실패 판정은
  `perTeam` 중 단 한 팀이라도 reject되면 이번 실행 전체를 "실패"로 묶어
  처리한다(§4.7에서 이미 의도적으로 그렇게 설계했다고 밝힌 부분) — 그런데
  만약 특정 팀이 예를 들어 매 서너 번째 실행마다 한 번씩만 실패하는 패턴이면,
  성공이 중간중간 끼어들어 `consecutiveFailures`가 3에 도달하기 전에 계속
  리셋되므로 `FAILURE_ALERT_THRESHOLD`(3회 연속)를 영원히 못 넘긴다. 결과는
  "완전히 멈춤"이 아니라 "그 팀이 실패한 주기마다 다른 모든 팀의 알림도
  덩달아 한 번씩 밀림"이 반복되는 상태인데, 이게 매번 몇 분 지연에 그치는지
  아니면 패턴이 잦아 실질적으로 자주 밀리는지 사용자가 알 방법이 로그를
  직접 보는 것 말고는 없다. 완전 정지가 아니라 지연이 누적되는 것이라
  이 문서가 지금까지 선호해 온 실패 방향(누락보다는 지연·중복 감수)과
  같은 성격의 문제이고, 발생 확률도 팀 하나가 딱 이런 간헐적 패턴으로
  아슬아슬하게 실패해야 하는 좁은 조건이라 이번 범위에서 코드로 해결하지
  않고 문서화로 남긴다(원한다면 "연속 실패"가 아니라 "최근 N회 중 실패
  비율" 기준으로 바꾸는 개선이 가능하나, 그러면 §4.3/§4.7이 정교하게 맞춰둔
  "연속" 기반 로직 전체를 다시 설계해야 해 이번 범위를 벗어난다).

## 7. 체크리스트

- [ ] 사용자: ntfy 앱을 폰에 설치하고, 예측 불가능한 토픽 문자열을 정해
      구독(subscribe)
- [ ] 저장소 Settings → Secrets에 `NTFY_TOPIC`(위에서 정한 토픽 문자열)
      등록
- [ ] **저장소 Settings → Actions → General → Workflow permissions에서
      "Read and write permissions"가 켜져 있는지 확인·설정**(외부 피드백으로
      발견 — 꺼져 있으면 워크플로우의 `permissions: contents: write`
      선언과 무관하게 `git push`가 403으로 실패한다, 5.2절 노트 참고)
- [ ] `scripts/notify-completed-plots.mjs` 추가
- [ ] `.github/workflows/notify-completed-plots.yml` 추가
- [ ] 로컬에서 `NTFY_TOPIC=테스트토픽 node scripts/notify-completed-plots.mjs`로
      최초 실행 시나리오 확인 — 알림 없이 `notify-state.json`만 생성되는지
- [ ] `notify-state.json`의 plotNo 일부를 수동으로 지운 뒤 재실행 →
      그 plotNo에 대해서만 ntfy 알림이 오는지(실제 ntfy 토픽으로 테스트),
      나머지는 조용한지 확인
- [ ] 서버 응답을 인위적으로 실패시켰을 때(예: `MASTER_SCRIPT_URL`을
      일시적으로 잘못된 값으로 바꿔 테스트) `notifiedPlotNos`가 갱신되지
      않고, `consecutiveFailures`만 증가하는지 확인
- [ ] 실패를 3회 연속 인위적으로 재현해 `FAILURE_ALERT_THRESHOLD`를 넘겼을 때
      "⚠️ 조사 완료 알림 시스템 오류" 경고가 정확히 1회만 오는지(4회째도
      또 오지 않는지), 그 다음 성공 1회로 `consecutiveFailures`/
      `failureAlertSent`가 리셋되는지 확인
- [ ] `notify-state.json`을 의도적으로 깨진 JSON으로 만들어 실행 → "최초
      실행"으로 오인해 알림 없이 덮어쓰지 않고, 즉시 손상 경고 ntfy가 1회
      오면서 실행 자체가 실패(비정상 종료)하는지, `notify-state.json`
      내용은 그대로(안 덮어쓰기) 남아있는지 확인
- [ ] **2라운드에서 재현된 회귀의 재발 방지 확인(가장 중요)**: `notify-state.json`이
      없는 상태에서 팀 하나만 실패하도록 만들어 1회 실행(→ 알림 없이
      `baselineEstablished:false`가 유지된 상태로 저장되는지 확인) → 그 다음
      전체 팀을 성공시켜 2회째 실행 → 이때 **기존에 이미 완료돼 있던 모든
      건이 알림으로 쏟아지지 않고**, 알림 없이 `baselineEstablished:true`로
      조용히 기준선만 수립되는지 확인. 그 다음 3회째 실행에서 새로 완료된
      게 있을 때만 정상적으로 알림이 오는지 확인
- [ ] `getTeams` 자체를 인위적으로 실패시켜(예: `MASTER_SCRIPT_URL`의
      쿼리스트링 부분만 깨뜨려 `action` 파라미터가 안 먹게) `recordFailureAndMaybeAlert`가
      호출되는지, `getPlots` 실패 때와 동일하게 `consecutiveFailures`가
      증가하는지 확인(2라운드에서 발견된 사각지대 재발 방지)
- [ ] **`git add` + `git diff --cached` 조합이 실제로 신규 파일의 첫 커밋을
      감지하는지**(서브에이전트가 재현한 결함의 재발 방지) — 로컬에서
      `notify-state.json`이 아예 없는 상태로 스크립트를 처음 실행한 뒤,
      워크플로우와 동일한 커밋 단계 명령을 그대로 실행해 커밋이 실제로
      생성되는지 확인
- [ ] GitHub Actions의 `workflow_dispatch`(수동 실행 버튼)로 실제 저장소에서
      1회 실행해 워크플로우 자체가 정상 동작하는지, `notify-state.json`
      커밋이 정상적으로 올라가는지 확인(바로 위 항목의 최종 확인)
- [ ] `workflow_dispatch`를 짧은 간격으로 두 번 연속 실행해(또는 cron과
      겹치게 유도해) `concurrency` 설정으로 두 번째 실행이 취소되지 않고
      대기했다가 순서대로 도는지 확인(중복 알림·push 충돌 없는지)
- [ ] cron 스케줄이 실제로 주기적으로 도는지(Actions 탭에서 몇 번의 자동
      실행 확인) 며칠 지켜보기
- [ ] (장기) 시즌이 몇 달 쉬고 재개될 때, GitHub의 60일 비활동 자동
      비활성화로 워크플로우가 꺼져있지 않은지 Actions 탭에서 확인하는
      습관 — 코드 체크리스트는 아니지만 운영상 기억해둘 것
- [ ] `git commit`(push는 사용자 승인 후 별도 진행)

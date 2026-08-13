# watermap-app-personal — loaded_plots/cached_teams 안전 파싱, 잔여 이슈 수정 개발지시서 (v5)

## 1. 배경과 목표

`watermap_V100.html`(약 6,800줄 단일 HTML 파일, GitHub Pages로 서빙되는 개인 포크)에서
`loaded_plots`(불러온 조사포인트 캐시)/`cached_teams`(조사팀 목록 캐시)를 다루는 9개
호출 지점이 `JSON.parse()`를 무방비로 호출하고 있어, localStorage 값이나 서버 응답이
손상되면(비배열, `null` 원소, `plotNo` 누락 등) 앱 초기화가 중단되거나 완료 동기화가
조용히 실패하는 문제가 있었다.

이 문제는 커밋 `60281c8`(`fix: loaded_plots/cached_teams 안전 파싱 + 정규화로 통일`)로
수정되어 이미 GitHub Pages에 배포·확인(로컬 파일과 배포본 SHA-256 해시 일치)까지
완료된 상태다.

이 문서는 그 배포 이후 코드 리뷰에서 발견된 이슈들을 정리한 수정 계획이다(v1은 5개
이슈만 다뤘고, v2는 2라운드 리뷰에서 나온 6번째 이슈를 추가, v3는 3라운드 리뷰로
이슈 6을 trim 비교까지 보강, v4는 4라운드 리뷰로 그 trim 비교를 실제 적용까지
일관되게 만들었다. v5는 5라운드 리뷰로 "팀 식별자 trim"을 **소스(이슈 7: `loadPlotPoints()`의
`teamCode` 계산 자체)와 최종 방어(이슈 4: `applyLoadedPlots()` 내부)라는 두 지점으로
중앙화**해서, 이슈 6이 매번 별도 `requestedTeam` 변수를 만들 필요가 없도록 단순화하고,
`loadSettings()`의 `savedTeam` 미trim 문제도 이슈 4로 자동 해결되게 만들었다(v3~v4에서
7절에 "제외"로 남겨뒀던 항목이 실제로는 이슈 4 구현만으로 해결됨). 각 라운드에서
제안됐지만 채택하지 않기로 판단한 항목과 그 근거는 "2. 범위 → 명시적 제외"와 "7. 별도
과제"에 남겨둔다). **아직 구현되지 않았다.**

**목표**: 아래 7개 이슈를 커밋 `60281c8`과 같은 원칙(원본 데이터는 절대 삭제하지 않고,
표시/판단용으로만 정규화한 값을 쓴다)으로 마저 고친다.

## 2. 범위

**포함**: 아래 7개 이슈의 수정. 전부 커밋 `60281c8`이 이미 도입한 헬퍼 함수
(`normalizeLoadedPlots`, `normalizeCachedTeams`, `getLoadedPlotItems`, `findLoadedPlot`,
`getCachedTeams`)를 그대로 재사용하거나 확장하는 범위이며, 새로운 데이터 구조·새로운
localStorage 키를 도입하지 않는다.

**명시적 제외 — 그리고 왜 제외하는지**:

1. 이미 배포된 9개 호출 지점(커밋 `60281c8`)의 재검토·재구현. (이미 검증·배포 완료.)
2. `markPlotDoneInDropdown()`/`syncCompletedPlots()`의 실패 시 토스트 알림 추가. 두
   함수는 이미 각자의 방식으로 실패를 처리한다(`markPlotDoneInDropdown`은
   `{status:'failed', error}`를 반환해 호출부가 판단하게 하고, `syncCompletedPlots`는
   오프라인·실패 시 의도적으로 조용히 넘어가는 백그라운드 동기화다). 이 정책을 바꾸는
   건 별도 논의가 필요하다.
3. **(2라운드 리뷰가 제안, 채택하지 않음) `getLoadedPlotItems()`/`getCachedTeams()`의
   토스트 조건을 "JSON.parse 예외"에서 "`wasArray === false` 또는 `removedCount > 0`"
   까지 넓히는 것.** 이유:
   - `{}`, `[null]`처럼 유효한 JSON이지만 배열이 아니거나 원소가 무효인 경우는 서버가
     주는 정상 응답으로는 발생하지 않는다(서버는 항상 배열을 준다) — devtools 조작
     없이는 사실상 재현되지 않는 조건이다.
   - 더 결정적인 이유: `markPlotDoneInDropdown()`은 **의도적으로** 무효 항목을
     배열에 남겨둔다("원본 보존" 원칙, `watermap_V100.html:5544` 주석 참고). 이 조건을
     토스트 트리거로 쓰면, 정상적으로 동작 중인 상태(무효 항목이 섞여 있지만 유효한
     항목은 다 정상 표시됨)에서도 세션당 1회씩 "손상됐다"는 오탐 경고가 뜬다.
   - `loadPlotPoints()`/`loadTeamList()`는 이미 "정상 응답이 형식상 문제 있음" 케이스를
     각자의 상태창 문구로 처리하고 있어, 넓혀도 실질적 이득이 크지 않다.
   - 결론: v1의 "JSON.parse 예외에서만 토스트" 원칙을 그대로 유지한다.
   - **알려진 잔여 한계(3라운드 리뷰 지적, 문서화만 하고 조치는 안 함)**: `getLoadedPlotItems()`는
     `loadSettings()`, `findLoadedPlot()`(→ `selectCustomPlot()`/`onPlotSelect()`),
     그리고 이슈 1의 `TEAM_CODE` 분기에서도 쓰인다. 이 호출부들에는 `loadPlotPoints()`/
     `loadTeamList()`처럼 "서버 응답 이상"을 보여줄 전용 상태창이 없어서, `{}`나
     `[null]`처럼 valid-JSON-but-wrong-shape인 극히 드문 경우(위에서 설명했듯 devtools
     조작 없이는 사실상 재현되지 않음) 사용자에게 그냥 조용히 빈 목록으로만 보일 수
     있다. 발생 가능성이 낮고 발생해도 데이터 손상이 없어(원본 문자열 보존) 이번
     범위에서 조치하지 않지만, 나중에 이 경로에서 "목록이 이유 없이 비어 보인다"는
     사용자 제보가 실제로 들어오면 재검토한다.
4. **`survey_records` 소비 지점 전수 점검(2라운드 리뷰에서 발견, 채택하지 않고
   별도 과제로 분리).** `getSurveyRecords()`는 최상위 JSON.parse 실패만 방어하고
   배열 내부의 개별 원소(`null` 등)는 검증하지 않는다. 이 취약점은 이번 문서의
   범위(`loaded_plots`/`cached_teams`)를 낸 `onPlotSelect()` 한 곳이 아니라, 실제
   grep으로 확인한 결과 최소 8개 지점에 퍼져 있다:
   ```
   watermap_V100.html:1942   _records.find(r => r.plotNo === plotNo)
   watermap_V100.html:2149   records.find(r => r.id === id)          — loadRecord()
   watermap_V100.html:2955   recs.findIndex(r => r.id === id)         — patchRecord()
   watermap_V100.html:2979   recs.find(r => r.id === recordId)        — freshRecord()
   watermap_V100.html:3708   records.findIndex(r => r.plotNo === plotNo)
   watermap_V100.html:5569   records.find(r => r.plotNo === val)      — onPlotSelect() (이슈 3, 이번 문서에서 수정)
   watermap_V100.html:6368   records.find(r => r.id === id)
   watermap_V100.html:6584   records.find(r => r.id === id)
   ```
   `patchRecord`/`freshRecord`는 업로드 재시도(soil/tree/사진 지문 비교, 낙관적 동시성
   제어)의 핵심 헬퍼라, 잘못 건드리면 그 전체 흐름에 영향을 줄 수 있다. 이번 배치
   (`loaded_plots`/`cached_teams` 안전 파싱, 범위가 명확하고 리스크가 낮음)와 섞기보다
   **별도 지시서로 분리해 그 자체로 검증하는 것을 권장**한다. 이번 문서는 이슈 3에서
   `onPlotSelect()` 한 곳만 수정한다 — 이 함수가 이번 작업의 핵심 효과("포인트 선택 시
   기존 기록 복원")와 직결되기 때문이다.
5. 서버(Google Apps Script) 코드는 건드리지 않는다 — 이 포크는 공유 백엔드의 관리자가
   아니므로 클라이언트 코드만 수정한다(기존 원칙 유지).

## 3. 현재 상태 (전제 조건)

- 현재 커밋: `60281c8` (원격 `origin/main`에 push 완료, GitHub Pages 배포 확인됨).
- 실행 환경: 순수 HTML/JS 파일(빌드 스텝 없음), Vercel/Vite가 아니라 정적 파일을
  그대로 GitHub Pages가 서빙한다. 로컬 검증은 `python3 -m http.server`로 띄워 브라우저
  콘솔에서 직접 함수를 호출하는 방식으로 진행했다.
- 이 파일은 하나의 `<script>` 블록(1612번 줄~6720번 줄) 안에 모든 로직이 있고, 전부
  `function name() {}` 형태의 함수 선언이라 파일 내 정의 순서와 무관하게 서로 호출
  가능하다(호이스팅).
- 이미 구현된 헬퍼(수정 없이 그대로 사용):
  ```js
  // watermap_V100.html:5093-5109
  function normalizeLoadedPlots(list) {
    const wasArray = Array.isArray(list);
    const source = wasArray ? list : [];
    const items = source
      .filter(p =>
        typeof p === 'string' ? p.trim() !== ''
        : (p !== null && typeof p === 'object' && !Array.isArray(p) && typeof p.plotNo === 'string' && p.plotNo.trim() !== '')
      )
      .map(p => typeof p === 'string' ? p.trim() : { ...p, plotNo: p.plotNo.trim() });
    return { items, removedCount: source.length - items.length, wasArray, originalLength: source.length };
  }

  function normalizeCachedTeams(list) {
    const wasArray = Array.isArray(list);
    const source = wasArray ? list : [];
    const items = source.filter(t => typeof t === 'string' && t.trim() !== '').map(t => t.trim());
    return { items, removedCount: source.length - items.length, wasArray, originalLength: source.length };
  }

  function getLoadedPlotItems() {
    let rawPlots;
    try { rawPlots = JSON.parse(localStorage.getItem('loaded_plots') || '[]'); }
    catch (e) { console.warn('loaded_plots 파싱 실패:', e); rawPlots = []; }
    return normalizeLoadedPlots(rawPlots).items;
  }

  function findLoadedPlot(val) {
    const target = typeof val === 'string' ? val.trim() : '';
    if (!target) return null;
    return getLoadedPlotItems().find(p => (typeof p === 'string' ? p : p.plotNo) === target) || null;
  }

  function getCachedTeams() {
    let rawTeams;
    try { rawTeams = JSON.parse(localStorage.getItem('cached_teams') || '[]'); }
    catch (e) { console.warn('cached_teams 파싱 실패:', e); rawTeams = []; }
    return normalizeCachedTeams(rawTeams).items;
  }
  ```
- 이 코드베이스에는 같은 목적의 **기존 확립된 템플릿**이 이미 있다
  (`getSurveyRecords()`, `watermap_V100.html:1780`) — 파싱 예외 시 `console.warn` +
  세션당 1회 토스트를 함께 한다:
  ```js
  let _survey_records_corrupt_warned = false; // watermap_V100.html:1779

  function getSurveyRecords() {
    try {
      const parsed = JSON.parse(localStorage.getItem('survey_records') || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.warn('survey_records 파싱 실패 — 빈 목록으로 대체 (원본 데이터는 localStorage에 남아있음)', e);
      if (!_survey_records_corrupt_warned) {
        _survey_records_corrupt_warned = true;
        showToast('⚠️ 저장된 조사 기록을 불러오는 데 문제가 있습니다 — 관리자에게 문의해주세요', 'error');
      }
      return [];
    }
  }
  ```
  주의: 이 템플릿도 **최상위 JSON.parse 실패만** 방어하고, 배열 안의 개별 원소가
  `null` 등으로 손상된 경우는 방어하지 않는다 — 이슈 3이 `onPlotSelect()` 안에서만
  이 틈을 다룬다(다른 소비 지점은 위 "명시적 제외" 4번 참고).
- `loadPlotPoints()`(`watermap_V100.html:5211` 부근)의 정상 경로(서버 응답 성공)는
  이미 "정상 빈 배열"과 "비정상 응답이 정규화 후 빈 배열이 된 경우"를 구분해서 처리한다
  (커밋 `60281c8`에서 검증 완료). 이슈 6은 이 함수의 **오프라인 `catch` 폴백 경로**에
  남아있던, 성격이 다른 문제를 다룬다.

## 4. 핵심 설계 결정

| # | 위치 | 문제 | 근거(왜 실제로 터지는가) | 수정 방향 |
|---|---|---|---|---|
| 1 | `watermap_V100.html:2364-2365` | `applyLoadedPlots(JSON.parse(saved), TEAM_CODE)` — 무방비 파싱이 남아있는 10번째 호출 지점, 진입 조건 `savedTeam === TEAM_CODE`도 trim 없음 | `const TEAM_CODE = '';`(2303번 줄, 기본 빈 문자열)이라 지금은 `if (TEAM_CODE)` 자체가 거짓이라 실행되지 않는다. 하지만 관리자가 팀별 배포본에 `TEAM_CODE` 값을 채우는 순간 실행 경로가 살아나고, `loaded_plots`가 손상돼 있으면 다시 앱 초기화가 중단된다. `savedTeam`(`localStorage.getItem('loaded_team')`)도 trim 없이 `TEAM_CODE`와 strict 비교되므로, 과거에 공백 포함 값이 저장된 적 있으면 실제로는 같은 팀인데 조건이 거짓이 되어 정상 캐시를 복원하지 못할 수 있다(4라운드 리뷰에서 지적된 "팀 식별자 trim 일관성" 문제의 연장). | `applyLoadedPlots(JSON.parse(saved), TEAM_CODE)` → `applyLoadedPlots(getLoadedPlotItems(), TEAM_CODE)`로 교체하고, 진입 조건도 `(savedTeam \|\| '').trim() === TEAM_CODE.trim()`으로 양쪽 trim. (`getLoadedPlotItems()`가 빈 배열을 반환해도 `applyLoadedPlots([], TEAM_CODE)`가 `loaded_team`을 `TEAM_CODE`로 갱신하는 것은 의도된 동작 — `loadSettings()`가 이미 `applyLoadedPlots(getLoadedPlotItems(), savedTeam)`으로 동일하게 하고 있어 기존 검증된 패턴과 일관됨.) |
| 2 | `getLoadedPlotItems()` / `getCachedTeams()` | 파싱 실패를 `console.warn`에만 남기고 사용자에게 알리지 않음 | `getSurveyRecords()` 템플릿과 불일치. 사용자 입장에서는 포인트/팀 목록이 이유 없이 사라진 것처럼 보인다. | `_survey_records_corrupt_warned`와 동일한 패턴으로, 키별 독립 플래그(`_loaded_plots_corrupt_warned`, `_cached_teams_corrupt_warned`)를 두고 **JSON.parse 예외 시에만** 세션당 1회 토스트(범위를 더 넓히지 않는 이유는 위 "명시적 제외" 3번 참고) |
| 3 | `watermap_V100.html:5569` (`onPlotSelect()`) | `records.find(r => r.plotNo === val)` — `null`/타입 가드 없음, trim 없음 | `getSurveyRecords()`가 최상위 파싱 실패만 막고 개별 원소는 안 거르므로, `survey_records` 배열에 `null` 원소가 하나라도 있으면 `r.plotNo` 접근에서 예외가 난다. 또한 저장된 `plotNo`에 공백이 있으면(정규화된 `val`과) 비교가 실패해 기존 조사 데이터 복원이 조용히 안 된다. | null/타입 가드 + 양쪽 trim 비교로 교체. (같은 취약점이 있는 다른 7개 지점은 별도 과제 — 위 "명시적 제외" 4번 참고.) |
| 4 | `applyLoadedPlots()`(`5271`), `fillTeamDropdowns()`(`5901`) | 두 표시 함수 모두 인자를 그대로 신뢰 — 함수 자체에 최종 방어가 없음. `applyLoadedPlots()`는 `plots`뿐 아니라 `teamCode`도 그대로 `localStorage.setItem('loaded_team', teamCode)`에 씀 | 이슈 1이 실증하듯, call-site 정규화를 빠뜨린 호출부가 미래에 또 생길 수 있다. 표시 함수 진입 시점에 정규화하면 "어떤 호출부가 뭘 넘기든 이 두 함수는 절대 크래시하지 않는다"는 불변식이 생긴다. `teamCode`도 마찬가지 — 이슈 1(TEAM_CODE 분기)·이슈 6(오프라인 폴백)·`loadSettings()` 등 여러 호출부가 각자 다른 경로로 `teamCode`를 만들어 넘기는데, 그중 하나라도 trim을 빠뜨리면 `loaded_team`에 공백이 섞인다(5라운드 리뷰 지적, 채택). | 함수 첫 줄에서 `plots`/`teams`는 `normalizeLoadedPlots`/`normalizeCachedTeams`로, **`teamCode`/`currentVal`은 `(typeof x === 'string' ? x : '').trim()`으로 재정규화**(이미 정규화된 값이 들어와도 idempotent라 안전 — 아래 "알려진 함정" 참고). 이렇게 **한 곳에서 팀 식별자를 정규화하면 이슈 1·6·`loadSettings()`가 각자 넘기는 `teamCode`/`savedTeam`이 공백을 갖고 있어도 최종적으로 `loaded_team`에는 항상 trim된 값만 저장된다** — 호출부마다 개별적으로 trim할 필요가 없어진다(아래 이슈 7 참고, `loadSettings()`의 `savedTeam` 미trim 문제도 이걸로 해결됨). 함수 본문 내에서 `plots`/`teams`를 참조하는 모든 지점(`.length`, `.filter`, `.forEach`, `teams.includes(currentVal)` 등)이 이 재할당 이후의 값을 쓰는지 구현 시 확인 |
| 5 | `markPlotDoneInDropdown()` 마지막 블록 | 배열 검색/저장은 `target`(trim된 값)을 쓰면서, 화면 텍스트 비교·대입은 원래 파라미터 `plotNo`(공백 있을 수 있음)를 그대로 씀 | ```js\nif (display && display.textContent.replace('✓ ','').trim() === plotNo) {\n  display.textContent = '✓ ' + plotNo;\n```  `plotNo`에 공백이 있으면 이 비교가 실패해 방금 완료 처리한 항목의 체크 표시가 화면에 반영되지 않는다(데이터는 정상 저장됐지만 화면만 안 맞음). | `plotNo` → `target`으로 교체(두 곳 모두) |
| 6 | `loadPlotPoints()`의 오프라인 `catch` 폴백 (2라운드 리뷰에서 발견, 3~5라운드 리뷰로 trim 처리 보강·단순화) | 캐시가 "어느 팀 것인지" 확인하지 않고 요청한 팀 이름으로 표시·저장함 | ```js\n} catch(e) {\n  const items = getLoadedPlotItems();\n  if (items.length > 0) {\n    applyLoadedPlots(items, teamCode);\n```  `items`는 "마지막으로 로드에 성공했던 어떤 팀"의 캐시이고 `teamCode`는 "지금 화면에서 요청한" 팀이다. 팀A를 불러온 뒤 팀B로 바꾸고 오프라인 상태에서 재조회하면, 팀A 캐시를 팀B 것처럼 보여줄 뿐 아니라 `applyLoadedPlots` 내부의 `localStorage.setItem('loaded_team', teamCode)`가 그 캐시를 **영구히 팀B 소속으로 재라벨링**한다. 커밋 `60281c8`에서 고친 "정상 빈 배열 시 팀A 캐시가 남아 재현되는 회귀"와 근본적으로 같은 계열의 버그다. | `loaded_team`(레거시 데이터라 여전히 공백 섞여 있을 수 있음)과 `teamCode`(이슈 7로 함수 시작 시점에 이미 trim됨)를 비교해서 일치할 때만 기존 폴백을 쓴다. 불일치하면 "이 팀의 저장된 캐시 없음"으로 안내하고 `applyLoadedPlots`/`setItem`을 호출하지 않는다(팀A 캐시를 건드리지 않음). |
| 7 | `loadPlotPoints()`의 `teamCode` 계산부(`5213`번 줄) (5라운드 리뷰에서 발견) | `(선택값).trim() \|\| localStorage.getItem('team_code') \|\| ''` — fallback 분기에 `.trim()`이 없음 | 이슈 6의 trim 비교를 아무리 정교하게 짜도, **비교 대상인 `teamCode` 자체가 처음부터 공백을 포함한 채로 만들어지면** 무의미하다. 게다가 이 값은 비교·저장에만 쓰이는 게 아니라 `fetch(scriptUrl + '?action=getPlots&team=' + encodeURIComponent(teamCode))`로 **서버 요청 URL에 그대로 들어간다** — 공백이 섞이면 서버 쪽 팀명 매칭이 실패해 정상 온라인 상태에서도 "배정 포인트 없음"으로 오판될 수 있다(이슈 6의 저장 문제보다 영향 범위가 더 넓음). | `teamCode` 계산 자체에서 fallback 분기도 trim: `(botSel2?.value \|\| topSel2?.value \|\| '').trim() \|\| (localStorage.getItem('team_code') \|\| '').trim()`. 이렇게 소스에서 한 번 trim해두면 이슈 6의 비교·`fetch` URL·성공 경로의 `applyLoadedPlots()` 호출까지 전부 자동으로 정규화된 값을 쓰게 된다(이슈 4의 `applyLoadedPlots()` 자체 trim과 이중 방어, idempotent라 안전). |

### 이슈 2 상세 코드

```js
let _loaded_plots_corrupt_warned = false;
let _cached_teams_corrupt_warned = false;

function getLoadedPlotItems() {
  let rawPlots;
  try { rawPlots = JSON.parse(localStorage.getItem('loaded_plots') || '[]'); }
  catch (e) {
    console.warn('loaded_plots 파싱 실패:', e);
    if (!_loaded_plots_corrupt_warned) {
      _loaded_plots_corrupt_warned = true;
      showToast('⚠️ 저장된 조사포인트 목록을 불러오는 데 문제가 있습니다 — 다시 불러오기를 시도해주세요', 'error');
    }
    rawPlots = [];
  }
  return normalizeLoadedPlots(rawPlots).items;
}

function getCachedTeams() {
  let rawTeams;
  try { rawTeams = JSON.parse(localStorage.getItem('cached_teams') || '[]'); }
  catch (e) {
    console.warn('cached_teams 파싱 실패:', e);
    if (!_cached_teams_corrupt_warned) {
      _cached_teams_corrupt_warned = true;
      showToast('⚠️ 저장된 팀 목록을 불러오는 데 문제가 있습니다 — 다시 불러오기를 시도해주세요', 'error');
    }
    rawTeams = [];
  }
  return normalizeCachedTeams(rawTeams).items;
}
```

### 이슈 3 상세 코드

```js
function onPlotSelect(val) {
  const records = getSurveyRecords();
  const _target = typeof val === 'string' ? val.trim() : '';
  const existing = _target
    ? records.find(r => r && typeof r.plotNo === 'string' && r.plotNo.trim() === _target)
    : null;
  ...
```

### 이슈 4 상세 코드

```js
function applyLoadedPlots(plots, teamCode) {
  plots = normalizeLoadedPlots(plots).items; // 표시 함수 진입 시 최종 방어
  teamCode = (typeof teamCode === 'string' ? teamCode : '').trim(); // (5라운드 리뷰 반영) — 이 한 줄로 이슈 1·6·loadSettings()가 넘기는 teamCode/savedTeam이 공백을 갖고 있어도 loaded_team에는 항상 trim된 값만 저장됨
  const sel = document.getElementById('soil-plot-no-select');
  ...
}

function fillTeamDropdowns(teams, currentVal) {
  teams = normalizeCachedTeams(teams).items; // 표시 함수 진입 시 최종 방어
  currentVal = (typeof currentVal === 'string' ? currentVal : '').trim(); // (4라운드 리뷰 반영)
  // teams.includes(currentVal) 비교가 있으므로, teams는 이미 trim된 값인데 currentVal이
  // 공백을 포함하면(예: localStorage.getItem('team_code')가 과거에 trim 없이 저장된 경우)
  // 정상적으로 캐시된 팀인데도 초기 선택값 복원에 실패한다.
  ['setting-team-code-top', 'setting-team-code'].forEach(id => {
  ...
}
```

### 이슈 5 상세 코드

```js
    const display = document.getElementById('custom-plot-display');
    if (display && display.textContent.replace('✓ ','').trim() === target) {
      display.textContent = '✓ ' + target;
      display.style.color = '#2E7D32';
    }
```

### 이슈 6 상세 코드

이슈 7이 `teamCode`를 함수 시작 시점에 이미 trim해두므로, 이 블록은 `loaded_team`
쪽만 trim하면 된다(5라운드 리뷰 반영 — `requestedTeam` 같은 별도 변수를 다시 만들
필요가 없어져 4라운드 판보다 단순해짐):

```js
  } catch(e) {
    const cachedTeam = (localStorage.getItem('loaded_team') || '').trim(); // 레거시 데이터라 공백 가능성 남아있음
    if (cachedTeam && cachedTeam === teamCode) { // teamCode는 이슈 7로 이미 trim된 값
      const items = getLoadedPlotItems();
      if (items.length > 0) {
        applyLoadedPlots(items, teamCode);
        statusMsg.style.cssText = 'background:var(--warning-bg);border-radius:6px;padding:8px 12px;font-size:12px;color:var(--warning);';
        statusMsg.textContent = '오프라인 — 이전에 저장된 ' + items.length + '개 포인트 사용';
      } else {
        statusMsg.style.cssText = 'background:var(--danger-bg);border-radius:6px;padding:8px 12px;font-size:12px;color:var(--danger);';
        statusMsg.textContent = '불러오기 실패. 인터넷 연결 확인 필요';
      }
    } else {
      statusMsg.style.cssText = 'background:var(--warning-bg);border-radius:6px;padding:8px 12px;font-size:12px;color:var(--warning);';
      statusMsg.textContent = '오프라인 — ' + teamCode + ' 팀의 저장된 포인트가 없습니다';
    }
  }
```

**정리(5라운드 리뷰로 확정)**: `teamCode`는 이슈 7(소스에서 trim) 덕분에 이 시점에
이미 정규화돼 있고, `applyLoadedPlots()`는 이슈 4(내부에서 재trim) 덕분에 설령 다른
호출부가 trim을 빠뜨려도 안전하다 — 이 두 겹의 방어 덕분에 이슈 6은 `loaded_team`
(레거시 데이터라 여전히 오염 가능) 하나만 신경 쓰면 된다. 4라운드 판의 `requestedTeam`
변수는 이슈 7·4가 생기면서 더는 필요 없어 제거했다(중복 로직 정리).

### 이슈 7 상세 코드

```js
async function loadPlotPoints() {
  const scriptUrl = localStorage.getItem('script_url') || MASTER_SCRIPT_URL;
  const botSel2   = document.getElementById('setting-team-code');
  const topSel2   = document.getElementById('setting-team-code-top');
  const teamCode  = (botSel2?.value || topSel2?.value || '').trim()
                    || (localStorage.getItem('team_code') || '').trim(); // (5라운드 리뷰 반영)
  ...
```

**중요**: 이 fallback 분기는 이슈 6(로컬 캐시 비교)만이 아니라 **`fetch` URL에
직접 들어가는 값**이기도 하다(`scriptUrl + '?action=getPlots&team=' + encodeURIComponent(teamCode)`)
— 서버가 정확한 문자열 매칭으로 팀을 찾는다면, 공백이 섞인 팀명은 **온라인 상태에서도**
정상 팀인데 "배정 포인트 없음"으로 잘못 응답받을 수 있다. 그래서 이 수정은 이슈
6(오프라인 폴백)보다 영향 범위가 넓다 — 성공 경로에도 영향을 준다.

**(3라운드 리뷰가 제안, 채택하지 않음) "요청 시작 당시의 팀"뿐 아니라 "현재 화면에
선택된 팀"까지 함께 확인하는 것.** 시나리오: 팀A로 `loadPlotPoints()`를 호출해
`fetch`가 대기 중인 사이 사용자가 드롭다운을 팀B로 바꾸면(이 함수는 요청 중 드롭다운을
잠그지 않음), 응답이 실패해 catch에 들어왔을 때 `teamCode`는 여전히 함수 시작 시점에
캡처된 "팀A"다. 이 경우 화면 드롭다운은 팀B를 보여주는데 상태 메시지는 팀A 데이터를
쓴 것처럼 나올 수 있다. **다만 이건 이슈 6이 고치는 문제(다른 팀 캐시를 잘못된 팀
이름으로 영구 재라벨링)와는 성격이 다르다** — `loaded_team`은 여전히 정확히 팀A로
유지된다(팀B로 잘못 덮이지 않으므로 로컬 저장 상태 자체는 오염되지 않는다). **다만
4라운드 리뷰가 정확히 지적했듯 "데이터 손상이 없다"고 단정하면 안 된다** — 화면
드롭다운(팀B 선택 표시)과 상태 메시지(팀A 데이터를 썼다는 문구)가 서로 다른 팀을
가리키는 **UI 불일치**는 실제로 발생한다. 이를 "알려진 UI race"로 명시해둔다: 데이터
자체는 안전하지만 화면 표시가 잠깐 어긋날 수 있다는 뜻이다. 이 "요청 시작 시점 팀
캡처"는 `loadPlotPoints()`의 성공 경로(이미 커밋 `60281c8`로 배포됨)에도 동일하게
존재하는 특성이라, 이슈 6에서만 고치면 오프라인/온라인 경로가 서로 다른 기준을 쓰게
되어 오히려 일관성이 떨어진다. 이 문제를 고치려면 "요청 시작 시점에 드롭다운을
잠그거나, 응답 시점에 드롭다운 현재값과 재대조"하는 별도 설계가 필요하고, 그건
`loadPlotPoints()` 전체(성공 경로 포함)의 동시성 정책을 다시 정하는 더 큰 변경이라
이번 문서 범위를 벗어난다. 실사용 빈도도 낮다(응답을 기다리는 짧은 시간 안에
드롭다운을 바꾸고 재요청도 안 누르는 경우로 한정). **결론: trim 비교까지만
반영하고, 이 UI race는 "알려진 이슈"로 7절에 남겨 별도 과제로 추적한다.**

## 5. 알려진 함정

- **`typeof null === 'object'`**: 이 세션 전체에서 반복적으로 크래시 원인이 됐던
  JS 함정. `p !== null`(또는 `p &&`) 없이 `typeof p === 'object'`만 확인하면 배열
  원소가 `null`일 때 통과해버린다. 이슈 3의 가드(`r && typeof r.plotNo === 'string'`)가
  이 함정을 다시 밟지 않도록 `r &&`를 반드시 먼저 확인한다.
- **이중 정규화의 안전성(이슈 4)**: `normalizeLoadedPlots`/`normalizeCachedTeams`는
  순수 함수이고, 이미 정규화된(trim된 문자열, `plotNo`가 trim된 객체) 값을 다시
  넣어도 필터 조건을 그대로 통과하고 값이 바뀌지 않는다(idempotent) — call-site
  정규화와 함수 자체 정규화를 동시에 적용해도 부작용이나 성능 문제가 없다.
- **원본 보존 원칙은 이번에도 유지**: 이슈 1·3·4·6·7은 전부 "표시/조회용 정규화"이거나
  "잘못된 팀에 캐시를 재라벨링하지 않는" 조치이지, `localStorage`에 새로운 방식으로
  덮어쓰는 동작이 아니다. `survey_records`/`loaded_plots`의 원본 문자열은 이번
  수정으로 전혀 건드리지 않는다.
- **토스트 범위(이슈 2)는 의도적으로 좁게 유지**: "JSON.parse 예외"에서만 토스트를
  띄운다. 왜 더 넓히지 않기로 했는지는 "2. 범위 → 명시적 제외 3번"에 근거를 남겼다 —
  요약하면 `markPlotDoneInDropdown()`이 의도적으로 남겨두는 무효 항목까지 "손상"으로
  오탐하게 되기 때문이다.
- **팀 식별자 trim의 최종 구조(이슈 1·4·6·7, 5라운드 리뷰로 정리)**: 소스(이슈 7 —
  `loadPlotPoints()`의 `teamCode` 계산 자체)와 최종 방어(이슈 4 — `applyLoadedPlots()`
  내부)라는 두 지점에서 정규화한다. 이 두 겹의 방어 덕분에:
  - 이슈 6(오프라인 폴백)은 `loaded_team`(레거시라 여전히 오염 가능) 하나만 로컬에서
    trim하면 되고, `teamCode`는 이슈 7 덕분에 이미 깨끗하다.
  - 이슈 1(TEAM_CODE 분기)의 진입 조건(`savedTeam === TEAM_CODE`)은 `loaded_team`과
    admin 상수 `TEAM_CODE`를 비교하는 것이라 이슈 7의 `teamCode` 계산과는 무관한
    독립된 값이므로, 이 비교만은 여전히 자체적으로 양쪽 trim이 필요하다 — 하지만
    비교를 통과한 뒤의 `applyLoadedPlots(getLoadedPlotItems(), TEAM_CODE)` 호출은
    이슈 4의 내부 trim이 있어 `TEAM_CODE` 자체에 공백이 있어도 안전하다.
  - `loadSettings()`의 `applyLoadedPlots(getLoadedPlotItems(), savedTeam)`은 아예
    손대지 않아도 이슈 4의 내부 trim이 자동으로 적용된다(v3~v4에서 "7절 제외 항목"
    으로 남겨뒀던 것이 이슈 4 구현만으로 해소됨).

## 6. 체크리스트

- [ ] 이슈 1: `2365`번 줄 `JSON.parse(saved)` → `getLoadedPlotItems()` 교체 + `2364`번 줄
      `savedTeam === TEAM_CODE` 비교에 양쪽 trim 추가
- [ ] 이슈 2: `_loaded_plots_corrupt_warned`/`_cached_teams_corrupt_warned` 플래그 추가,
      `getLoadedPlotItems()`/`getCachedTeams()`에 세션당 1회 토스트 추가
- [ ] 이슈 3: `onPlotSelect()`의 `records.find(...)`를 null/타입 가드 + trim 비교로 교체
- [ ] 이슈 4: `applyLoadedPlots()`/`fillTeamDropdowns()` 첫 줄에 정규화 추가
      (`plots`/`teams`뿐 아니라 `applyLoadedPlots()`의 `teamCode`, `fillTeamDropdowns()`의
      `currentVal`도 각각 `.trim()`)
- [ ] 이슈 5: `markPlotDoneInDropdown()` 마지막 블록의 `plotNo` → `target` 교체(2곳)
- [ ] 이슈 6: `loadPlotPoints()`의 `catch` 폴백에 `cachedTeam === teamCode`(이슈 7로 이미
      trim된 `teamCode`, `loaded_team`만 로컬에서 trim) 가드 추가
- [ ] 이슈 7: `loadPlotPoints()`의 `teamCode` 계산부(`5213`번 줄)에서 `localStorage.getItem('team_code')`
      fallback 분기에도 `.trim()` 추가
- [ ] 구문 검사: `node -e`로 4개 `<script>` 블록 파싱 확인
- [ ] 회귀 테스트(로컬 `python3 -m http.server` + 브라우저 콘솔):
  - [ ] `TEAM_CODE`를 임시로 채운 상태 + `loaded_plots`를 손상시킨 채 페이지 로드 → 초기화가 멈추지 않는지
  - [ ] `loaded_plots`/`cached_teams`를 손상시켜 `getLoadedPlotItems()`/`getCachedTeams()` 호출 → 세션 중 토스트가 정확히 1회만 뜨는지(같은 세션에서 반복 호출해도 2회째부터는 안 뜨는지)
  - [ ] `markPlotDoneInDropdown()`이 무효 항목을 보존한 상태(`removedCount > 0`인 정상 상태)에서 `getLoadedPlotItems()`를 반복 호출해도 토스트가 뜨지 않는지(이슈 2 범위 결정 검증)
  - [ ] `survey_records = [null, {plotNo:" A-01 ", ...}]` 상태에서 `onPlotSelect(" A-01 ")` 호출 → 예외 없이 기존 기록이 정상 복원되는지
  - [ ] `applyLoadedPlots()`/`fillTeamDropdowns()`에 비정규화 raw 배열(공백·`null` 섞인)을 직접 넘겨도 예외 없이 정상 렌더링되는지
  - [ ] `markPlotDoneInDropdown(' A-01 ')`(공백 포함) 호출 후 `custom-plot-display`에 "✓ A-01" 완료 체크가 정상 반영되는지
  - [ ] **이슈 6 핵심 시나리오**: 팀A 정상 로드 → 팀B로 전환 → `fetch`를 실패하도록 몽키패치 → "포인트 불러오기" 실행 → 팀A 포인트가 팀B 것으로 표시되지 않고, "팀B 저장된 포인트 없음" 안내가 뜨는지, `loaded_team`이 팀A로 유지되는지(팀B로 잘못 덮이지 않는지) 확인
  - [ ] **이슈 7 핵심 시나리오**: `localStorage.setItem('team_code', ' A팀 ')`(공백 포함, 두 드롭다운은 비워둔 상태)로 만든 뒤 "포인트 불러오기" 실행 → `fetch`로 나가는 실제 요청 URL의 `team=` 파라미터가 공백 없는 `A팀`인지 네트워크 로그로 확인(공백 포함으로 나가면 이 수정이 안 된 것)
  - [ ] **이슈 6 trim 시나리오**: 위 상태(`team_code`에 공백)에서 온라인 성공 로드까지 마친 뒤(`loaded_team`이 이제 이슈 4의 내부 trim으로 `'A팀'`(공백 없음)로 저장됨을 먼저 확인) `fetch`를 실패하도록 몽키패치하고 다시 "포인트 불러오기" 실행 → `teamCode`(이슈 7로 trim됨)와 `loaded_team`(공백 없음)이 일치해 정상적으로 캐시 폴백이 동작하는지 확인. **추가로** 이 폴백 이후에도 `localStorage.getItem('loaded_team')`이 계속 공백 없는 값으로 유지되는지 확인 — 이슈 4/7의 이중 방어가 실제로 작동한다는 직접적 증거
  - [ ] **이슈 4 `applyLoadedPlots()` teamCode trim 단독 검증**: devtools 콘솔에서 `applyLoadedPlots([], ' B팀 ')`(공백 포함)을 직접 호출 → `localStorage.getItem('loaded_team')`이 `' B팀 '`이 아니라 `'B팀'`(trim된 값)으로 저장되는지 확인(호출부의 trim 여부와 무관하게 함수 자체가 안전하다는 증거)
  - [ ] **`loadSettings()`가 손대지 않고도 해결됐는지 확인**: devtools로 `localStorage.setItem('loaded_team', ' C팀 ')`(공백 포함), `loaded_plots`에 유효한 데이터를 넣어둔 뒤 페이지를 새로고침 → `loadSettings()`가 `applyLoadedPlots(getLoadedPlotItems(), savedTeam)`을 호출하면서 이슈 4의 내부 trim 덕분에 `loaded_team`이 `'C팀'`(공백 없음)으로 정리되는지 확인 — `loadSettings()` 코드 자체는 이번에 건드리지 않았다는 점이 핵심
  - [ ] 이슈 4 `fillTeamDropdowns()` trim 시나리오: `localStorage.setItem('team_code', ' A팀 ')`(공백 포함) 상태에서 `cached_teams`에 `'A팀'`(공백 없음)이 있을 때 `rebuildTeamDropdown()` 호출 → 드롭다운 초기 선택값이 "— 팀 선택 —"으로 남지 않고 "A팀"으로 정상 복원되는지 확인
  - [ ] 커밋 `60281c8`에서 이미 검증된 시나리오(팀A→팀B 빈 응답→새로고침 시 팀A 미재현 등)가 이번 수정으로 깨지지 않는지 재확인
- [ ] `git commit` (push는 사용자 승인 후 별도 진행)

## 7. 이번 문서에 포함하지 않은 별도 과제 (참고용)

- **`survey_records` 소비 지점 전수 안전화**: 위 "2. 범위 → 명시적 제외 4번"에서
  나열한 7개 지점(`onPlotSelect()` 제외). `patchRecord`/`freshRecord`가 업로드
  재시도 흐름의 핵심이라 별도 지시서로 분리해 독립적으로 검증하는 것을 권장한다.
  필요 시 이 섹션을 기반으로 새 지시서를 만든다.
- **`loadPlotPoints()` 요청 중 팀 전환 UI race(4라운드 리뷰에서 발견, "데이터 손상 없음"
  이라는 최초 표현은 부정확하다는 지적을 받아 "UI race"로 재정의)**: `fetch` 응답을
  기다리는 동안 사용자가 드롭다운의 선택 팀을 바꾸면(이 함수가 요청 중 드롭다운을
  잠그지 않음), 응답이 도착했을 때(성공이든 이슈 6의 오프라인 폴백이든) 화면
  드롭다운의 현재 선택값과 상태 메시지가 서로 다른 팀을 가리킬 수 있다. `loaded_team`
  자체는 요청 시작 시점에 캡처된 팀 이름으로 일관되게 저장되어 오염되지 않지만, 화면
  드롭다운 선택값과 상태 메시지가 서로 다른 팀을 보여주는 **사용자 인터페이스 불일치**는
  실제로 발생할 수 있다. 고치려면 `loadPlotPoints()` 전체(성공 경로 포함)의 요청 중
  드롭다운 잠금 또는 응답 시점 재대조 같은 동시성 정책을 새로 설계해야 해서 이번
  문서 범위를 벗어난다.

**(v3~v4에서 "제외 항목"으로 뒀다가 v5에서 해소된 것)**: `loadSettings()`의
`applyLoadedPlots(getLoadedPlotItems(), savedTeam)`이 `savedTeam`을 trim 없이 넘기는
문제는 별도로 손대지 않았지만, 이슈 4가 `applyLoadedPlots()` 내부에서 `teamCode`를
trim하도록 바뀌면서 **`loadSettings()` 코드를 전혀 건드리지 않고도 자동으로 해결**된다
— 그래서 v5에는 더 이상 "제외 항목"으로 남아있지 않는다(위 "5. 알려진 함정 → 팀
식별자 trim의 최종 구조" 참고).

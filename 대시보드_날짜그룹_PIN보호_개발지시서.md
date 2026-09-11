# watermap-app-personal — 대시보드 UX 개선(날짜별 그룹 표시·PIN 보호) 개발지시서

**상태**: 계획 단계 — 아직 구현 전. 사용자 승인 후 착수.

## 1. 배경과 목표

`dashboard.html`(조사 현황 대시보드)에 이미 구현된 기능(전체 현황, 팀별 유역·주차 집계, 카카오맵 위치 표시, 완료일 표시)을 실제로 써보신 뒤 나온 네 가지 개선 요청을 반영한다:

1. `watermap_V100.html` 설정 탭 하단의 "팀별 누적 현황" 카드 — 헤더의 "경호버전" 배지와 똑같이 대시보드로 가는 링크 하나뿐인 카드라 중복. 제거.
2. 대시보드 PIN(`7119`)이 `dashboard.html` 소스에 평문으로 있어 페이지 소스만 봐도 바로 보임. 완벽한 차단은（클라이언트 전용 코드라 원리적으로 불가능하지만, 최소한 "코드를 열자마자 바로 보이는" 수준은 없애고 싶음.
3. 마커를 클릭해서 하나씩 보는 대신, **완료일이 같은 포인트들을 한 번에 모아서 보고 싶음** — 지도 카드 헤더("← 팀 목록으로" ↔ 팀명) 사이에 날짜 선택 드롭다운을 두고, 선택하면 그 날짜에 완료된 포인트들의 정보창이 전부 동시에 열림.
4. 지도의 빈 배경(마커가 아닌 곳)을 클릭하면 열려 있는 정보창을 전부 닫아서, 정보창에 가려지지 않고 전체 포인트의 위치 분포를 한눈에 볼 수 있게 함.

## 2. 범위

**포함**:
- `watermap_V100.html`: "팀별 누적 현황" 카드 블록 제거(HTML만, 이미 이 카드에 연결된 JS 함수는 지난 라운드에 정리되어 남아있지 않음 — 재확인 후 제거).
- `dashboard.html`:
  - PIN을 평문 대신 해시로 비교하도록 변경.
  - 완료일 조회 시점을 "마커 클릭 시 지연 조회"에서 "지도를 열 때 전체 완료 포인트를 한꺼번에 미리 조회"로 변경(날짜별 그룹을 만들려면 전체 날짜를 먼저 알아야 하므로).
  - 지도 카드 헤더에 날짜 선택 드롭다운 추가, 선택 시 해당 날짜 포인트들의 정보창을 동시에 표시.
  - 지도 빈 배경 클릭 시 열린 정보창 전체 닫기.
  - 위 두 가지(동시에 여러 정보창 열기 / 전체 닫기)를 위해 `currentInfoWindow`(단일) 상태를 `openInfoWindows`(배열)로 리팩토링.
  - 미완료 포인트 마커 색상을 회색(`#8B8B85`)에서 빨간색으로 변경(완료 마커 색상은 그대로 유지).

**포함하지 않음**:
- 서버(Apps Script) 코드 변경 — 여전히 공유 백엔드는 건드리지 않는다는 원칙 유지.
- 날짜 선택 시 지도 시점(중심·줌)을 선택된 포인트들에 맞춰 자동 재조정하는 기능 — 사용자가 요청하지 않았으므로 이번 범위에 넣지 않는다(필요하면 후속 요청으로).

## 3. 설계

### 3.1 "팀별 누적 현황" 카드 제거 (`watermap_V100.html`)

현재 설정 탭 맨 아래에 있는 다음 블록 전체를 삭제한다:

```html
<!-- 팀별 누적 현황 → 지도 대시보드로 통합(유역·주차별 집계 포함) -->
<div class="card" style="margin-bottom:14px;">
  <div class="card-header">
    <span class="card-header-icon">📊</span>
    <h2>팀별 누적 현황</h2>
  </div>
  <div class="card-body">
    ...
    <a href="dashboard.html" ...>📍 지도 대시보드 열기</a>
  </div>
</div>
```

이 카드는 이미 "대시보드로 가는 버튼" 기능만 남아 있고, 헤더의 "경호버전" 배지가 같은 링크를 이미 제공한다. 삭제해도 다른 곳에서 이 블록의 id나 함수를 참조하지 않는지(예: `card-header-icon` 클래스는 다른 카드에서도 공용으로 쓰이므로 클래스 자체는 그대로 둠, 이 카드의 내용만 제거) 확인 후 진행한다.

### 3.2 PIN 보호 — 해시 비교로 변경 (`dashboard.html`)

**현재**:
```js
const DASHBOARD_PIN = '7119';
function checkPin() {
  const input = document.getElementById('pin-input');
  if (input.value === DASHBOARD_PIN) { ... }
}
```

**바꿀 방식**: PIN 원문 대신 SHA-256 해시값만 소스에 남기고, 입력값을 같은 방식으로 해시해서 비교한다. 브라우저 내장 `crypto.subtle.digest`(Web Crypto API, 모든 최신 브라우저·iOS Safari 지원, 외부 라이브러리 불필요)를 쓴다.

```js
// PIN '7119'의 SHA-256 해시값만 저장한다 — 소스를 그대로 읽어서는
// 원래 PIN을 알 수 없다(단, 4자리 숫자라 브라우저 콘솔에서 0000~9999를
// 전부 해시해보는 무차별 대입은 여전히 가능하다 — 클라이언트 전용 코드의
// 근본적 한계이며, "코드를 읽자마자 바로 보이는" 문제만 해소한다).
const DASHBOARD_PIN_HASH = '<7119의 SHA-256 해시, 실제 구현 시 계산해서 채움>';

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function checkPin() {
  const input = document.getElementById('pin-input');
  const error = document.getElementById('pin-error');
  const inputHash = await sha256Hex(input.value);
  if (inputHash === DASHBOARD_PIN_HASH) {
    ...(기존과 동일)
  } else {
    ...(기존과 동일)
  }
}
```

`checkPin()`이 이미 `onclick="checkPin()"`으로 호출되므로, 함수가 `async`로 바뀌어도 호출부 수정은 필요 없다(Promise를 기다리지 않고 그냥 실행되던 게 이제 비동기로 실행될 뿐, UI 흐름상 문제없음 — 해시 계산은 수 ms 이내로 사용자가 체감하지 못함).

**한계(사용자께 이미 안내드린 내용, 계획서에도 명시)**: 이 방식은 "소스를 열자마자 평문으로 보이는" 문제만 해소한다. PIN이 4자리 숫자(10000가지)뿐이라, 마음만 먹으면 브라우저 콘솔에서 0000~9999를 전부 해시해 대조하는 무차별 대입으로 몇 초 안에 원래 PIN을 알아낼 수 있다. 진짜 보안이 필요하면 서버 측 검증이 있어야 하는데, 이는 공유 백엔드를 건드려야 해서 범위 밖이다.

### 3.3 완료일 사전 로딩 + 날짜별 그룹 표시 (`dashboard.html`)

#### 3.3.1 조회 시점 변경 + 조회 실패 시 표시 문구 수정

현재 `openMap()`은 마커를 그린 뒤, 완료된 포인트에 한해 **클릭 시점에** `fetchCompletionDate()`를 호출해 정보창 내용을 나중에 채운다. 날짜별 그룹 드롭다운을 만들려면 그 팀의 **모든** 완료 포인트의 완료일을 먼저 알아야 하므로, 조회 시점을 "지도를 여는 시점"으로 앞당긴다.

**1차 검토에서 지적된 문제(반영 완료)**: 정렬 가능한 날짜를 얻으려면 표시용 라벨("9/10(목)") 문자열만이 아니라 정렬용 원본 값도 함께 들고 있어야 한다(3.3.2 참고). 그래서 `fetchCompletionDate`가 라벨 하나만 반환하던 것을, `{ label, isoDate }` 형태로 반환하도록 바꾼다.

```js
// fetchCompletionDate() 반환 형태 변경: 라벨 문자열 → { label, isoDate } 객체
// (기존 구현은 formatKoreanDate(data.soilRow[3])만 반환했다 — 이제 원본
// soilRow[3](ISO 문자열)도 함께 반환해 정렬에 쓴다.)
async function fetchCompletionDate(scriptUrl, plotNo) {
  try {
    const data = await fetchJson(scriptUrl + '?action=getSurveyData&plotNo=' + encodeURIComponent(plotNo));
    if (!data || !Array.isArray(data.soilRow)) return null;
    const isoDate = data.soilRow[3];
    const label = formatKoreanDate(isoDate);
    return label ? { label, isoDate } : null;
  } catch (e) {
    return null;
  }
}

// openMap() 안, 마커를 그리기 전에 완료 포인트 전체의 완료일을 먼저 모은다.
const scriptUrl = getScriptUrl();
const donePoints = located.filter(({ plot }) => isDone(plot));
const dateResults = await Promise.allSettled(
  donePoints.map(({ plot }) => fetchCompletionDate(scriptUrl, plot.plotNo))
);
// plotNo -> { label, isoDate } 맵. 조회 실패(reject)했거나 조사일이 없는
// 포인트는 이 맵에 아예 안 들어간다 — buildInfoContent가 이 경우를
// "조회 중..."이 아니라 "날짜 정보 없음"으로 구분해서 보여준다(아래 참고).
const completionInfoByPlotNo = {};
donePoints.forEach(({ plot }, i) => {
  const r = dateResults[i];
  if (r.status === 'fulfilled' && r.value) completionInfoByPlotNo[plot.plotNo] = r.value;
});
```

이 조회가 끝날 때까지 지도를 그리지 않고 기다린다(사용자 확인: "지도가 뜨는 데 시간이 걸려도 좋다"). 로딩 중임을 알 수 있도록 지도 영역에 간단한 로딩 표시를 유지한다(`loading-note` 재사용 또는 지도 카드 안에 별도 스피너 텍스트).

**`buildInfoContent`도 함께 수정한다** — 지금은 완료일이 없으면 무조건 "조회 중..."을 보여주는데, 사전 로딩 방식으로 바뀌면 그 시점 이후로 다시 채워주는 콜백이 없으므로 조회에 실패한 포인트는 영원히 "조회 중..."이라는 거짓 문구가 고정된다(1차 검토 지적 사항). "조회 중..."을 완전히 없애고, 완료일을 못 구한 경우 날짜 부분 자체를 생략하거나 "날짜 확인 불가"로 표시한다:

```js
// buildInfoContent(plot, pos, done, completionDateLabel) — 세 번째 인자를
// "완료일 라벨(문자열) 또는 null"로 그대로 받되, 호출부에서 로딩 중이라는
// 중간 상태 자체가 없어졌으므로(사전 로딩 완료 후에만 호출), 문구도 그에 맞게 조정.
function buildInfoContent(plot, pos, done, completionDateLabel) {
  const kakaoMapUrl = 'https://map.kakao.com/link/map/'
    + encodeURIComponent(plot.plotNo || '조사지') + ',' + pos.lat + ',' + pos.lng;
  const statusLine = done
    ? '✅ 완료' + (completionDateLabel ? ' · ' + escapeHtml(completionDateLabel) : '')
    : '⏳ 미완료';
  return `<div style="padding:6px 10px;font-size:13px;white-space:nowrap;">
    <b>${escapeHtml(plot.plotNo || '')}</b>
    ${plot.basin ? ' · ' + escapeHtml(plot.basin) : ''}
    <br>${statusLine}
    <br><a href="${kakaoMapUrl}" target="_blank" rel="noopener" style="color:#1D9E75;font-weight:700;">📍 카카오맵 앱에서 보기</a>
  </div>`;
}
```

부수 효과로 좋아지는 점: 지금처럼 "정보창을 열면 '조회 중...'이 잠깐 보였다가 날짜로 바뀌는" 깜빡임이 없어지고, 마커를 클릭하는 순간 바로 완료일이 채워진 정보창이 뜬다(또는 애초에 못 구했으면 처음부터 날짜 없이 뜬다 — 나중에 갑자기 바뀌지 않는다).

#### 3.3.2 날짜별 그룹 데이터 구조 (정렬 가능하도록 수정)

**1차 검토에서 지적된 문제(반영 완료)**: 그룹 키로 포맷된 라벨 문자열("9/10(목)")을 그대로 쓰면, 이 문자열들을 그대로 정렬했을 때 순서가 틀린다(실제로 Node.js로 재현됨 — 예: `["9/10(목)", "9/9(수)", "10/2(금)", "9/30(수)"]`를 문자열로 정렬하면 `10/2(금)`이 맨 앞으로 오고, 같은 9월 안에서도 `9/9`가 `9/30`보다 뒤로 가는 등 완전히 틀어진다). 그룹 키 자체는 여전히 라벨 문자열을 쓰되(같은 날짜는 항상 같은 라벨을 만들어내므로 그룹핑 키로는 문제없음), **정렬은 별도로 보관하는 원본 ISO 날짜로 한다.**

```js
// completionInfoByPlotNo를 날짜 라벨 기준으로 묶는다. 그룹 각각은 표시용
// 라벨(같은 그룹 안에서는 전부 동일)과 정렬용 원본 날짜를 함께 들고 있는다.
const groupsByDate = {}; // { "9/10(목)": { isoDate: "2026-09-09T15:00:00.000Z", items: [ {plot, pos, marker, info}, ... ] } }
```

이 맵은 마커를 실제로 생성하는 루프(각 `located` 항목에 대해 marker/info를 만드는 기존 로직) 안에서, 각 마커의 `plot`/`marker`/`info` 객체를 만든 직후 `completionInfoByPlotNo[plot.plotNo]`가 있으면 그 `label`을 키로 하는 그룹에 push하는 방식으로 채운다:

```js
const info2 = completionInfoByPlotNo[plot.plotNo];
if (info2) {
  if (!groupsByDate[info2.label]) groupsByDate[info2.label] = { isoDate: info2.isoDate, items: [] };
  groupsByDate[info2.label].items.push({ plot, pos, marker, info });
}
```

#### 3.3.3 날짜 선택 드롭다운 UI (정렬 로직 명시)

지도 카드 헤더(`<div class="card-header">← 팀 목록으로 ... 팀명</div>`)에 드롭다운을 추가한다. 사용자가 지정한 위치는 "팀 목록으로 ↔ 팀명 사이"이지만, 팀명이 길 때(예: "박정환,김금섭") 좁은 화면에서 한 줄에 세 요소(뒤로가기·드롭다운·팀명)가 다 들어가면 비좁아질 수 있어, 헤더를 2줄로 나눈다: 첫 줄은 지금처럼 "← 팀 목록으로 / 팀명", 둘째 줄에 날짜 드롭다운을 배치한다. (실제 구현 시 화면 폭을 보며 한 줄이 가능하면 한 줄로, 아니면 이 2줄 배치로 조정 — 최종 레이아웃은 구현 단계에서 실측 후 확정.)

```html
<div class="card-header" style="flex-wrap:wrap;">
  <button class="back-btn" onclick="closeMap()">← 팀 목록으로</button>
  <span id="map-team-title" style="font-weight:800;"></span>
</div>
<div id="date-filter-row" style="padding:8px 16px;border-bottom:1.5px solid var(--gray-border);" hidden>
  <select id="date-filter" style="width:100%;padding:8px 10px;border:1.5px solid var(--gray-border);border-radius:var(--radius-sm);font-size:14px;">
    <option value="">날짜 선택 — 같은 날 완료한 포인트 모아보기</option>
  </select>
</div>
```

`openMap()`이 `groupsByDate`를 다 만든 뒤, 이 `<select>`의 옵션을 채운다. **정렬은 라벨 문자열이 아니라 각 그룹의 `isoDate`를 `Date`로 파싱해 비교한다**(1차 검토에서 지적된 문제 수정):

```js
const sortedLabels = Object.keys(groupsByDate).sort(
  (a, b) => new Date(groupsByDate[a].isoDate) - new Date(groupsByDate[b].isoDate)
);
const dateFilterRow = document.getElementById('date-filter-row');
const dateFilterSelect = document.getElementById('date-filter');
if (sortedLabels.length > 0) {
  dateFilterSelect.innerHTML = '<option value="">날짜 선택 — 같은 날 완료한 포인트 모아보기</option>'
    + sortedLabels.map(label =>
        `<option value="${escapeHtml(label)}">${escapeHtml(label)} · ${groupsByDate[label].items.length}건</option>`
      ).join('');
  dateFilterRow.hidden = false;
} else {
  dateFilterRow.hidden = true; // 그 팀에 완료 포인트(또는 완료일 확인 가능한 포인트)가 하나도 없음
}
```

#### 3.3.4 날짜 선택 시 동작 — 치명적 버그 수정

**1차 검토에서 발견된 치명적 버그**: 원래 안은 `onchange` 핸들러 안에서 `closeAllInfoWindows()`를 먼저 호출한 뒤 `e.target.value`를 읽었는데, `closeAllInfoWindows()`가 드롭다운 값을 `''`로 리셋하는 부수효과를 갖고 있어서 `e.target`(바로 그 `select` 엘리먼트)의 값이 이미 지워진 뒤에 읽히는 구조였다. 그 결과 `dateLabel`이 항상 빈 문자열이 되어 **날짜를 아무리 선택해도 정보창이 절대 열리지 않는** 확정적 버그였다.

**수정**: `closeAllInfoWindows()`에서 드롭다운 리셋 책임을 완전히 분리한다(순수하게 "열린 정보창들만 닫기"만 하도록). 드롭다운을 "날짜 선택" 기본값으로 되돌리는 건 오직 **지도 배경을 클릭했을 때만** 하고(3.4절), 날짜를 바꿔서 선택했을 때는 그 선택값을 그대로 유지한다(사용자가 방금 고른 값이 드롭다운에서 사라지면 안 되므로). 또한 마커를 개별 클릭했을 때도 "지금 열려있는 게 더 이상 날짜 그룹이 아니다"는 걸 드롭다운에 반영하기 위해 리셋한다(3.5절).

```js
document.getElementById('date-filter').onchange = (e) => {
  const dateLabel = e.target.value; // closeAllInfoWindows() 호출보다 먼저 읽는다 — 버그 수정 핵심
  closeAllInfoWindows(); // 이제 이 함수는 드롭다운을 건드리지 않는다(아래 3.4절)
  if (!dateLabel) return; // "날짜 선택" 기본 옵션으로 되돌아가면 전부 닫은 채로 끝
  (groupsByDate[dateLabel]?.items || []).forEach(({ marker, info }) => {
    info.open(currentMap, marker);
    openInfoWindows.push(info);
  });
};
```

마커를 직접 클릭하는 기존 동작(하나만 열기)과 날짜 드롭다운으로 여러 개를 여는 동작이 공존해야 하므로, "현재 열려 있는 정보창"을 단일 변수가 아니라 배열로 관리하도록 바꾼다(3.5절).

### 3.4 지도 빈 배경 클릭 시 정보창 전체 닫기 (`dashboard.html`)

카카오맵 API의 지도 자체 클릭 이벤트를 이용한다. **1차 검토 결과**: 카카오 공식 개발자포럼 답변에 따르면 `clickable:true`(Marker 기본값)인 오버레이를 클릭해도 그 클릭이 지도의 'click' 이벤트로 전파되지는 않는다 — 다만 이 답변은 CustomOverlay를 기준으로 한 것이라 일반 Marker에 대한 명시적 언급은 없었고, **InfoWindow 본문(정보창 안의 텍스트나 링크)을 클릭했을 때 그 클릭이 지도 배경 클릭으로 전파되어 정보창이 열리자마자 닫혀버릴 가능성**은 검증되지 않았다. 이 부분은 실제 구현 후 반드시 수동으로 확인한다(4절 검증 계획에 반영).

```js
// closeAllInfoWindows()는 순수하게 "열린 정보창들을 전부 닫는다"만 한다 —
// 드롭다운 리셋 책임은 이 함수에서 완전히 분리했다(3.3.4절 버그 수정 참고).
function closeAllInfoWindows() {
  openInfoWindows.forEach(info => info.close());
  openInfoWindows = [];
}

function resetDateFilterToDefault() {
  const dateFilter = document.getElementById('date-filter');
  if (dateFilter) dateFilter.value = '';
}

// 지도 배경 클릭 시: 정보창 전체 닫기 + 드롭다운도 "날짜 선택"으로 되돌림
// (드롭다운이 이전 선택을 계속 보여주면서 실제로는 아무것도 안 열려있는
// 상태가 되는 걸 막기 위함).
//
// currentMap을 새로 만드는 시점(팀을 처음 열 때)에 한 번만 리스너를 건다 —
// currentMap을 재사용하는 기존 로직(3.2절 이전에 이미 구현됨)과 맞물려
// 중복 등록되지 않도록 지도를 새로 생성하는 분기에서만 addListener한다.
// (이 조각은 설명용 발췌라 조건문을 생략했다 — 실제 "새로 생성하는 분기 여부" 판별은
// §3.8의 `isNewMap` 플래그로 구현하며, 실제 구현 기준은 §3.8이다.)
kakao.maps.event.addListener(currentMap, 'click', () => {
  closeAllInfoWindows();
  resetDateFilterToDefault();
});
```

### 3.5 상태 관리 리팩토링 — `currentInfoWindow` → `openInfoWindows` 배열

```js
// dashboard.html 417행 — 기존: let currentInfoWindow = null; // 한 번에 하나만 열리도록 — 새 마커 클릭 시 이전 것을 닫는다
// 이 한 줄을 아래 두 줄로 교체한다(openInfoWindows는 이 절, mapLoadToken은 3.9절에서 쓴다).
let openInfoWindows = []; // 지금 지도 위에 열려있는 정보창들(마커 클릭 시 1개, 날짜 선택 시 여러 개)
let mapLoadToken = 0; // openMap() 호출이 겹칠 때 오래된 호출을 무시하기 위한 세대 번호(3.9절)
```

마커 클릭 핸들러도 이 배열을 쓰도록 통일한다. 개별 마커를 클릭하면 "날짜 그룹 선택" 상태는 더 이상 유효하지 않으므로 드롭다운도 함께 리셋한다:

```js
kakao.maps.event.addListener(marker, 'click', () => {
  closeAllInfoWindows(); // 이전에 열려있던 것(단일이든 날짜 그룹이든) 전부 닫고
  resetDateFilterToDefault(); // 개별 마커 클릭이므로 드롭다운도 "날짜 선택"으로
  info.open(currentMap, marker);
  openInfoWindows = [info];
});
```

팀을 전환할 때(`openMap`에서 마커를 지우는 기존 로직)도 `currentInfoWindow = null` 대신 `openInfoWindows = []`로 정리한다.

### 3.6 `openMap()` 마커 루프 전체 교체본 (2차 검토에서 발견된 충돌 해소)

**2차 검토에서 발견된 치명적 문제**: 3.3.1~3.3.4, 3.5는 각각 새로 추가되는 코드만 보여줬을 뿐, `dashboard.html`의 **기존** `openMap()`(634~728행)에 이미 있는 다음 코드를 어떻게 처리할지 명시하지 않았다.

```js
// 기존 706~723행 — 그대로 두면 안 되는 코드
const info = new kakao.maps.InfoWindow({
  content: buildInfoContent(plot, pos, done, null), // 완료일은 아직 모름(로딩 중)
});
kakao.maps.event.addListener(marker, 'click', () => {
  if (currentInfoWindow) currentInfoWindow.close();
  info.open(currentMap, marker);
  currentInfoWindow = info;
});

if (done) {
  fetchCompletionDate(scriptUrl, plot.plotNo).then(dateLabel => {
    if (!dateLabel) return;
    info.setContent(buildInfoContent(plot, pos, done, dateLabel));
  });
}
```

이걸 그대로 둔 채 3.3.1~3.5를 추가만 하면 두 가지가 깨진다: (1) 완료 포인트마다 `getSurveyData`가 사전 로딩 단계와 이 블록에서 **두 번** 호출되고, (2) `fetchCompletionDate`가 이제 문자열 대신 `{label, isoDate}` 객체를 반환하므로 `if (!dateLabel) return;`이 항상 통과해(객체는 truthy) `info.setContent(buildInfoContent(plot, pos, done, dateLabel))`가 객체를 그대로 넘기고, `escapeHtml()`이 이를 문자열화해 정보창에 **"✅ 완료 · [object Object]"**가 찍히는 회귀가 생긴다.

**수정**: 위 기존 블록 전체를 삭제하고, `openMap()`의 마커 생성 루프를 아래 내용으로 교체한다. 이 코드가 3.3.1(사전 로딩 결과 사용)·3.3.2(그룹핑)·3.5(openInfoWindows 배열)를 통합한 마커 루프 부분이다. (3차 검토에서 지적된 대로, `openMap()` 함수 전체 안에서 이 루프가 정확히 어느 줄과 맞물리는지, 그리고 지도 배경 클릭 리스너가 실제로 어디에 삽입되는지는 아래 3.8절의 함수 전체 최종본이 유일한 기준이다 — 이 절의 코드는 설명용 발췌다.)

```js
  const bounds = new kakao.maps.LatLngBounds();
  // scriptUrl은 3.3.1에서 이미 이 함수 앞부분(사전 로딩 단계)으로 옮겨졌으므로 여기서 다시 선언하지 않는다.
  const groupsByDate = {}; // 3.3.2 — { "9/10(목)": { isoDate, items: [...] } }

  located.forEach(({ plot, pos }) => {
    const done = isDone(plot);
    const position = new kakao.maps.LatLng(pos.lat, pos.lng);
    bounds.extend(position);

    const marker = new kakao.maps.Marker({
      position,
      map: currentMap,
      image: getDotMarkerImage(done), // 3.7 — 미완료는 이제 빨간색
    });

    // 완료일은 이미 함수 앞부분에서 전부 조회해뒀으므로(completionInfoByPlotNo),
    // 여기서는 그 결과를 꺼내 쓰기만 한다. 기존처럼 null로 만들고 나중에
    // fetchCompletionDate().then(...)으로 다시 채우는 코드는 완전히 삭제한다.
    const dateInfo = completionInfoByPlotNo[plot.plotNo]; // undefined 가능(미완료 또는 조회 실패)
    const info = new kakao.maps.InfoWindow({
      content: buildInfoContent(plot, pos, done, dateInfo ? dateInfo.label : null),
    });

    // 마커 클릭 — 3.5의 openInfoWindows 배열 버전(기존 currentInfoWindow
    // 단일 변수 버전을 완전히 대체한다. 기존 addListener 블록도 삭제).
    kakao.maps.event.addListener(marker, 'click', () => {
      closeAllInfoWindows();
      resetDateFilterToDefault();
      info.open(currentMap, marker);
      openInfoWindows = [info];
    });

    // 3.3.2 — 날짜 그룹에 등록(완료일을 구한 포인트만)
    if (dateInfo) {
      if (!groupsByDate[dateInfo.label]) groupsByDate[dateInfo.label] = { isoDate: dateInfo.isoDate, items: [] };
      groupsByDate[dateInfo.label].items.push({ plot, pos, marker, info });
    }

    currentMarkers.push(marker);
  });

  currentMap.setBounds(bounds);
  // 이어서 3.3.3의 날짜 드롭다운 채우기 코드(sortedLabels 계산 및 <select> 채우기)가 온다.
```

### 3.7 미완료 포인트 마커 색상을 빨간색으로 변경 (`dashboard.html`)

현재 미완료 마커는 회색(`#8B8B85`)이라 완료 마커(초록 `#1D9E75`)와 구분은 되지만 눈에 잘 띄지 않는다. "전체 포인트가 어디에 산재해 있는지 알고 싶다"는 3절 요청 취지에 맞춰, 미완료 포인트를 더 눈에 띄게 빨간색으로 바꾼다. 완료 마커 색상은 변경하지 않는다.

기존 팔레트에 이미 위험/경고용 빨간색 변수 `--danger: #C0392B;`가 정의되어 있으므로(18~30행 CSS 변수 블록), 새 색상을 하드코딩하지 않고 이 값을 그대로 재사용한다.

```js
// getDotMarkerImage() — pending(미완료) 쪽 색상만 교체
let _doneMarkerImage = null, _pendingMarkerImage = null;
function getDotMarkerImage(done) {
  if (done) {
    if (!_doneMarkerImage) {
      _doneMarkerImage = new kakao.maps.MarkerImage(makeDotSvg('#1D9E75'), new kakao.maps.Size(18, 18), { offset: new kakao.maps.Point(9, 9) });
    }
    return _doneMarkerImage;
  }
  if (!_pendingMarkerImage) {
    // 기존 '#8B8B85'(회색) → '#C0392B'(--danger와 동일한 빨간색)로 변경
    _pendingMarkerImage = new kakao.maps.MarkerImage(makeDotSvg('#C0392B'), new kakao.maps.Size(18, 18), { offset: new kakao.maps.Point(9, 9) });
  }
  return _pendingMarkerImage;
}
```

지도 범례(현재 HTML: `<span class="legend-dot" style="background:#8B8B85;"></span>미완료`, 225~226행 부근)도 실제 마커 색과 일치하도록 함께 바꾼다:

```html
<span><span class="legend-dot" style="background:#1D9E75;"></span>완료</span>
<span><span class="legend-dot" style="background:#C0392B;"></span>미완료</span>
```

색상 하나만 바꾸는 격리된 변경이라 다른 로직(정보창, 날짜 그룹, PIN 등)과 상호작용이 없다. 구현 순서(4절)에서 3.1 카드 제거와 묶어 가장 먼저 처리해도 되는 낮은 위험도의 항목이다.

### 3.8 `openMap()` 전체 함수 최종본 (3차 검토에서 발견된 행 번호 혼선·리스너 위치 누락 해소)

**3차 검토에서 발견된 문제**: 지금까지 §3.3.1·§3.3.2·§3.3.3·§3.3.4·§3.4·§3.5·§3.6이 각자 코드 조각을 보여주면서 서로 다른 행 번호(634~728, 634~726, 694~728, 706~723 등)를 언급해 실제 삭제·교체 범위가 문서 안에서 일관되지 않았다. 또한 §3.4가 정의하는 지도 배경 클릭 리스너를 "지도를 새로 생성하는 분기에서 등록한다"고 말로만 설명했을 뿐, 그 분기(기존 688~691행의 `else { ... }`)에 실제로 삽입된 코드를 보여준 적이 없어 구현 시 빠뜨리기 쉬웠다.

**해결**: 지금까지의 모든 조각(§3.3.1~§3.7)은 설계 의도를 설명하기 위한 참고 자료로 남기고, **실제 구현은 아래의 `openMap()` 전체 함수 하나로 기존 634~729행 전체를 통째로 교체하는 것을 기준으로 삼는다.** 이 함수 밖의 코드(예: 전역 변수 선언부, `closeAllInfoWindows`/`resetDateFilterToDefault`/`getDotMarkerImage`/`buildInfoContent`/`fetchCompletionDate` 등 다른 함수 정의)는 각각 해당 절(§3.3.1, §3.4, §3.5, §3.7)에서 이미 완결된 형태로 제시했으므로 이 절에서 다시 반복하지 않는다.

```js
// dashboard.html 634~729행(기존 openMap() 함수 전체)을 아래 내용으로 통째로 교체.
// myToken/mapLoadToken 가드는 3.9절(팀 전환 응답 경합 방지)에서 온다.
async function openMap(team, plots) {
  const myToken = ++mapLoadToken; // 이 호출만의 "세대" 식별자 — 함수 진입 즉시 발급
  const key = getKakaoKey();
  if (!key) {
    document.getElementById('key-setup').hidden = false;
    document.getElementById('key-setup').scrollIntoView({ behavior: 'smooth' });
    return;
  }

  document.getElementById('map-team-title').textContent = team;
  document.getElementById('map-card').hidden = false;
  document.getElementById('map-card').scrollIntoView({ behavior: 'smooth' });

  try {
    await loadKakaoSdk(key);
  } catch (err) {
    if (myToken !== mapLoadToken) return; // 5차 검토 권고 반영 — 실패한 쪽이 오래된 호출이면 최신 호출의 화면을 덮어쓰지 않는다
    document.getElementById('error-note').textContent = err.message;
    document.getElementById('error-note').hidden = false;
    return;
  }
  if (myToken !== mapLoadToken) return; // 로딩 중 다른 팀이 선택됐으면 여기서 중단(3.9절)

  const located = [];
  let noCoordCount = 0;
  plots.forEach(p => {
    const pos = resolveLatLng(p.x, p.y);
    if (pos) located.push({ plot: p, pos });
    else noCoordCount++;
  });

  const noCoordNote = document.getElementById('no-coord-note');
  if (noCoordCount > 0) {
    noCoordNote.textContent = `📍 위치 정보가 없는 표준지 ${noCoordCount}건은 지도에 표시되지 않습니다.`;
    noCoordNote.hidden = false;
  } else {
    noCoordNote.hidden = true;
  }

  const mapEl = document.getElementById('map');
  if (currentMarkers.length) {
    currentMarkers.forEach(m => m.setMap(null));
    currentMarkers = [];
  }
  // 기존 `currentInfoWindow = null;`을 대체 — 단순히 참조를 버리는 대신
  // 실제로 열려있던 정보창을 닫고 드롭다운도 리셋한다(팀 전환 시 이전 팀의
  // 정보창이 화면에 남아있던 잠재적 결함도 함께 해소).
  closeAllInfoWindows();
  resetDateFilterToDefault();

  if (located.length === 0) {
    currentMap = null; // 다음에 위치가 있는 팀을 열 때 지도를 새로 만들어야 하므로 참조를 버린다
    mapEl.innerHTML = '<div class="loading-note">이 팀의 표준지에는 위치 정보가 없습니다.</div>';
    document.getElementById('date-filter-row').hidden = true; // 이전 팀의 날짜 드롭다운이 남아있지 않도록
    return;
  }

  // §3.3.1 — 마커를 그리기 전에 완료 포인트 전체의 완료일을 먼저 모은다.
  const scriptUrl = getScriptUrl();
  const donePoints = located.filter(({ plot }) => isDone(plot));
  const dateResults = await Promise.allSettled(
    donePoints.map(({ plot }) => fetchCompletionDate(scriptUrl, plot.plotNo))
  );
  const completionInfoByPlotNo = {};
  donePoints.forEach(({ plot }, i) => {
    const r = dateResults[i];
    if (r.status === 'fulfilled' && r.value) completionInfoByPlotNo[plot.plotNo] = r.value;
  });
  if (myToken !== mapLoadToken) return; // 완료일 조회 중 다른 팀이 선택됐으면 여기서 중단(3.9절)

  const center = new kakao.maps.LatLng(located[0].pos.lat, located[0].pos.lng);
  const isNewMap = !currentMap; // 이번에 지도를 새로 만드는지(true) 재사용하는지(false)
  if (currentMap) {
    // 이미 지도가 떠 있으면(팀 전환) 재사용 — 매번 새로 만들면 반복 전환 시
    // 불필요한 재초기화로 저사양 기기에서 끊김이 생긴다.
    currentMap.setCenter(center);
  } else {
    mapEl.innerHTML = ''; // "위치 정보 없음" 안내 텍스트가 남아있을 수 있으므로 비움
    currentMap = new kakao.maps.Map(mapEl, { center, level: 8 });
  }
  if (isNewMap) {
    // §3.4 — 지도를 새로 만드는 분기에서만 등록해 중복 등록을 막는다.
    // currentMap이 재사용되는 한(팀을 계속 전환하는 한) 이 리스너는 한 번만 걸린다.
    kakao.maps.event.addListener(currentMap, 'click', () => {
      closeAllInfoWindows();
      resetDateFilterToDefault();
    });
  }

  const bounds = new kakao.maps.LatLngBounds();
  const groupsByDate = {}; // §3.3.2 — { "9/10(목)": { isoDate, items: [...] } }

  located.forEach(({ plot, pos }) => {
    const done = isDone(plot);
    const position = new kakao.maps.LatLng(pos.lat, pos.lng);
    bounds.extend(position);

    const marker = new kakao.maps.Marker({
      position,
      map: currentMap,
      image: getDotMarkerImage(done), // §3.7 — 미완료는 빨간색
    });

    const dateInfo = completionInfoByPlotNo[plot.plotNo]; // undefined 가능(미완료 또는 조회 실패)
    const info = new kakao.maps.InfoWindow({
      content: buildInfoContent(plot, pos, done, dateInfo ? dateInfo.label : null),
    });

    // §3.5 — openInfoWindows 배열 버전
    kakao.maps.event.addListener(marker, 'click', () => {
      closeAllInfoWindows();
      resetDateFilterToDefault();
      info.open(currentMap, marker);
      openInfoWindows = [info];
    });

    if (dateInfo) {
      if (!groupsByDate[dateInfo.label]) groupsByDate[dateInfo.label] = { isoDate: dateInfo.isoDate, items: [] };
      groupsByDate[dateInfo.label].items.push({ plot, pos, marker, info });
    }

    currentMarkers.push(marker);
  });

  currentMap.setBounds(bounds);

  // §3.3.3 — 날짜 드롭다운 옵션 채우기(isoDate 기준 정렬)
  const sortedLabels = Object.keys(groupsByDate).sort(
    (a, b) => new Date(groupsByDate[a].isoDate) - new Date(groupsByDate[b].isoDate)
  );
  const dateFilterRow = document.getElementById('date-filter-row');
  const dateFilterSelect = document.getElementById('date-filter');
  if (sortedLabels.length > 0) {
    dateFilterSelect.innerHTML = '<option value="">날짜 선택 — 같은 날 완료한 포인트 모아보기</option>'
      + sortedLabels.map(label =>
          `<option value="${escapeHtml(label)}">${escapeHtml(label)} · ${groupsByDate[label].items.length}건</option>`
        ).join('');
    dateFilterRow.hidden = false;
  } else {
    dateFilterRow.hidden = true; // 그 팀에 완료 포인트(또는 완료일 확인 가능한 포인트)가 하나도 없음
  }

  // §3.3.4 — 날짜 선택 시 동작(dateLabel을 closeAllInfoWindows() 호출 전에 먼저 읽는다)
  dateFilterSelect.onchange = (e) => {
    const dateLabel = e.target.value;
    closeAllInfoWindows();
    if (!dateLabel) return;
    (groupsByDate[dateLabel]?.items || []).forEach(({ marker, info }) => {
      info.open(currentMap, marker);
      openInfoWindows.push(info);
    });
  };
}
```

이 최종본이 §3.3.1~§3.7의 모든 조각을 실제 순서·스코프대로 통합한 것이므로, 구현 시에는 이 코드를 기준으로 하고 §4의 회귀 테스트 항목들로 검증한다.

### 3.9 팀 전환 응답 경합(레이스 컨디션) 방지

**4차 검토에서 발견된 문제**: §3.3.1의 완료일 사전 로딩 때문에 `openMap()`이 마커를 그리기 전에 `await Promise.allSettled(...)`(완료 포인트당 API 호출, 최대 10건)로 멈춰있는 구간이 생긴다. 사용자가 이 로딩 중(사용자 본인이 "시간이 걸려도 좋다"고 확인한 바로 그 구간)에 다른 팀을 클릭하면 `openMap()`이 겹쳐 호출되고, **나중에 끝나는 쪽이 먼저 끝난 쪽을 덮어쓴다는 보장이 없다** — 즉 A팀을 클릭한 직후 B팀을 클릭했을 때, A팀 조회가 B팀 조회보다 늦게 끝나면 `map-team-title`은 "B팀"인데 `currentMarkers`·`openInfoWindows`·날짜 드롭다운은 A팀 것으로 남는 뒤섞임이 생길 수 있다. 이 프로젝트에는 과거에도 "조 선택 인덱스 오염 / 정산서 뷰어 응답 경합" 같은 동일 계열 버그가 실제로 있었으므로(커밋 이력 참고) 가볍게 넘길 사안이 아니다.

**해결**: 전역 세대 토큰 `mapLoadToken`(§3.5에서 선언)을 두고, `openMap()`이 호출될 때마다 자신만의 토큰 값(`myToken`)을 발급받는다. 함수 안의 `await` 지점을 통과할 때마다 "그 사이 더 최신 호출이 시작되지 않았는지"(`myToken === mapLoadToken`)를 확인해, 더 최신 호출이 이미 시작됐다면 자신은 오래된 호출이므로 화면을 건드리지 않고 조용히 중단한다. 이렇게 하면 **가장 마지막으로 클릭된 팀의 호출만** 끝까지 실행되어 `currentMap`/`currentMarkers`/드롭다운을 갱신하는 것이 보장된다.

§3.8의 최종본 코드에는 이미 이 가드 두 곳이 반영되어 있다:
1. `myToken = ++mapLoadToken;`을 함수 진입 직후(다른 무엇보다 먼저) 발급한다 — 클릭 순서대로 토큰이 증가해야 "더 최신"을 정확히 판별할 수 있다.
2. `await loadKakaoSdk(key);` 직후 — 카카오 SDK 로딩 중 다른 팀이 선택됐다면 여기서 중단.
3. `await Promise.allSettled(...)`(완료일 사전 조회) 직후 — 이 구간이 가장 오래 걸리므로 가장 중요한 가드.

두 가드 모두 `map-team-title`/`map-card` 표시 같은 가벼운 UI 갱신 이후, `currentMap`/`currentMarkers`/마커 생성/드롭다운처럼 실제 지도 상태를 바꾸는 코드 **이전**에 위치해, 오래된 호출이 최신 호출의 결과를 절대 덮어쓰지 못하게 한다.

## 4. 구현 순서와 검증 계획

작업량이 서로 다른 항목이라 독립적인 커밋 4개로 나눈다. 순서는 의존관계가 적은 것부터:

1. **3.1 카드 제거 + 3.7 마커 색상 변경** — 둘 다 격리된 낮은 위험도 변경이라 한 커밋으로 묶는다. 마커 색상은 완료/미완료 포인트가 섞인 팀 지도를 열어 완료는 그대로(초록), 미완료는 빨간색으로 바뀌었는지, 범례 색상도 마커와 일치하는지 눈으로 확인.
2. **3.2 PIN 해시화** — `DASHBOARD_PIN_HASH` 값을 실제로 `7119`의 SHA-256으로 정확히 계산해 넣어야 하므로, 구현 후 반드시 실제로 `7119`를 입력해 통과하는지, 다른 값은 거부되는지 브라우저로 검증.
3. **3.3 + 3.4 + 3.5 + 3.6 + 3.8 (한 묶음, 서로 얽혀 있어 분리하면 커밋 하나가 반쪽짜리 기능이 됨)** — 실제 구현은 **3.8의 `openMap()` 함수 전체 최종본**으로 기존 함수 전체를 통째로 교체하는 것을 기준으로 한다(개별 절의 코드 조각이 아니라 3.8을 그대로 붙여넣는다). 교체 후 옛 클릭 시점 지연 로딩 블록(`if (done) { fetchCompletionDate(...).then(...) }`)과 옛 `currentInfoWindow` 기반 클릭 핸들러가 파일에 더 이상 존재하지 않는지 diff로 반드시 확인한다:
   - 완료일 사전 로딩으로 바뀐 뒤에도 기존 "마커 클릭 → 완료일 포함 정보창" 동작이 그대로 되는지 확인(회귀 테스트).
   - **정보창에 "[object Object]"나 "조회 중..."이 뜨지 않는지 직접 확인**(2차 검토에서 지적된, 옛 블록이 남아있으면 재현되는 회귀).
   - 완료 포인트가 있는 팀을 열었을 때 네트워크 탭에서 같은 `plotNo`로 `getSurveyData`가 두 번 호출되지 않는지 확인(옛 블록 삭제 여부의 직접적인 증거).
   - 날짜 드롭다운 선택 시 같은 날짜의 포인트 전부가 동시에 열리는지, 다른 날짜로 바꾸면 이전 그룹이 닫히고 새 그룹만 열리는지 확인.
   - 지도 빈 곳 클릭 시 마커 클릭으로 연 것이든 날짜 그룹으로 연 것이든 전부 닫히는지, 그리고 마커를 클릭했을 때 지도 배경 클릭 이벤트가 함께 발동해서 열자마자 닫혀버리는 오류가 없는지 확인(카카오맵 이벤트 버블링 여부를 실제로 검증).
   - **정보창이 열린 상태에서 정보창 본문(포인트 번호 텍스트나 "카카오맵 앱에서 보기" 링크 부분)을 클릭했을 때, 그 클릭이 지도 배경 클릭으로 전파되어 정보창이 곧바로 닫히지 않는지 별도로 확인**(§3.4에서 제기된, 마커 클릭과는 다른 이벤트 경로 — 2차 검토에서 검증 계획 누락이 지적된 항목).
   - 팀을 여러 번 전환해도(예: A팀 → B팀 → A팀) 지도 배경 클릭 시 정보창이 정확히 한 번만 닫히는지 확인(§3.8의 `isNewMap` 분기가 지도 클릭 리스너를 중복 등록하지 않는지 — currentMap이 재사용되는 한 리스너는 최초 1회만 걸려야 한다).
   - **완료 포인트가 있는 팀을 클릭한 직후(완료일 조회가 끝나기 전에) 곧바로 다른 팀을 클릭해본다**(§3.9 레이스 컨디션 검증). 최종적으로 화면 제목·마커·날짜 드롭다운이 전부 마지막에 클릭한 팀 것으로 일치하는지, "제목은 B팀인데 마커는 A팀" 같은 뒤섞임이 없는지 확인. 여러 번(3~5회) 빠르게 반복 클릭해도 일관되게 마지막 팀만 표시되는지 확인.
   - 미완료 포인트만 있는 팀(날짜 그룹이 없는 경우) 드롭다운이 안 보이는지 확인.
   - 완료 포인트가 아주 많은 팀(예: 10개 전부 완료)에서 지도가 열리는 데 걸리는 시간이 실사용에 지장 없는 수준인지 체감 확인(사용자가 "시간이 걸려도 좋다"고 했으나, 극단적으로 느려지진 않는지는 실측).

## 5. 알려진 한계

- **PIN 보호는 완벽한 보안이 아니다.** 4자리 숫자라는 것 자체가 근본적인 약점이고, 클라이언트 전용 코드라는 구조적 한계도 있다. "코드를 읽자마자 바로 안다"는 문제만 해소하는 것이지, 마음먹고 알아내려는 사람을 막지는 못한다.
- **완료일 사전 로딩으로 지도 여는 속도가 느려진다.** 완료 포인트 수만큼(최대 10개) 개별 API 호출이 순차가 아닌 병렬(`Promise.allSettled`)로 나가지만, 그래도 기존보다 지도가 뜨는 시점이 늦어진다. 사용자가 이 트레이드오프를 명시적으로 수용함.
- **지도 시점 자동 조정은 이번 범위에 없다.** 날짜를 선택해 여러 포인트가 강조되어도 지도 중심·줌은 그대로다. 선택된 포인트들이 화면 밖에 있으면 사용자가 직접 스크롤/줌해야 한다.

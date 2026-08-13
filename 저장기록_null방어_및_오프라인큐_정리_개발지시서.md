# watermap-app-personal — survey_records null 방어 + flushOfflineQueue 오류기록 정리 개발지시서 (v2)

**v2 변경 사항**: v1을 Codex에게 교차 검토받은 결과 차단 사유가 나왔다 — "이슈 A의
7곳"이 `survey_records`를 소비하는 지점 전부를 포괄하지 못하고, 최소 11곳을
더 빠뜨렸다는 지적이다(`downloadPhotosAsZip`, `saveData`의 ZIP 판단용 조회,
`deleteMovePhotoSlot`, `deletePhoto`, `autoRetryUpload`의 두 지점,
`updateSendAllBar`/`toggleSelectAll`, `renderRecordsList`, `deleteRecord`의
필터, CSV 내보내기, 그리고 죽은 코드 `flushOfflineQueue`의 forEach까지). 파일
전체에서 `getSurveyRecords()`를 호출하는 지점을 다시 전수 조사(`grep`)해 실제로
**20개 호출부**(함수 정의 자체는 제외)가 있음을 확인했고, 그중 이미 방어된
1곳(`onPlotSelect`, `5842`/`5845`)을 빼면 이번에 처리할 대상은 **19곳**이다.
그 과정에서 "모든 지점에 똑같이 `r &&`만 추가한다"는 v1의 단순한 방식 대신,
**읽기 전용 지점은 함수 진입 시 한 번만 필터링하고, 저장까지 하는 지점은
콜백만 가드한다**는 두 갈래 전략으로 재설계했다(4절 참고) — 후자가 "원본
보존" 원칙과 부딪히기 때문이다.

**v2 재검토(2차) 반영**: 위 개수 재설계 자체(19곳 처리 계획)는 Codex 2차
검토에서 "빠진 호출부 없음"으로 확인됐으나, 문서 안의 표기가 스스로
어긋나 있었다("19개 호출부/18곳", 그룹 2 "14곳") — 실제로는 20개 호출부 중
19곳이 대상이고, 그룹 2(읽기 전용)는 10(단발)+5(다회 진입점)=15곳이다.
전부 정정했다. 또한 `flushOfflineQueue()`(4.4)의 가드가 `if (!r) return`
만으로는 문자열·숫자·배열 같은 **truthy 비객체**를 걸러내지 못한다는
지적을 받아, 4.2와 동일한 수준(`typeof`/`Array.isArray` 포함)으로 강화했다.

## 1. 배경과 목표

(v1과 동일 — 아래 유지)

전체 앱 안정성 점검(2026-08-13)에서 나온 3건 중 1건(선택 라벨 초기화 버그)은
이미 수정·배포 완료했다(`선택포인트_라벨초기화_개발지시서.md`). 나머지 2건을
다룬다.

**이슈 A**는 이 리포 자체의 기존 문서(`loaded_plots_잔여이슈_개발지시서.md`
2절 "명시적 제외 4번", `앱_종합점검_개발지시서.md`의 이슈 C)에서 이미
"별도 지시서로 분리해 독립적으로 검증할 것"으로 지정해둔 항목이다.

**이슈 B**: 죽은 코드 `flushOfflineQueue()`가 업로드 성공을 기록할 때
`soilUploaded`/`treeUploaded`/사진 `uploaded` 플래그는 세우면서, 짝을 이루는
`uploadErrors.soil`/`.tree`/`.photos[filename]`는 지우지 않는다.

## 2. 범위

**포함**:
- **이슈 A**: `survey_records` 소비 지점 19곳(3절 표) 전부에, 각 지점의 성격
  (읽기 전용 vs 저장까지 함)에 맞는 방어를 추가한다.
- **이슈 B**: `flushOfflineQueue()`의 soil/tree/photo 성공 처리 3곳에
  `ensureUploadErrors()`를 통한 오류기록 정리를 추가한다. **이 함수는 이슈
  A의 대상 지점(`3574`)과도 겹친다** — 같은 `forEach` 블록 안에서 두 수정을
  함께 적용한다(4.3 참고).

**명시적 제외**:
- `getSurveyRecords()` 자체를 바꾸지 않는다 — 이유는 v1과 동일(반환 계약을
  모든 호출부에 걸쳐 한 번에 바꾸면 파급 범위가 커진다). **(v2 보강)** 특히
  이 함수 안에서 `null` 원소를 걸러내 반환하면, `patchRecord`/`saveData`/
  `deleteRecord`처럼 그 반환값을 그대로 다시 `localStorage.setItem`하는
  지점들이 **원본에 있던 손상된 원소를 다음 저장 시점에 조용히 지워버리게
  된다** — 이 리포가 반복해서 지켜온 "원본 보존, 표시/판단용으로만 정규화"
  원칙(예: `normalizeLoadedPlots`, `markPlotDoneInDropdown`의 주석)과
  충돌한다. 그래서 이번에도 공유 헬퍼는 손대지 않고 호출부별로 처리한다.
- `flushOfflineQueue()`를 다시 호출되게 만들거나 `upload_queue`를
  재활성화하지 않는다 — 여전히 죽은 코드로 남긴다.
- 서버(Apps Script)·payload·전송 로직은 무관.

## 3. 현재 상태 (전제 조건) — `getSurveyRecords()` 호출부 전수 조사 결과

- 현재 커밋: `2c3d57f`(원격 `origin/main` 기준).
- `grep -n "getSurveyRecords()" watermap_V100.html`로 전수 조사한 결과, 함수
  정의(`1814`) 자체를 빼면 **20개 호출부**가 있다(`1975`, `2110`, `2182`,
  `3028`, `3052`, `3298`, `3489`, `3508`, `3574`, `3788`, `3923`, `4948`,
  `5138`, `5842`, `6447`, `6490`, `6502`, `6713`, `6935`, `6970` — Codex
  2차 검토로 이 목록이 실제 코드와 정확히 일치함을 재확인). 이미 방어된
  `onPlotSelect()`(`5842`/`5845`)를 뺀 **19곳**을 아래 두 그룹으로 나눈다.

  **그룹 1 — 저장까지 하는 지점(4곳)**: 조회 결과를 이용해 `survey_records`
  전체를 다시 `localStorage.setItem`하므로, 조회에서 걸러낸 `null`이 저장 시
  배열에서 사라지면 안 된다. **콜백만 가드하고 배열 자체는 원본 그대로
  써야 한다.**

  | 위치 | 함수 | 콜백 |
  |---|---|---|
  | `3029` | `patchRecord(id, patchFn)` | `.findIndex(r => r.id === id)` |
  | `3789` | `saveData()` | `.findIndex(r => r.plotNo === plotNo)` |
  | `3576`~`3593` | `flushOfflineQueue()`(죽은 코드) | `.forEach((r, idx) => {...})` — 이슈 B와 같은 블록 |
  | `6936`/`6954` | `deleteRecord(id)` | `.find(r => r.id === id)` (조회) + `.filter(r => r.id !== id)` (저장, "삭제 대상만 제거·나머지는 원본 그대로") |

  **그룹 2 — 읽기 전용 지점(15곳 = 단발 조회 10곳 + 다회 사용 진입점 5곳)**:
  조회 결과를 화면 표시·업로드 판단·
  내보내기에만 쓰고 `survey_records`를 다시 쓰지 않는다. **함수 진입
  시점에 한 번 필터링해도 안전하다** — 원본(localStorage)은 건드리지 않고
  그 함수가 이번에 보는 로컬 사본만 정리하는 것이므로 "원본 보존" 원칙과
  충돌하지 않는다.

  | 위치 | 함수 | 처리 방식 |
  |---|---|---|
  | `1975`/`1976` | `restoreDraft(plotNo)` | 단발 조회 → 콜백 가드 |
  | `2110`/`2111` | `downloadPhotosAsZip()` | 단발 조회 → 콜백 가드 |
  | `2182`/`2183` | `loadRecord(id)` | 단발 조회 → 콜백 가드 |
  | `3052`/`3053` | `freshRecord(recordId)` | 단발 조회 → 콜백 가드 |
  | `3489`/`3491` | `autoRetryUpload()` 완료 후 정리 블록 | 단발 조회 → 콜백 가드 |
  | `3508` | `autoRetryUpload()` 완료 후 대시보드 갱신 | 단발 조회(인라인) → 콜백 가드 |
  | `3923`/`3924` | `saveData()`의 ZIP 여부 판단(`recordsH`) | 단발 조회 → 콜백 가드 |
  | `4948`/`4949` | `deleteMovePhotoSlot()` | 단발 조회 → 콜백 가드 |
  | `5138`/`5139` | `deletePhoto()` | 단발 조회 → 콜백 가드 |
  | `6713`/`6714` | `reuploadRecord(id)` | 단발 조회 → 콜백 가드 |
  | `3298` | `autoRetryUpload()` 메인 필터 | **함수 진입 시 필터링**(아래 4.2) — 이 한 줄이 `3299`의 `.filter()`를 통째로 보호 |
  | `6447` | `updateSendAllBar()` | **함수 진입 시 필터링** — `6448`/`6458` 보호 |
  | `6490` | `toggleSelectAll()`의 else 분기 | **함수 진입 시 필터링** — `6491`의 `.forEach()` 보호 |
  | `6502` | `renderRecordsList()` | **함수 진입 시 필터링** — 이 함수 안의 4개 탭(전체/입지토양/임목조사/사진촬영) 렌더링에 쓰이는 모든 `.map()`/`.filter()`를 한 줄로 전부 보호(Codex가 지적한 "6502 이후 각 list.map(r=>...)"이 전부 여기 포함됨) |
  | `6970` | `exportCSV(type)` | **함수 진입 시 필터링** — `6976`(soil `Array.isArray(r.soilRow)` 필터)과 `6984`(tree `flatMap(r => r.treeRows)`) 둘 다 보호 |

  단발 조회 10곳은 원래 v1과 같은 "콜백에 `r &&`만 추가" 패턴, 그룹 2의
  나머지 5곳(`3298`/`6447`/`6490`/`6502`/`6970` — 다회 사용 진입점)은 **그
  함수 안에서 최초에 받은 `records` 지역 변수를 여러 번 재사용하므로, 매
  사용처마다 가드를 반복해 넣는 대신 진입 시점에 한 번만 필터링**하는 게
  더 단순하고 누락 위험도 낮다. **(v2 2차 검토 반영, 표현 정정)** 이
  "한 번만 필터링하면 자동으로 안전하다"는 건 **그 초기 `records` 변수를
  다시 참조하는 곳**에 한정된다 — `autoRetryUpload()`는 본문 후반에
  `getSurveyRecords()`를 두 번 더 별도로 호출하는데(`3489`, `3508`), 이
  둘은 처음의 `records` 변수와 무관한 새 조회라 이 필터링의 보호 범위 밖이다
  (다만 이 두 곳은 4.1의 "단발 조회" 목록에 이미 별도로 포함돼 있어 그
  자체로 방어되므로, 전체 계획상 빠지는 지점은 없다).

## 4. 핵심 설계

### 4.1 그룹 2 — 단발 조회 10곳: 콜백에 `r &&`만 추가 (v1과 동일한 패턴)

```js
// 예시 — restoreDraft() (1976)
const _existingRec2 = _records.find(r => r && r.plotNo === plotNo);

// 예시 — freshRecord() (3053)
return recs.find(r => r && r.id === recordId);

// 예시 — autoRetryUpload() 정리 블록 (3491, 매개변수명이 x)
const r = finalRecordsForCleanup.find(x => x && x.id === rid);
```
나머지(`2111`, `2183`, `3508`, `3924`, `4949`, `5139`, `6714`)도 동일하게
`r &&`(또는 그 지점의 매개변수명)만 추가한다. `typeof` 검사는 넣지 않는다 —
`선택포인트_라벨초기화_개발지시서.md` 4.1에서 이미 확인한 것과 같은 이유
(단순 `===` 비교는 비객체 값이 와도 크래시 없이 `false`를 반환).

### 4.2 그룹 2 — 다회 사용 5개 진입점: 함수 진입 시 한 번만 필터링

```js
// autoRetryUpload() 시작부(3298) — 예시, 나머지 4곳도 같은 한 줄만 바뀜
const records = getSurveyRecords().filter(r => r && typeof r === 'object' && !Array.isArray(r));
```
`normalizeLoadedPlots`/`normalizeCachedTeams`가 이미 쓰던 것과 같은 검증
기준(`p !== null && typeof p === 'object' && !Array.isArray(p)`)을 재사용한다
— 새 검증 규칙을 만들지 않는다. 이 한 줄 변경만으로 그 초기 `records` 변수를
재사용하는 모든 후속 `.filter()`/`.map()`/`.forEach()`/`.flatMap()`이
자동으로 안전해지므로, `3299`, `6448`, `6458`, `6491`, `6976`, `6984`,
그리고 `renderRecordsList()` 내부의 각 탭 렌더링 블록은 **따로 손대지
않는다**. (`autoRetryUpload()`의 `3489`/`3508`은 이 초기 `records`와 무관한
별개의 `getSurveyRecords()` 재호출이라 이 필터링의 보호 범위 밖이며,
4.1의 단발 조회 목록에서 각각 따로 다룬다 — 3절 표 참고.)

### 4.3 그룹 1 — 저장까지 하는 4곳: 콜백만 가드, 저장 배열은 원본 그대로

```js
// patchRecord() (3029)
function patchRecord(id, patchFn) {
  const recs = getSurveyRecords();
  const idx = recs.findIndex(r => r && r.id === id); // 콜백만 가드
  if (idx !== -1) {
    patchFn(recs[idx]);
    localStorage.setItem('survey_records', JSON.stringify(recs)); // recs는 원본 그대로(손상 원소 포함) 저장
  }
  return idx !== -1 ? recs[idx] : null;
}

// saveData() (3789) — findIndex 콜백만 가드, 이후 records[existingIdx]=newRecord / records.push(newRecord) / setItem 로직은 무변경
const existingIdx = records.findIndex(r => r && r.plotNo === plotNo);

// deleteRecord() (6936, 6954)
const target = records.find(r => r && r.id === id);      // 조회
...
const updated = records.filter(r => !r || r.id !== id);   // 저장 — null 원소는 보존, id가 일치하는 것만 제거
```
`deleteRecord()`의 `.filter()`는 v1의 "제거 대상만 걸러낸다"는 목적과
"원본 보존" 원칙이 동시에 걸리는 지점이다 — `r.id !== id`만 쓰면 손상된
`null` 원소가 (누구의 요청도 아니게) 조용히 삭제돼버리므로, `!r ||`를
앞에 붙여 "무효 원소는 무조건 보존, 유효한 원소 중 id가 일치하는 것만
제거"로 명확히 한다.

### 4.4 그룹 1 — `flushOfflineQueue()`: 이슈 A와 이슈 B를 같은 forEach에서 함께 처리

```js
const records = getSurveyRecords();
let changed = false;
records.forEach((r, idx) => {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return; // 이슈 A — null뿐 아니라 문자열·숫자·배열 같은 truthy 비객체도 걸러냄(4.2와 동일 기준). records 자체는 원본 그대로 write-back
  const pn = r.plotNo;
  if (succeededSoil.has(pn))  { records[idx].soilUploaded = true; ensureUploadErrors(records[idx]).soil = null; changed = true; } // 이슈 B
  if (succeededTree.has(pn))  { records[idx].treeUploaded = true; ensureUploadErrors(records[idx]).tree = null; changed = true; } // 이슈 B
  if (succeededPhoto[pn] && records[idx].photoList) {
    records[idx].photoList = records[idx].photoList.map(p =>
      succeededPhoto[pn].has(p.filename) ? { ...p, uploaded: true } : p
    );
    succeededPhoto[pn].forEach(fn => { delete ensureUploadErrors(records[idx]).photos[fn]; }); // 이슈 B
    changed = true;
  }
  // 전체 완료 여부 재계산(기존 그대로)
  const photos = records[idx].photoList || [];
  const allPhotoDone = photos.length === 0 || photos.every(p => p.uploaded);
  const treeHas = r.treeRows && r.treeRows.length > 0;
  records[idx].synced = records[idx].soilUploaded
    && (!treeHas || records[idx].treeUploaded)
    && allPhotoDone;
});
```
`autoRetryUpload()`(`3357`~`3392`)·`reuploadRecord()`(`6739`~`6773`)의
살아있는 성공 처리와 정확히 같은 `ensureUploadErrors(r).soil/tree = null`
패턴이다. 사진은 `finalizePhotoSuccess()`가 쓰는 `delete
ensureUploadErrors(rec).photos[filename]`과 동일한 효과를 낸다 — 다만
Codex가 지적했듯 이 죽은 큐 경로에는 `captureId` 검증이 없어 구현 구조까지
완전히 같지는 않다(그 차이는 "5. 알려진 한계"에 남긴다).

## 5. 알려진 한계 (문서화하고 넘어감)

- **읽기 전용 지점의 필터링은 저장에 영향을 주지 않는다** — 4.2의 5개
  진입점은 그 함수가 화면에 보여주거나 판단에 쓰는 "이번 호출의 로컬
  사본"만 정리하는 것이고, `localStorage`의 `survey_records` 원본은
  전혀 건드리지 않는다. 다음에 `getSurveyRecords()`를 다시 호출하는
  다른 함수는 여전히 손상된 원소를 그대로 보게 된다(의도된 동작 —
  이슈 A는 "손상된 원소를 지운다"가 아니라 "손상된 원소가 있어도
  크래시하지 않는다"가 목표다).
- **이슈 B는 `flushOfflineQueue()`를 다시 쓸 수 있게 만드는 작업이 아니다.**
  `앱_종합점검_개발지시서.md` 7절이 이미 지적한 "재활성화 시 스키마 검증
  필요"는 이번 수정과 별개로 여전히 남아있는 선행 조건이다.
- **`flushOfflineQueue()`의 사진 성공 처리는 살아있는 경로와 구조가
  완전히 같지 않다**(Codex 지적) — `captureId` 재검증이 없다. 이 큐가
  죽은 코드인 동안은 영향이 없지만, 재활성화 검토 시점에 이 차이도
  함께 다뤄야 한다(4.4 참고, 별도 과제로 남김).
- **이번 수정은 이미 손상된 배열을 되돌리지 않는다** — 그룹 1(저장까지
  하는 4곳)도 `null` 원소를 지우지 않고 그대로 보존한다(4.3의 `deleteRecord`
  설명 참고). 손상 자체를 정리하는 건 이번 범위 밖이다.

## 6. 체크리스트

- [x] 그룹 2 단발 조회 10곳에 `r &&`(또는 매개변수명) 가드 추가:
      `1976`, `2111`, `2183`, `3053`, `3491`, `3508`, `3924`, `4949`, `5139`, `6714`
- [x] 그룹 2 다회 사용 5개 진입점(`3298`, `6447`, `6490`, `6502`, `6970`)에
      함수 진입 시 1회 필터링 추가(문자열·숫자·배열 같은 truthy 비객체도 배제)
- [x] 그룹 1 저장 지점 4곳: `3029`/`3789` 콜백 가드, `6936`/`6954`
      (조회 가드 + 저장 시 null 보존 필터), `flushOfflineQueue()`의
      `forEach` 진입부 가드(이슈 B와 같은 블록)
- [x] 이슈 B: `flushOfflineQueue()`의 soil/tree/photo 성공 처리 3곳에
      `ensureUploadErrors()` 정리 추가(4.4, 이슈 A의 forEach 가드와 함께
      한 번에 반영)
- [x] 구문 검사: `node -e`로 4개 `<script>` 블록 파싱 확인 — 통과
- [x] 로컬 브라우저 회귀 테스트(devtools 콘솔):
  - [x] `survey_records = [null, {id:1, plotNo:'A-01', ...}, 'garbage-string']`
        (null과 truthy 비객체를 함께 오염시킨 상태)에서 `loadRecord`/`freshRecord`
        (단발 조회 대표) + `updateSendAllBar`/`toggleSelectAll`/`renderRecordsList`/
        `exportCSV('soil')`/`exportCSV('tree')`(다회 진입점 5곳 전부) 호출 →
        전부 예외 없이 정상 동작 — PASS
  - [x] 같은 상태에서 `patchRecord(1, r => r.soilUploaded = true)` 호출 →
        예외 없이 패치 반영되고, 저장 후 `survey_records`에 `null`과
        `'garbage-string'` 둘 다 그대로 남아있는지 확인 — PASS
  - [x] `deleteRecord(1)`(id 일치, `window.confirm` 임시 오버라이드) 호출 →
        `null`/`'garbage-string'`은 그대로 남고 id=1 레코드만 제거되는지
        확인(4.3의 핵심 시나리오) — PASS
  - [x] `autoRetryUpload()`를 `window.fetch` 임시 오버라이드(성공 응답 목)로
        호출 → 오염 원소 때문에 배치가 중단되지 않고 예외 없이 완료 — PASS
  - [x] 정상 배열(손상 없음)에서 기존 동작 회귀 확인 — `loadRecord(1)`을
        오염 없는 배열로 재현해도 동일하게 동작해, `soil-plot-no` 필드
        미채움 현상이 이번 수정과 무관한 기존 동작임을 확인(이 함수는 단순
        반환값이 아니라 폼을 채우는 용도이며, 그 채움 자체는 이 최소 테스트
        컨텍스트의 사전조건 부족 때문— 이번 가드와는 무관)
  - [ ] 이슈 B: `flushOfflineQueue()`(죽은 코드) 자체의 `upload_queue` 경로는
        재현 설정이 무거워 이번 자동 검증에서는 생략 — 코드 검토(Codex 3라운드
        전부 통과)와 syntax 검사로 충분하다고 판단. 이 큐를 재활성화하는
        시점에 별도로 재검증 필요.
- [ ] `git commit` (push는 사용자 승인 후 별도 진행)

## 7. Codex 교차 검토 결과

### 1차 검토 (v1 대상) — 차단 사유 있음, v2로 갱신

**차단 사유**: "이슈 A의 7곳"이 `survey_records` 소비 지점 전부를 포괄하지
못함 — 최소 11곳(`downloadPhotosAsZip` 2110, `saveData` ZIP 판단 3923,
`deleteMovePhotoSlot` 4948, `deletePhoto` 5138, `autoRetryUpload` 3299/3508,
`updateSendAllBar`/`toggleSelectAll` 6448/6491, `renderRecordsList` 6502
이후 각 map, `deleteRecord`의 필터 6954, CSV 내보내기 6976 및 트리,
`flushOfflineQueue` 3576)를 빠뜨림. → **v2에서 전수 조사(20개 호출부) 후
19곳 전체를 그룹 1/2로 재설계해 반영**(단, 이 개수 자체를 문서에 "19개
호출부/18곳"으로 잘못 적어 2차 검토에서 다시 지적받음 — 아래 2차 검토
결과 참고).

**확인된 사항**: v1의 7곳은 위치·함수·비교 기준이 실제 코드와 일치하고,
그 7곳에 한정하면 "`r &&`만 추가"하는 판단 자체는 맞음(추가 메서드 호출
없이 단순 비교만 하므로). 이슈 B의 soil/tree 처리는 살아있는 경로와
패턴이 일치. 사진 처리도 효과 면에서는 일치하나 `captureId` 검증 부재로
구현 구조까지 완전히 같지는 않음(5절에 알려진 한계로 기록). `flushOfflineQueue()`는
실제로 호출부가 없는 죽은 코드임을 재확인. 단, 이 함수도 `null` 레코드에서
크래시하므로 재활성화 여지를 남긴다면 이슈 A의 방어도 함께 필요(v2의 4.4에
반영 완료).

### 2차 검토 (v2 대상) — 차단 사유 있음, 아래 반영 후 v2 재정정

**차단 사유**:
- 호출부 개수 표기 오류: 정의(`1814`) 제외 실제 호출은 20곳이며, 이미 방어된
  `onPlotSelect()`(`5842`)를 빼면 대상은 19곳 — 문서가 "19개 호출부/18곳"으로
  잘못 적어뒀음. 그룹 2도 "14곳"이 아니라 단발 10곳 + 다회 진입점 5곳 =
  15곳. **처리 계획(19곳 전체)에는 빠진 곳이 없었지만, 표기 자체가 스스로
  어긋났다.** → **반영 완료**(2·3절 개수 정정).
- `flushOfflineQueue()`(4.4)의 `if (!r) return`은 `null`만 막고 문자열·숫자·
  배열 같은 truthy 비객체는 통과시켜, 그 뒤 `ensureUploadErrors()`/속성
  대입으로 이어질 수 있음 — 4.2와 같은 수준(`typeof`/`Array.isArray` 포함)
  으로 강화 필요. → **반영 완료**(4.4 가드 강화).

**확인된 사항**:
- 실제 호출 위치 20곳(`1975`, `2110`, `2182`, `3028`, `3052`, `3298`, `3489`,
  `3508`, `3574`, `3788`, `3923`, `4948`, `5138`, `5842`, `6447`, `6490`,
  `6502`, `6713`, `6935`, `6970`)이 문서가 언급한 호출들과 전부 일치하고,
  개수 정정 외에 빠진 호출부는 없음.
- 그룹 1(`patchRecord`/`saveData`/`flushOfflineQueue`/`deleteRecord`)이
  실제로 `survey_records` 전체를 다시 저장하는 경로라는 분류가 맞고, 그룹 2가
  필터링하는 지역 `records` 배열을 `localStorage`에 다시 쓰는 곳은 없음
  (`autoRetryUpload`/`reuploadRecord`가 이후 `patchRecord()`를 호출해 별도
  최신 배열을 저장할 수는 있지만, 그룹 2의 지역 변수 자체를 저장하는 것은
  아님 — 분리가 정확함).
- 4.2의 4개 진입점(`updateSendAllBar`/`toggleSelectAll`/`renderRecordsList`/
  `exportCSV`)은 필터링 이후 그 지역 `records`를 재할당하거나 다시 조회하지
  않아 "한 번 필터링하면 안전" 주장이 성립. `autoRetryUpload()`만 본문
  후반에 별도 `getSurveyRecords()`를 두 번 더 호출(`3489`, `3508`)하므로
  이 표현을 "초기 `records` 변수의 후속 사용처"로 한정해야 함 → **반영
  완료**(4.2 문단 정정, 3489/3508은 이미 단발 조회로 별도 방어돼 전체
  계획상 빠지는 지점은 없음을 명시).
- `deleteRecord()`의 `records.filter(r => !r || r.id !== id)`는 `null`을
  보존하면서 `id`가 일치하는 정상 레코드만 제거하고, `target` 조회에도
  `r &&`를 넣으면 의도대로 동작함.
- 4.4의 오류기록 정리는 유효 레코드에 대해서는 기존 `synced` 계산을 바꾸지
  않음 — soil/tree 성공 시 오류를 `null`로, 성공 사진 filename의 오류를
  삭제한 뒤 기존과 동일하게 완료 상태를 종합함.

### 3차 검토 (v2 정정본 대상) — `codex exec`로 직접 호출, 차단 사유 없음

**(이번 라운드부터 사용자 중계 없이 `codex exec -C <이 저장소> --sandbox
read-only`로 Claude가 직접 호출·캡처함 — 세션 `019ffb71-5172-7832-aa11-38e7798eee1b`)**

결론: 차단 사유 없음.

- 실제 호출은 정의·주석 제외 20곳이며, 기존 방어된 `onPlotSelect()` 1곳을
  제외한 19곳이 맞음. 그룹 1 4곳 + 그룹 2 15곳도 합계와 표 내용이 일치.
- 4.4 가드와 4.2 필터는 모두 "truthy 객체이면서 배열이 아닌 값"만 통과시키는
  동일 기준. 통과 후 `records[idx]`는 동일 객체이므로 `ensureUploadErrors(records[idx])`
  및 후속 플래그/사진 처리도 정상 레코드 구조에서는 안전.
- 4.2의 범위 한정 설명도 정확함 — `autoRetryUpload()`의 초기 `records`는
  `3298` 이후 본문에만 적용되고, `3489`의 `finalRecordsForCleanup` 및
  `3508`의 인라인 재조회는 별도 `getSurveyRecords()` 호출이므로 4.1에서
  각각 가드해야 한다는 설명과 실제 코드가 일치.

**3라운드(1차/2차/3차) 만에 수렴 — 구현 준비 완료.**

## 8. 구현 및 검증 결과

**구현**: 3~4.4 전부 계획대로 반영 — 19곳(단발 조회 10 + 다회 진입점 5 +
저장 지점 4, `flushOfflineQueue`의 이슈 A/B 통합 1곳 포함) 전체 수정 완료.
호출부 자체의 개수·인자·계약은 무변경 — 각 지점 내부의 콜백/필터 조건만
바뀌었다.

**구문 검사**: `node -e`로 4개 `<script>` 블록 파싱 확인 — 통과.

**로컬 브라우저 실증 검증**(`python3 -m http.server` + devtools 콘솔,
`window.fetch`/`window.confirm` 임시 오버라이드로 실제 서버·확인창 없이 재현):
`null`과 `'garbage-string'`(truthy 비객체)을 함께 오염시킨 배열에서 단발
조회·다회 진입점·저장 지점(`patchRecord`/`deleteRecord`)·`autoRetryUpload()`
전부 예외 없이 동작했고, 저장 지점은 오염 원소를 그대로 보존하면서 대상
레코드만 정확히 처리/제거함을 확인했다(6절 체크리스트 참고). `flushOfflineQueue()`
자체(죽은 코드, `upload_queue` 경로)는 재현 설정이 무거워 이번 자동 검증에서
생략했다 — Codex 3라운드 검토와 syntax 검사로 대체.

`git commit`은 사용자 승인 후 진행.

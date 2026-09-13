# 핵심 시나리오 체크리스트

이 문서는 별도 목 서버 없이, **브라우저 콘솔에서 함수를 임시로 가로채는 방식**으로
재검증할 수 있는 핵심 시나리오 목록이다. `sendToScript`/`uploadPhotoWithRecovery`
같은 전송 로직 자체를 크게 바꾸지 않는 한 이 정도로 충분하고, 실서버(공유 Apps
Script/Sheet/Drive)에는 절대 테스트 데이터를 보내지 않는다.

**용도**: 아래 목록에 나온 함수·경로를 수정할 때, 관련 시나리오만 골라 재검증한다.
전체를 매번 돌릴 필요는 없다.

## 검증 방법 (공통)

- `python3 -m http.server`로 로컬에 띄우고 브라우저 콘솔(devtools)에서 실행한다.
- 실제 IndexedDB 오류·응답 지연은 `idbSet`/`idbGet`/`setTimeout` 같은 전역 함수를
  콘솔에서 임시로 덮어써서 흉내낸다(원본 참조를 저장해뒀다가 테스트 후 복원).
  예: `const orig = idbSet; idbSet = async (...a) => { await new Promise(r=>setTimeout(r,300)); return orig(...a); };`
- `photoData`/`movePhotoData`/`_photoEditSession`처럼 `let`으로 선언된 전역은
  `window.xxx = ...`가 아니라 **bare identifier로 직접 대입**해야 실제로 반영된다.
- 테스트 후에는 덮어쓴 함수를 원래대로 복원하고, `localStorage`/IndexedDB에 넣은
  테스트 데이터를 정리한다.

## 1. 사진 처리 잠금 (handlePhoto / handleMovePhoto / triggerPhotoCamera 등)

- [ ] `_photoProcessing = true`인 상태에서 `triggerPhotoCamera`/`triggerMovePhotoCamera`를
      호출하면 새 촬영을 거부하고(입력 교체 없음) 안내 토스트가 뜬다.
- [ ] `handleMovePhoto`도 `_photoProcessing`이 true면 즉시 return하고, 처리 시작 시
      직접 true로 설정한다(일반 사진과 동일).
- [ ] 내부 안전 타이머는 20000ms로 등록된다(`setTimeout`을 가로채 `capturedDelays`로 확인).
- [ ] 원본(IDB) 저장이 실패하면 성공 토스트 없이 잠금이 풀리고 오류 안내만 뜬다.

## 2. 초기화·조사지 전환 중 처리 경합 (handlePhoto / handleMovePhoto + `_photoEditSession`)

- [ ] `idbSet`을 가로채 원본 저장 도중에만 지연시키고, 그 사이 `_doReset()`을 호출하면:
      - `photoData`/`movePhotoData`에 그 결과가 반영되지 않는다
      - 방금 쓴 원본(`idbOrigKey`/`idbMoveOrigKey`)이 삭제되어 고아로 안 남는다
      - `_photoProcessing`이 풀려 있다(멈춰있지 않음)
- [ ] `onPlotSelect()`도 내부적으로 `_doReset()`을 호출하므로 위와 동일하게 확인된다.

## 3. 완료 판정 (autoRetryUpload / reuploadRecord)

- [ ] `finalizePhotoSuccess`가 다른 탭 경합 등으로 확정하지 못해도(반환값 false),
      최신 레코드를 다시 읽는 `photosAllDone` 체크 덕분에 완료로 잘못 집계되지 않는다.
- [ ] `uploadPhotoWithRecovery`가 `{cooldown:true}`/`{stale:true}`를 반환하면
      실패로도 성공으로도 집계하지 않는다.

## 4. 보조 사진 캐시 정리 범위 (reuploadRecord / autoRetryUpload / onPlotSelect)

- [ ] A 조사지 슬롯과 B 조사지 슬롯을 전역 캐시(`photo_N`/`move_photo_N`)에 함께
      채워두고, A만 재업로드 성공(또는 A→B 전환)시키면 A가 쓰던 슬롯만 지워지고
      B의 캐시는 그대로 남아있다(`idbGet`으로 직접 확인).

## 5. 이동사진 복원 (buildMovePhotoGrid)

- [ ] 원본(`idbMoveOrigKey`)만 있고 전역 보조 캐시(`move_photo_N`)가 없어도 정상 표시된다
      (이미 업로드돼 보조 캐시가 정리된 경우를 흉내냄).
- [ ] 썸네일과 원본이 둘 다 있으면 썸네일이 우선 사용된다.
- [ ] 원본·썸네일이 둘 다 없으면 오래된 전역 캐시로 잘못 채우지 않고 콘솔 경고만 남긴 채
      빈 슬롯을 유지한다.

## 6. CSV 내보내기 (exportCSV / csvSafeCell)

- [ ] 값에 큰따옴표가 포함돼도 `""`로 이스케이프되어 CSV 형식이 안 깨진다.
- [ ] `=`/`+`/`-`/`@`로 시작하는 값은 앞에 `'`가 붙어 Excel에서 수식으로 해석되지 않는다.
- [ ] `soilRow`가 없는 손상된 레코드가 섞여 있어도 예외 없이 그 레코드만 건너뛰고
      몇 건 제외됐는지 토스트로 안내한다.

## 7. 레코드 삭제 (deleteRecord) / ZIP 백업 (downloadPhotosAsZip)

- [ ] 레코드 삭제 시 원본뿐 아니라 썸네일·뷰어 캐시(4종류 × 슬롯 수)까지 전부 정리된다.
- [ ] `downloadPhotosAsZip(plotNo, onlyNew=true)`는 원본(`idbOrigKey`)이 있는 사진만
      포함하고, 보조 캐시로만 남은(이미 업로드된) 사진은 포함하지 않는다.
- [ ] `onlyNew=false`는 원본 + 보조 캐시 폴백 모두 포함한다(최초 업로드용 전체 백업).

## 8. XSS / 데이터 이스케이프

- [ ] 팀명·포인트 목록(`applyLoadedPlots`)·조사지번호(`updatePhotoNames`,
      `renderRecordsList`)에 `<img src=x onerror=...>` 같은 값을 넣어도 태그로
      해석되지 않고 문자 그대로 표시된다.
- [ ] `buildCustomPlotList`처럼 `onclick="fn('${값}')"` 형태로 값을 넣는 곳이 새로
      생기면, `escapeHtml()`만으로는 안전하지 않다 — 인라인 이벤트 핸들러 속성은
      HTML 파서가 엔티티를 디코딩한 최종 문자열이 그대로 실행되는 JS 소스가 되므로,
      **반드시 DOM 생성 + `addEventListener`로 작성**한다(문자열 조립 금지).

## 9. survey_records 파싱 방어 (getSurveyRecords)

- [ ] `localStorage.setItem('survey_records', '손상된 값')` 상태에서
      `renderRecordsList()` 등을 호출해도 예외 없이 빈 목록으로 동작하고,
      원본 문자열은 지워지지 않는다(복구 가능성 유지).

## 10. 미완료 작업(draft) 안전장치 — 1~8겹

상세 설계·전체 검증 항목은 `미완료작업_안전장치_개발지시서.md` §4·§6 참고. 여기는
관련 함수를 건드릴 때 최소로 재확인할 핵심만 추린 것이다.

**5겹 — 레코드↔draft 우선순위 (`onPlotSelect`, `trashDraft`, `chooseDraftSource`)**
- [ ] 정식 레코드보다 최신인 draft가 있는 포인트를 열면 `confirm()` 선택지가 뜨고,
      "작성 중이던 것"을 골라도 **조사일은 레코드 값을 유지**한다(hidden·화면 표시 둘 다).
- [ ] "저장된 내용"을 고르면 탈락한 draft가 `survey_trashed_draft_<번호>`에 **정확히**
      보관되고(값으로 확인), 그 상태로 다른 포인트로 이동해도 메아리(레코드 내용이
      draft로 재저장되는 것)가 생기지 않는다.
- [ ] `_recordEchoGuard`가 걸린 상태에서 빠른선택 버튼·숫자 선택 시트로 값을 바꾸면
      (합성 `change` 이벤트) 1초 뒤 정상적으로 draft가 저장된다 — `isTrusted` 체크가
      아니라 필드 범위(`#tab-soil`/`#tab-tree`)로 판정하므로 막히면 안 된다.

**2겹-B — IndexedDB 미러 (`mirrorDraftToIDB`, `tombstoneDraftInIDB`, `mergeDraftMirrors`)**
- [ ] `saveDraft()` 후 `localStorage.getItem('survey_draft_<번호>')`와
      `await idbGet('draft_<번호>')`가 **완전히 동일**하다.
- [ ] `clearDraft()` / 1겹 목록의 "작성 취소" / `trashDraft()` 세 삭제 경로 모두
      미러가 `idbDelete`가 아니라 **묘비(`{_deletedAt}`)**로 바뀐다 — 지운 뒤
      `await mergeDraftMirrors()`를 다시 불러도(재기동 흉내) 되살아나지 않는다.
- [ ] localStorage만 지운 draft는 `mergeDraftMirrors()` 한 번으로 다시 채워지고
      (승격), 1겹 목록에도 나타난다.
- [ ] `openIDB`를 강제로 reject시켜도 `mergeDraftMirrors()`가 예외 없이 끝난다
      (기동이 IDB에 묶이지 않는지 — `req.onblocked` 포함).

**8겹 — 내보내기/가져오기 (`exportDrafts`, `importDraftsFromFile`, `applyImportSelection`)**
- [ ] `typeof JSZip === 'undefined'`로 만들어도 `exportDrafts(false)`(텍스트만)는
      정상 동작하고, `exportDrafts(true)`(사진 포함)만 차단된다.
- [ ] 이 앱에서 만들지 않은 JSON/zip을 가져오면 **아무 것도 바뀌지 않고** 거부된다.
- [ ] 사진 포함 zip을 왕복(내보내기→가져오기)했을 때 **일반사진 0~3번 슬롯이 이동사진으로
      바뀌지 않는다**(`resolvePhotoSlot` 직접 조립 금지 — 가장 재발하기 쉬운 실수).
- [ ] `_default`(번호 없는 draft)를 가져오면 실제 `survey_draft__default`는 건드리지
      않고 `survey_draft__imported_<...>` 별도 키로 들어와 1겹 목록에 보인다.
- [ ] 레코드가 있는 번호를 가져오면 `_savedAt`이 가져온 시각으로 갱신돼(`_importedSavedAt`에
      원본 보존) 5겹 선택 화면이 정상적으로 뜬다(내보낸 기기의 오래된 시계값 때문에
      묻히지 않는지가 핵심).

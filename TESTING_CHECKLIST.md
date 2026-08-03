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

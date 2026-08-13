# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

"물지도 전자야장" — 산림 현장조사(입지·토양·임목·사진)를 기록하고 Google Apps Script 웹앱을 통해 공유 Google Sheets/Drive로 전송하는 PWA. **이 저장소는 팀(~10명)이 함께 쓰는 원본 앱을 노경호(bimil2ya)님이 개인적으로 더 안정적으로 쓰기 위해 포크한 것**이다. 배경·소유권 경계·라이선스는 [CONTRIBUTIONS.md](CONTRIBUTIONS.md)와 [LICENSE.md](LICENSE.md)에 있음 — 특히 CONTRIBUTIONS.md는 첫 커밋부터 지금까지의 변경사항을 커밋 해시로 나열해 "원본과 본인 수정분"의 법적 경계를 만드는 문서이므로, 그 목록에 없는 종류의 대규모 변경(예: 커밋 재작성, `ownership-snapshot-1` 태그 이전 히스토리 변경)은 하지 말 것.

## ⚠️ 가장 중요한 제약: 공유 백엔드는 건드리지 않는다

- 서버(Google Apps Script)·Drive 폴더·Sheet 구조는 다른 ~9명이 함께 쓰는 공유 인프라다. **이 리포에서 서버 로직을 바꿀 일은 없다** — `watermap_V100.html` 안의 Apps Script 코드는 실행되는 코드가 아니라 관리자 설정 안내용으로 화면에 표시만 되는 참고 텍스트다(아래 섹션 참고).
- 클라이언트가 보내는 payload의 형식과 목적지(`buildSoilPayload`/`buildTreePayload`, `sendToScript`)는 원본과 100% 동일하게 유지해야 한다. 이걸 바꾸면 같은 백엔드를 쓰는 다른 조원들의 데이터가 깨진다. 전송 관련 코드를 수정할 때는 항상 이 제약을 먼저 떠올릴 것.
- `TESTING_CHECKLIST.md`도 같은 이유로 "실서버(공유 Apps Script/Sheet/Drive)에는 절대 테스트 데이터를 보내지 않는다"고 명시한다 — 테스트는 브라우저 콘솔에서 `idbSet`/`fetch` 등을 임시로 가로채는 방식으로 한다(로컬 mock 서버 없음).

## 커맨드

빌드 시스템이 없다 — `watermap_V100.html` 하나에 HTML/CSS/JS가 전부 인라인으로 들어있다. package.json도, lint/test 커맨드도 없음.

```bash
python3 -m http.server   # 로컬 서빙 (TESTING_CHECKLIST.md 기준 검증 방법)
```

수정 후 검증은 자동 테스트가 아니라 [TESTING_CHECKLIST.md](TESTING_CHECKLIST.md)의 시나리오 중 **건드린 함수와 관련된 항목만** 브라우저 devtools 콘솔에서 골라 재현하는 방식이다(전체를 매번 돌리지 않음). 이 문서에 나온 "전역을 `window.xxx=`가 아니라 bare identifier로 덮어써야 한다"(`let` 선언 때문) 같은 팁을 참고할 것.

## 아키텍처

### 핵심 설계 원칙: 저장(local save)과 전송(network send)의 분리
이 포크의 첫 커밋 메시지가 정확히 "Personal fork: decouple save and send"다 — 원본 앱의 문제(네트워크가 느리거나 끊기면 로컬 저장까지 막히는 것)를 고치기 위해, **로컬 저장은 네트워크 상태와 무관하게 항상 즉시 성공**하고, **서버 전송은 별도의 재시도 가능한 큐/루프**로 분리되어 있다.
- 저장: `saveData()` → `localStorage`(`survey_records` 키, `getSurveyRecords`/`patchRecord`로 접근) + IndexedDB(`idbSet`/`idbGet`, 사진 원본·썸네일·뷰어용 4종 키를 `idbOrigKey`/`idbThumbKey`/`idbViewKey`/`idbMove*Key`로 생성).
- 전송: `sendToScript`/`sendToScriptSafe`(45초 타임아웃) → `autoRetryUpload`/`manualSendAll`/`reuploadRecord` → 성공 시 `finalizePhotoSuccess`/`refreshSynced`가 레코드의 `synced`·`uploadErrors` 상태를 갱신. 실패 사유는 `ensureUploadErrors`로 레코드에 구조화되어 남고, 대기 중인 것은 `upload_queue`(localStorage, `getQueue`/`saveQueue`)로 관리.
- 새 필드/기능을 추가할 때 이 경계를 허물지 말 것 — 저장 함수 안에서 네트워크를 기다리거나, 전송 실패가 로컬 저장 자체를 실패시키게 만들면 이 포크의 존재 이유(원본의 그 버그)가 재발한다.

### `watermap_V100.html` 안의 "Apps Script 코드" 블록은 죽은 코드가 아니라 참고 문서다
파일 중간(대략 1150~1548행)에 `doPost`/`doGet`/`handleSoil`/`handleTree`/`handlePhoto`/`ensureHeader` 같은 함수가 보이는데, 이건 **관리자 설정 화면(`toggleAppsScript()`/`copyAppsScript()`)에 텍스트로 표시되는 Apps Script 서버 코드의 참고용 사본**이며 이 HTML에서 실행되지 않는다. 실제 서버는 별도로 Google Apps Script 프로젝트에 배포되어 있다. 이 블록을 "안 쓰는 죽은 함수"로 오인해서 지우거나 "고치면" 안 되고, 반대로 실제 서버 동작을 바꾸려는 목적으로 여기를 수정해도 아무 효과가 없다 — 진짜 서버 코드는 이 리포 밖에 있다.

### 업로드 상태 머신과 사진 처리 락
레코드는 `soilUploaded`/`treeUploaded`/`photoList[].uploaded`를 종합한 `synced` 플래그(`refreshSynced`, `isTreeComplete`)로 완료 여부를 판정한다. 사진은 `_photoProcessing` 플래그로 동시 촬영/처리를 막고(진행 중 재촬영 시도는 토스트로 거부), `captureId`로 "늦게 도착한 이전 촬영의 응답"을 걸러낸다(`finalizePhotoSuccess`의 `attemptedCaptureId` 비교). 업로드 중에는 Wake Lock(`acquireUploadWakeLock`/`releaseUploadWakeLock`)으로 화면 꺼짐을 막고, 백그라운드 전환 시 업로드 루프를 중단한다(`shouldContinueUpload`) — 현장에서 화면이 꺼지거나 앱 전환되는 상황이 실제로 자주 일어나는 전제로 짜여 있다.

### XSS/CSV 인젝션 방어는 리포 전반의 반복 관례
`TESTING_CHECKLIST.md` 8번 항목과 `CONTRIBUTIONS.md`의 여러 커밋(`61e848e`, `88a8d7e`, `bd44369` 등)이 이 문제를 다룬다. 핵심 규칙: 사용자 입력을 `onclick="fn('${값}')"` 같은 문자열 조립 인라인 핸들러에 넣지 말 것 — `escapeHtml()`로 태그는 막아도 인라인 이벤트 핸들러 속성은 HTML 파서가 엔티티를 디코딩한 문자열을 그대로 JS로 실행하기 때문에 뚫린다. 반드시 DOM 생성 + `addEventListener`로 작성한다. CSV 내보내기(`csvSafeCell`)는 `=`/`+`/`-`/`@`로 시작하는 값 앞에 `'`를 붙여 Excel 수식 인젝션을 막는다.

### Service Worker의 "완결성 검증" 캐시 전략
`sw.js`는 단순 cache-first가 아니라, 응답을 끝까지 읽어 `arrayBuffer()`가 성공하는지로 "약전계에서 연결이 중간에 끊긴 200 응답"을 감지한다. `Content-Encoding`이 있으면(이 배포 환경은 GitHub Pages/Fastly라 HTML에 항상 gzip이 걸림) `Content-Length`와 압축 해제된 바이트 수를 비교할 수 없으므로 그 경우엔 비교를 건너뛰고 `arrayBuffer()` reject만으로 판단한다 — 이 조건을 되돌리면 정상 응답이 항상 "불일치"로 오판되어 캐시가 영원히 갱신되지 않는 회귀가 재발한다(주석에 이미 경고돼 있음).

### `개발지시서` 문서들
리포 루트의 `*_개발지시서.md` 파일들은 특정 기능/버그에 대한 과거 작업 지시서다(예: `저장목록_선택전송_개발지시서.md`, `팀별누적현황_안보임_스크롤버그_개발지시서.md`). 관련 기능을 다시 건드릴 때는 먼저 이름이 겹치는 지시서가 있는지 확인 — 그 기능이 왜 지금 이 모양인지에 대한 배경(원인 분석, 시도했던 대안 등)이 담겨 있을 수 있다.

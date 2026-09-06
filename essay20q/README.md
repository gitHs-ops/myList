# essay20q — 에세이식 스무고개

Topic(하고 싶은 일·목표·고민)과 Background(현재 상황·조사한 정보·제약 조건)를 입력하면,
AI가 직전 답변을 읽고 그때그때 다음 질문을 하나씩 던지는 대화형 자기 정리 도구.
탐색(1~7) → 전환(8~14, 전제 뒤집기 최소 1회) → 수렴(15~20) 순서로 20문항을 진행한 뒤
목표·실행 계획으로 종합한다. 숫자·이름·기간 같은 구체적 사실이 부족하면 미수렴으로 판단해
그 결과를 씨앗 삼아 2·3라운드를 이어간다.

## 구조
- `index.html` — 전체 앱(순수 HTML/CSS/JS, 프레임워크·서버 없음)
- `test/` — 헤드리스 브라우저로 실제 클릭해 가며 검증하는 회귀 테스트 (아래 참고)

## 실행 환경 — 두 backend 중 하나로 동작

1. **Artifact 모드** — claude.ai Artifact 뷰어 안에서 열리면 `window.claude.use('sample'|'downloads')`
   로 그 화면을 보는 사람의 Claude 계정 사용량을 쓴다. 키 입력 없음, 질문마다 한 번씩 사용
   허용을 물어본다.
2. **개인 API 키 모드** — Artifact 밖(GitHub Pages 등 일반 정적 호스팅)에서 열리면
   `window.claude` 가 없으므로, 대신 화면에 **"개인 API 키로 사용하기"** 카드가 나타난다.
   본인의 Anthropic API 키를 입력해 저장하면, 이 페이지가 브라우저에서 직접
   `https://api.anthropic.com/v1/messages` 를 호출한다(`anthropic-dangerous-direct-browser-access: true`
   헤더로 CORS 허용 — 이 헤더 없이 preflight 하면 400, 있으면 200 + `access-control-allow-origin: *` 로 실측 확인함).
   **개인 용도 전제**: 키는 이 브라우저의 localStorage에만 저장되고 Anthropic으로 바로
   전송된다 — 공용 PC나 공개 데모에는 쓰지 말 것. 모델(Opus 5/Sonnet 5/Haiku 4.5)을
   고를 수 있고, 화면에 누적 토큰·예상 비용이 표시된다. 결과 다운로드는 Artifact capability
   대신 일반 `<a download>` blob 방식을 쓴다(Artifact sandbox 밖이라 이 방식이 정상 동작함).

어느 backend 도 없으면(예: `window.claude` 도 없고 키도 저장 안 함) "스무고개 시작하기"
버튼이 계속 비활성 상태로 남는다.

## 옵시디언으로 결과 보내기

종합 결과 화면에서 **"옵시디언으로 보내기"** 버튼을 누르면, 옵시디언의
[Local REST API](https://github.com/coddingtonbear/obsidian-local-rest-api) 커뮤니티
플러그인이 여는 로컬 서버(기본 `http://127.0.0.1:27123`)로 최종 결과 마크다운을
`PUT /vault/{경로}` 요청 한 번으로 직접 저장한다(서버 주소·폴더·API 키는 옵시디언
플러그인 설정 화면에서 그대로 복사해 오면 된다). 저장되는 파일은 옵시디언 쪽 frontmatter
(`topic`/`round`/`converged`/`saved`/`source`)가 앞에 붙은 `.md` 로, 파일명은
`에세이식_스무고개_{라운드}라운드_{저장시각}.md` 형식이다. 연결 정보(서버 주소·폴더·키)는
이 브라우저의 localStorage에만 남고 옵시디언 외 다른 곳으로는 전송되지 않는다.

**이 버튼은 개인 API 키 모드에서만 나타난다.** Artifact 모드에서는 뷰어의 CSP가
`127.0.0.1` 을 포함한 모든 비허용 호스트로의 fetch 를 조용히 막기 때문에(에러조차
안 남고 그냥 요청이 나가지 않음) 옵시디언 저장이 원천적으로 불가능하다 — 그래서
`backend === 'apikey'` 일 때만 버튼을 만든다. GitHub Pages 등 Artifact 밖에서 열었지만
아직 API 키를 저장하지 않은 상태에서도 마찬가지로 버튼이 없다.

## 로컬에서 회귀 테스트 돌리기

두 backend 를 각각 흉내 낸 두 개의 독립된 테스트가 있다.

```bash
pip install playwright
python3 -m playwright install chromium   # 이미 설치된 Chromium이 있으면 생략하고
                                          # CHROMIUM_PATH=/path/to/chrome 환경변수로 지정해도 됨
python3 test/drive_rounds.py             # Artifact 모드 (window.claude 모의)
python3 test/drive_apikey.py             # 개인 API 키 모드 (window.fetch 모의)
python3 test/drive_obsidian.py           # 옵시디언으로 보내기 (버튼 게이팅 + 실제 저장 흐름)
```

- `drive_rounds.py` — `test/mock_claude.js` 로 `window.claude.use('sample'|'downloads')` 를
  흉내 낸다. 1라운드 20문항(선택형 질문 1개 포함) → 미수렴 종합 → 2라운드 진입(이전 라운드
  요약이 프롬프트에 실제로 실리는지 확인) → 2라운드를 수렴 구간(15~20)까지 진행 → 조기
  종료로 수렴 종합 → "지난 라운드 결과" UI와 다운로드(.md) 파일 내용까지 확인한다.
- `drive_apikey.py` — `window.claude` 를 아예 정의하지 않고 `test/mock_fetch.js` 로
  `window.fetch` 를 가로챈다. API 키 카드가 실제로 나타나는지, 실제 fetch 호출의
  URL·헤더(x-api-key/anthropic-version/anthropic-dangerous-direct-browser-access)·바디가
  맞는지, 마크다운 코드펜스로 감싼 응답도 파싱되는지, 401 에러 후 재시도가 복구되는지,
  토큰 사용량 표시, blob 다운로드까지 확인한다.
- `drive_obsidian.py` — Artifact 모드에서는 옵시디언 버튼이 아예 안 만들어지는지, 개인
  API 키 모드에서는 종합 화면에 버튼이 나타나는지 확인한 뒤, `test/mock_fetch.js` 가
  추가로 가로채는 `127.0.0.1:2712x` 로의 PUT 요청(URL·Authorization 헤더·frontmatter
  포함 바디)과 빈 키 검증·성공 상태·HTTP 에러·연결 실패(TypeError) 각각의 상태 표시
  문구까지 확인한다.

셋 다 마지막 줄에 `ALL ... CHECKS PASSED` 가 찍히면 통과.

## 알려진 제약
- AI가 직접 웹 검색을 하지는 못한다(두 backend 모두 브라우징 기능이 없음) — 판단 근거가
  부족하면 추측 대신 사용자에게 되묻는 질문으로 대체한다.
- 진행 상황(주제·배경·문답 기록)은 그 브라우저의 localStorage에만 저장된다 — 다른 기기·
  브라우저와 공유되지 않는다.
- 개인 API 키 모드는 키가 클라이언트 코드·네트워크 탭에 그대로 노출된다 — 이름 그대로
  "dangerous direct browser access" 다. 신뢰하는 개인 환경에서만 쓸 것.

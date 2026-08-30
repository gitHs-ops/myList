# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

- 순수 HTML/CSS/JS 정적 앱 모음(빌드 도구 없음) + 독립 Node/Express 백엔드 2개
- GitHub Pages 배포: `https://giths-ops.github.io/myList/` (main 브랜치 저장소 루트를 그대로 서빙)
- 저장소 루트에 package.json 없음 — Node 백엔드(`hyundai-proxy/`, `sketch3d/server/`)만 각자 독립적으로 package.json 보유

## 로컬 실행

```bash
# 정적 프론트 전체 (루트) — .claude/launch.json "myList-static", 포트 8934
python -m http.server 8934

# sketch3d 프론트만 — .claude/launch.json "sketch3d", 포트 8900
python -m http.server 8900 --directory sketch3d

# hyundai-proxy 백엔드 — 포트 8080, .env 필요(.env.example 참고)
cd hyundai-proxy && npm install && npm start

# sketch3d 백엔드(Claude Vision) — 포트 8787, .env에 ANTHROPIC_API_KEY 필요
cd sketch3d/server && npm install && npm start
```

- `run-car-app.bat` — hyundai-proxy 서버 실행 + car-maintenance.html 브라우저 오픈을 한 번에
- hyundai-proxy는 `HYUNDAI_CLIENT_ID/SECRET/REDIRECT_URI`, `APP_SHARED_SECRET` 중 하나라도 없으면 기동 즉시 종료(fail-fast)

## 배포

- 정적 프론트(루트 전체 + `sketch3d/index.html`): GitHub Pages, main push 시 자동 반영
- `hyundai-proxy/`: Render (저장소 루트의 `render.yaml`, `rootDir: hyundai-proxy`)
- `sketch3d/server/`: Render (`sketch3d/server/render.yaml`) — `https://mylist-9nha.onrender.com`
- 커밋+푸시 자동화 스크립트 `push4myList.ps1`은 이 저장소 밖(`C:\myPrjt01\`)에 있음: add -A → commit → pull --rebase → push origin main

## 아키텍처

### 1. 앱 포털 (`index.html` + `app-add.html`)
저장소의 실질적인 홈. `index.html`은 등록된 앱을 표로 나열하고, `app-add.html`에서 등록/수정한다. 둘 다 Google Apps Script 엔드포인트(`index.html`의 `APPS_SCRIPT_URL`)를 데이터스토어로 쓰고, 실패 시 `localStorage` 캐시로 폴백한다.

### 2. 독립형 단일 파일 앱
빌드 없이 그 자체로 배포되는 앱들 (CSS/JS 인라인이 기본 패턴):
- `car-maintenance.html` — 내 차 정비/주유 이력 (아래 hyundai-proxy와 페어)
- `card-pair-game.html` — 화투 짝맞추기, PeerJS P2P 대전 + 카카오톡 공유, base64 이미지 다수 내장(~2.7MB)
- `tetris-3d.html` — 3D 테트리스 (Three.js)
- `nbbang_calculator-1.html` — N빵 계산기
- `select-oni-game.html` — 사다리타기

### 3. 프론트+백엔드 페어
저장소 안에 프론트와 짝을 이루는 독립 Node 서버가 두 개 있고, 서로 완전히 별개다(공용 코드/워크스페이스 없음).

**`car-maintenance.html` ↔ `hyundai-proxy/`**
현대 커넥티드카 API OAuth 프록시. `server.js`가 인증코드 교환·리프레시·토큰 저장(`token-store.json`, 파일 기반)을 대신 처리한다. 프론트는 백엔드 주소와 접근 코드를 브라우저 `localStorage`에 저장해두고 `/api/*` 호출마다 `X-App-Secret` 헤더로 실어 보내며, 서버가 `APP_SHARED_SECRET`과 일치하는지 검사한다(`/auth/*`는 현대 측이 직접 리다이렉트로 호출하므로 이 검사에서 제외).

**`sketch3d/index.html` ↔ `sketch3d/server/`**
치수가 적힌 손그림 스케치 → 벽 좌표 JSON → Three.js 3D 렌더링. `server.js`가 Claude Vision(`@anthropic-ai/sdk`, 기본 모델 `claude-opus-5`, env `VISION_MODEL`로 교체 가능)에 이미지와 JSON 스키마(`WALL_SCHEMA`)를 보내 구조화 출력을 받는다.
- `POST /api/extract` — 스케치 이미지(base64, 1장 이상) → 벽 좌표 JSON
- `POST /api/edit` — 기존 벽 JSON + 한국어 자연어 수정 지시 → 수정된 벽 JSON
- 벽 좌표 포맷: `{unit:"mm", wallHeight, wallThickness, walls:[{start:[x,y],end:[x,y], height?, thickness?, sill?, lintel?, openings?}], north?, roof?, notes}` — 원점 좌하단, x→오른쪽, y→위, 벽은 중심선
- 배경·로드맵은 `sketch3d/README.md` 참고 (영덕감성산장 인허가 도면 작업 계기의 셀프 건축주용 MVP)

### 4. Chrome 확장 패키징 폴더 (로컬 전용, git 미추적)
`N빵계산기/`, `사다리타기/`, `화투짝맞추기/`는 루트의 단일 HTML 앱을 각각 manifest_version 3 Chrome 확장 팝업으로 감싼 폴더다(`manifest.json` + `icon.png` + html 복사본). `git status`에 매번 untracked로 뜨는 게 정상이며, 배포 소스는 항상 루트 `.html` 파일이다.

## 컨벤션

- 신규 앱도 단일 HTML 파일에 CSS+JS 인라인이 기본 패턴 (예외: sketch3d는 프론트/백엔드 분리)
- Node 서브프로젝트(`hyundai-proxy/`, `sketch3d/server/`)는 폴더별로 package.json/.env/.gitignore를 완전히 독립적으로 관리
- 커밋 메시지 실관행: `add|update|fix|chore <파일/기능>: <한국어 요약>` (예: `update sketch3d: 인허가 PDF 도면 이미지 축소`)
- 수정 후에는 브라우저 확인(스크린샷 검토) 요청 → 이상 없으면 `git add [파일] && git commit && git push origin main`

## 사용자 페르소나 및 응답 규칙

- 개발 경험 30년, 은퇴 후 최근 코딩 복귀 → 코드 설명 불필요
- 응답 형식: **분석 끝 → 수정했음 → 당신이 할 일** 3단계로만 보고
- 불필요한 설명, 배경 지식, 동작 원리 설명 생략
- 간결하게 핵심만

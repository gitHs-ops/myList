# sketch3d — 손그림 → 3D 벽체 프로토타입

치수가 적힌 손그림 스케치를 올리면 벽 좌표를 인식해 Three.js로 3D 벽체를 세운다.
영덕감성산장 객실 동 인허가 도면 작업을 계기로 한 셀프 건축주용 웹앱 MVP.

## 구조
- `index.html` — 프론트엔드 (GitHub Pages 배포용, 순수 HTML/JS + Three.js CDN)
- `server/` — Extract API (Express + Claude Vision, Render 배포용)

3D 파이프라인은 **비전 API 없이도** 샘플/JSON 입력으로 바로 확인 가능 (index.html 2·3번).

## 로컬 실행
```bash
cd sketch3d/server
cp .env.example .env      # ANTHROPIC_API_KEY 채우기
npm install
npm start                 # http://localhost:8787
```
프론트는 `index.html` 을 브라우저로 열면 됨. 백엔드 URL 기본값은 `http://localhost:8787/api/extract`.

## 데이터 포맷 (벽 좌표 JSON)
```json
{
  "unit": "mm",
  "wallHeight": 2700,
  "wallThickness": 200,
  "walls": [
    { "start": [0, 0], "end": [5000, 0] }
  ],
  "notes": "치수 없는 부분은 비율로 추정"
}
```
- 좌표계: 원점 좌하단, x→오른쪽, y→위, 단위 mm
- 벽은 중심선 `start`~`end` 선분

## 가구 기본 치수 (스키마)

`index.html` 의 `FURNITURE_TYPES` — 배치·회전·렌더링은 아직 없고, 타입별 기본 크기만 정의한
참고용 카탈로그. 단위 mm.

| 타입 | width(가로) | depth(세로) | height(높이) |
|---|---|---|---|
| 싱크대 (`sink`) | 900 | 600 | 850 |
| 침대 (`bed`) | 1500 | 2000 | 450 |
| 소파 (`sofa`) | 2000 | 900 | 850 |
| 식탁 (`table`) | 1200 | 800 | 750 |
| 사무용탁자 (`desk`) | 1200 | 600 | 720 |
| 냉장고 (`fridge`) | 800 | 750 | 1750 |

## 배포
- 프론트: GitHub Pages → `https://giths-ops.github.io/myList/sketch3d/`
- 백엔드: Render → `https://mylist-9nha.onrender.com` (Web Service 수동 생성, Root Directory `server`, 환경변수 `ANTHROPIC_API_KEY`/`VISION_MODEL`). 프론트 기본 Extract API URL이 이 주소로 설정되어 있음(`/api/extract`).

## 로드맵
1. ✅ 벽체 3D 자동 생성 (현재)
2. 지붕/창문/문 디테일
3. 방 용도 라벨링 → 벽선 편집 UI

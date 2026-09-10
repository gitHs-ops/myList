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

## 가구 배치

3D 뷰(`.viewport-card`) 상단의 "🛋️ 가구 배치 모드" 버튼이 캔버스에서 가구 배치·제거·
이동이 동작할지를 켜고 끈다(꺼져 있으면 캔버스는 평소처럼 카메라 회전/줌만 함). 옆
드롭다운에서 타입을 고르면 모드가 자동으로 켜지고, 바닥을 클릭하면 그 자리에 배치된다
(드롭다운은 선택한 타입을 계속 보여줘 연속 배치 가능). 드롭다운을 placeholder로
되돌리면 배치 대기만 풀리고 모드는 유지되며(배치된 가구 클릭/드래그는 계속 됨), 토글
버튼을 다시 누르면("🛋️ 가구모드해제") 모드 전체가 꺼진다. 배치된 가구를 클릭하면
armed 여부와 무관하게 항상 제거되고, 드래그하면 그 방향으로 옮겨진다(뗀 자리가
벽 밖이면 원래 자리로 되돌아감). 가구 전체(중심점이 아니라 폭·깊이 기준 외곽)가
벽 안쪽에 들어오지 않는 위치는(배치든 이동이든) 무효 처리된다 — 정확한 방 폴리곤이
아니라 전체 벽
바운딩박스를 벽 두께만큼 줄인 사각형으로 근사하므로, 오목한(L자) 평면에서는 완벽하지
않다. 1인칭 시점과는 동시에 켤 수 없다(가구 모드를 켜거나 가구를 선택하면 1인칭이
꺼지고, 1인칭을 켜면
배치 모드가 꺼진다). 이름표는 가구 높이와 무관하게 항상 고정 크기로 가구 상단에 표시된다.
회전은 아직 없음(항상 기본 방향의 육면체). 모델을 다시 만들어도(샘플 선택, JSON 재생성
등) 배치는 유지된다. 한꺼번에 지우는 기능은 없어 하나씩 클릭해서 제거해야 한다. 타입별
기본 크기는 `index.html`
의 `FURNITURE_TYPES`. 단위 mm.

| 타입 | width(가로) | depth(세로) | height(높이) |
|---|---|---|---|
| 싱크대 (`sink`) | 900 | 600 | 850 |
| 침대 (`bed`) | 1500 | 2000 | 450 |
| 싱글침대 (`bedSingle`) | 1200 | 1800 | 450 |
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

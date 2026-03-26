# myHomeV2 프로젝트 가이드

## 프로젝트 개요
- 순수 HTML/CSS/JS 단일 파일 앱 (빌드 도구 없음)
- GitHub Pages 배포: `https://giths-ops.github.io/myList/`
- 주요 파일: `household-budget.html`, `dashboard-landing.html`, `day_work_report.html`, `edit_work.html`

## 기술 스택
- 바닐라 JS (프레임워크 없음)
- 외부 CDN: Google Fonts, Chart.js (`https://cdn.jsdelivr.net/npm/chart.js`)
- 저장소: localStorage 전용 (서버 없음)

---

## household-budget.html 아키텍처

### 전역 상태
```js
let DATA = [];            // 현재 가계부 데이터 배열
let COLUMNS = [];         // 헤더 컬럼 설정 [{key, label}]
let APP_TITLE = '';       // 현재 가계부 타이틀
let BOOKS = [];           // 멀티 워크스페이스 목록 [{id, title}]
let CURRENT_BOOK_ID = ''; // 현재 활성 가계부 ID
let UNIT_MODE = 'man';    // 'man'(만원) | 'won'(원)
let currentFilter = 'all';
let editId = null;
let newBookMode = false;
let chartSelectedCols = ['all'];
let chartDateRange = 'all';
```

### localStorage 키 구조
| 키 | 내용 |
|---|---|
| `hb_workspace` | `{current: id, books: [{id, title}]}` |
| `hb_data_{id}` | 가계부 데이터 배열 |
| `hb_cols_{id}` | 컬럼 설정 배열 |
| `hb_unit` | 단위 모드 ('man'/'won') |

### DATA 레코드 구조
```js
{
  id: number,
  year: number, month: number,
  // COLUMNS에서 정의된 key들 (kb, kbm, deposit, saving, pension, mirae, ...):
  [key]: number | null,
  details: string[]
}
```

### 기본 컬럼 (DEFAULT_COLUMNS)
`kb(카뱅), kbm(국민), deposit(정기예금), saving(적금), pension(연금저축), mirae(미래에셋)`

### 핵심 함수 흐름
```
loadWorkspace() → render() → applyAppTitle()
render() = updateSummary() + renderFilters() + renderTable()
```

### 동적 그리드 공식
```js
gridCols = `100px ${COLUMNS.map(()=>'100px').join(' ')} 100px 1fr`
// 년/월 + 각 컬럼 + 합계 + 세부내역
```

### 금액 표시
```js
formatAmount(val)
// 만원 모드: 1,234만
// 원 모드: 12,340,000원
```

---

## UI/UX 패턴

### 색상 변수
```css
--primary: #3a57e8  /* 메인 파란색 */
--danger:  #ef4444  /* 삭제/경고 빨간색 */
--accent:  #0aad8e  /* 강조 초록색 */
--surface: #ffffff
--border:  #dde3f5
--muted:   #8090b8
```

### 모달 구조 (공통)
```html
<div class="modal-overlay" id="*Overlay" onclick="close*Outside(event)">
  <div class="modal [chart-modal]">
    <div class="modal-header"> ... </div>
    <div class="modal-body">   ... </div>  <!-- overflow-y:auto; flex:1 -->
    <div class="modal-footer"> ... </div>
  </div>
</div>
```
- 모달 열기: `overlay.classList.add('open')` + `document.body.style.overflow='hidden'`
- 모달 닫기: `overlay.classList.remove('open')` + `document.body.style.overflow=''`

### 반응형 브레이크포인트
- `@media(max-width:900px)` 하나만 사용
- 모바일: 필터 버튼 숨기고 `<select>` 드롭다운 표시
- 테이블: `overflow-x:auto` + `min-width` 고정으로 가로 스크롤

### 토스트 알림
```js
showToast('✅ 저장되었습니다.');
showToast('🗑 항목이 삭제되었습니다.');
```

---

## 개발 워크플로우

### 수정 후 반드시
1. 브라우저 확인 요청 (스크린샷 검토)
2. `git add [파일] && git commit && git push origin main`
3. 커밋 메시지 형식: `update/fix household-budget.html: [변경 내용 요약]`

### 자주 쓰는 편집 패턴
- CSS 추가: 관련 섹션 주석 바로 위에 삽입
- JS 함수 추가: 관련 섹션 주석 앞에 삽입
- HTML 모달 추가: 기존 모달 바로 앞에 삽입

### DATA_VERSION / 마이그레이션
- 스키마 변경 시 `DATA_VERSION` 숫자 올리기 → localStorage 캐시 자동 초기화
- 현재 멀티북 구조로 전환 완료 (hb_workspace 기반)
- 신규 컬럼 추가 시 기존 레코드는 `undefined` → `—` 표시 (별도 마이그레이션 불필요)

---

## 주요 기능 목록

| 기능 | 구현 방식 |
|---|---|
| 멀티 가계부 | `BOOKS[]` + `hb_workspace` localStorage |
| 동적 컬럼 | `COLUMNS[]` + `hb_cols_{id}` localStorage |
| 만원/원 토글 | `UNIT_MODE` + `formatAmount()` |
| 꺾은선 차트 | Chart.js, 컬럼 선택 + 기간 필터 |
| 연도 필터 | 데스크탑: 버튼, 모바일: select 드롭다운 |
| 세부내역 토글 | 클릭으로 tag 펼치기/접기 |
| 모달 스크롤 | `modal-body: overflow-y:auto; flex:1` |
| 모바일 가로스크롤 | `table-wrap: overflow-x:auto` |

---

## 주의사항
- JS 템플릿 리터럴 안 따옴표 주의: `''` (빈 문자열) vs `'''` (오류)
- `renderFilters()` 는 매 render() 마다 innerHTML 초기화 → 동적 요소는 함수 안에서 생성
- Chart.js 인스턴스는 재생성 전 반드시 `chartInstance.destroy()` 호출
- 새 컬럼 key는 `'c' + Date.now()` 로 고유값 생성

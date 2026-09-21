/**
 * sketch3d 시스템 로그 수집용 Apps Script 웹앱
 *
 * ⚠ 반드시 "새 Apps Script 프로젝트"에 넣는다.
 *   포털용 프로젝트(list_proxy 등 doGet/doPost 가 이미 있는 프로젝트)에 같이 넣으면
 *   doGet/doPost 이름이 겹쳐 먼저 쓰던 기능이 깨진다.
 *   부득이 한 프로젝트에 합쳐야 한다면 맨 아래 [기존 프로젝트에 합치는 경우]를 따른다.
 *
 * [배포 순서]
 * 1) 구글 시트를 새로 만든다 (로그 전용 시트 권장).
 * 2) 그 시트에서 확장 프로그램 > Apps Script 를 열고 이 파일 내용을 붙여넣는다.
 *    ※ script.google.com 에서 만든 "독립형" 프로젝트라면 연결된 시트가 없어 기록이 안 된다.
 *      그 경우 아래 SKETCH3D_LOG.SHEET_ID 에 스프레드시트 ID 를 직접 넣으면 동작한다.
 *      (ID 는 시트 주소 .../spreadsheets/d/  여기  /edit 사이 문자열)
 * 3) 배포 > 새 배포 > 유형 "웹 앱"
 *      - 실행 계정: 나
 *      - 액세스 권한: 모든 사용자  ← 익명 방문자의 로그를 받으려면 필수
 * 4) 배포 후 나오는 https://script.google.com/macros/s/.../exec 주소를
 *    sketch3d/index.html 의 SHEET_LOG_URL 에 붙여넣는다.
 * 5) 코드를 고쳐 다시 배포할 때는 "배포 관리 > 편집 > 버전: 새 버전"으로 올려야
 *    기존 URL 이 그대로 유지된다(새 배포를 만들면 URL 이 바뀐다).
 *
 * [점검 방법]
 * · 브라우저로 .../exec 주소를 그냥 열어본다.
 *   - {"ok":true, "connected":true, ...} → 시트 연결까지 정상. 시트에 'sketch3d-log' 탭이 생겨 있다.
 *   - {"ok":false, "error":"..."}        → error 내용대로 조치(대개 SHEET_ID 미설정).
 *   - 구글 로그인 화면이 뜬다            → 배포 액세스 권한이 "모든 사용자"가 아니다.
 * · 편집기에서 sketch3dLog_selfTest 함수를 실행하면 테스트 행 1건이 기록된다.
 *
 * [받는 형식] POST body 가 아래 JSON 문자열 (Content-Type: text/plain)
 * { app, session, device, ip, page, ua, screen,
 *   rows: [{ seq, ts, type, msg, ip }, ...] }
 *
 * [기존 프로젝트에 합치는 경우]
 *   이 파일에서 doPost / doGet 두 함수만 지우고, 기존 프로젝트의 doPost / doGet 안에서
 *   sketch3dLog_handlePost(e) / sketch3dLog_handleGet() 을 호출하도록 분기한다. 예:
 *     function doPost(e) {
 *       if (e && e.parameter && e.parameter.action === 'log') return sketch3dLog_handlePost(e);
 *       ...기존 처리...
 *     }
 *   이때 sketch3d/index.html 의 SHEET_LOG_URL 끝에 ?action=log 를 붙여야 한다.
 *   나머지 이름은 전부 sketch3dLog_ / SKETCH3D_LOG 으로 묶여 있어 충돌하지 않는다.
 */

/** 이 수집기 전용 설정 — 전역 이름 하나(SKETCH3D_LOG)만 쓰도록 묶어 둔다(다른 파일과 충돌 방지). */
var SKETCH3D_LOG = {
  SHEET_ID: '',                 // 독립형 프로젝트일 때만 스프레드시트 ID 를 넣는다. 시트에서 만든 프로젝트면 비워둔다.
  SHEET_NAME: 'sketch3d-log',
  HEADERS: ['수신시각', '기록시각', '세션', '기기ID', 'IP', '유형', '메시지', '페이지', '브라우저', '화면', '순번'],
  TYPE_LABEL: {
    click: '클릭', check: '체크', change: '변경', key: '키',
    status: '상태', api: 'API', error: '오류', session: '세션'
  },
  MAX_ROWS: 200000              // 이 건수를 넘으면 오래된 행부터 지운다(시트 상한 대비)
};

/* ---------- 웹앱 진입점 ---------- */
/* 이 프로젝트에 다른 doPost/doGet 이 있다면 이 두 함수를 지우고
   기존 진입점에서 sketch3dLog_handlePost / sketch3dLog_handleGet 을 호출한다. */

function doPost(e) {
  return sketch3dLog_handlePost(e);
}

function doGet() {
  return sketch3dLog_handleGet();
}

/* ---------- 실제 처리 ---------- */

function sketch3dLog_handlePost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (err) {
    return sketch3dLog_json({ ok: false, error: 'busy' });
  }
  try {
    var payload = sketch3dLog_parseBody(e);
    if (!payload || !payload.rows || !payload.rows.length) {
      return sketch3dLog_json({ ok: false, error: 'empty' });
    }

    var sheet = sketch3dLog_getSheet();
    var received = new Date();
    var rows = payload.rows.map(function (r) {
      return [
        received,
        r.ts ? new Date(Number(r.ts)) : received,
        sketch3dLog_str(payload.session),
        sketch3dLog_str(payload.device),
        sketch3dLog_str(r.ip || payload.ip),
        SKETCH3D_LOG.TYPE_LABEL[r.type] || sketch3dLog_str(r.type),
        sketch3dLog_str(r.msg).slice(0, 1000),
        sketch3dLog_str(payload.page),
        sketch3dLog_str(payload.ua).slice(0, 300),
        sketch3dLog_str(payload.screen),
        Number(r.seq) || ''
      ];
    });

    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, SKETCH3D_LOG.HEADERS.length).setValues(rows);
    sketch3dLog_trim(sheet);
    return sketch3dLog_json({ ok: true, saved: rows.length });
  } catch (err) {
    // 브라우저 쪽은 no-cors 라 이 응답을 읽지 못하므로, 원인 추적용으로 실행 로그에도 남긴다
    console.error('sketch3d 로그 기록 실패: ' + err);
    return sketch3dLog_json({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

/** 배포·연결 점검용 — 브라우저로 URL 을 열면 이 응답이 보인다. */
function sketch3dLog_handleGet() {
  var info = { ok: true, endpoint: 'sketch3d log', sheet: SKETCH3D_LOG.SHEET_NAME };
  try {
    var sheet = sketch3dLog_getSheet();
    info.connected = true;
    info.spreadsheet = sketch3dLog_book().getName();
    info.rows = Math.max(0, sheet.getLastRow() - 1);
  } catch (err) {
    info.ok = false;
    info.connected = false;
    info.error = String(err);
  }
  return sketch3dLog_json(info);
}

/** 편집기에서 직접 실행해 기록 경로를 점검한다. 성공하면 시트에 테스트 행 1건이 생긴다. */
function sketch3dLog_selfTest() {
  var res = sketch3dLog_handlePost({
    postData: {
      contents: JSON.stringify({
        app: 'sketch3d', session: 'selftest', device: 'selftest', ip: '0.0.0.0',
        page: 'selfTest', ua: 'Apps Script 편집기', screen: '0x0',
        rows: [{ seq: 1, ts: Date.now(), type: 'status', msg: 'selfTest 기록 — 삭제해도 무방', ip: '0.0.0.0' }]
      })
    }
  });
  console.log(res.getContent());
}

/* ---------- 보조 함수 ---------- */

function sketch3dLog_parseBody(e) {
  if (!e) return null;
  // 본문(POST) 우선, 없으면 ?data= 쿼리도 허용
  var raw = (e.postData && e.postData.contents) || (e.parameter && e.parameter.data) || '';
  if (!raw) return null;
  return JSON.parse(raw);
}

/** 기록 대상 스프레드시트. SKETCH3D_LOG.SHEET_ID 가 있으면 그 시트를, 없으면 이 스크립트가 붙어 있는 시트를 쓴다. */
function sketch3dLog_book() {
  if (SKETCH3D_LOG.SHEET_ID) return SpreadsheetApp.openById(SKETCH3D_LOG.SHEET_ID);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    throw new Error('연결된 스프레드시트가 없습니다. 이 프로젝트가 시트에서 만든 것이 아니라면 SKETCH3D_LOG.SHEET_ID 에 스프레드시트 ID 를 넣으세요.');
  }
  return ss;
}

function sketch3dLog_getSheet() {
  var ss = sketch3dLog_book();
  var sheet = ss.getSheetByName(SKETCH3D_LOG.SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SKETCH3D_LOG.SHEET_NAME);
  }
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, SKETCH3D_LOG.HEADERS.length).setValues([SKETCH3D_LOG.HEADERS]).setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, 2).setHorizontalAlignment('center');
  }
  return sheet;
}

function sketch3dLog_trim(sheet) {
  var over = sheet.getLastRow() - 1 - SKETCH3D_LOG.MAX_ROWS;
  if (over > 0) sheet.deleteRows(2, over);
}

function sketch3dLog_str(v) {
  return v === null || v === undefined ? '' : String(v);
}

function sketch3dLog_json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

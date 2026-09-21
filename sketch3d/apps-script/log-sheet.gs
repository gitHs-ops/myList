/**
 * sketch3d 시스템 로그 수집용 Apps Script 웹앱
 *
 * [배포 순서]
 * 1) 구글 시트를 새로 만든다 (로그 전용 시트 권장).
 * 2) 확장 프로그램 > Apps Script 를 열고 이 파일 내용을 붙여넣는다.
 * 3) 배포 > 새 배포 > 유형 "웹 앱"
 *      - 실행 계정: 나
 *      - 액세스 권한: 모든 사용자  ← 익명 방문자의 로그를 받으려면 필수
 * 4) 배포 후 나오는 https://script.google.com/macros/s/.../exec 주소를
 *    sketch3d/index.html 의 SHEET_LOG_URL 에 붙여넣는다.
 * 5) 코드를 고쳐 다시 배포할 때는 "배포 관리 > 편집 > 새 버전"으로 올려야
 *    기존 URL 이 그대로 유지된다(새 배포를 만들면 URL 이 바뀐다).
 *
 * [받는 형식] POST body 가 아래 JSON 문자열 (Content-Type: text/plain)
 * { app, session, device, ip, page, ua, screen,
 *   rows: [{ seq, ts, type, msg, ip }, ...] }
 */

var SHEET_NAME = 'sketch3d-log';
var HEADERS = ['수신시각', '기록시각', '세션', '기기ID', 'IP', '유형', '메시지', '페이지', '브라우저', '화면', '순번'];
var TYPE_LABEL = {
  click: '클릭', check: '체크', change: '변경', key: '키',
  status: '상태', api: 'API', error: '오류', session: '세션'
};
var MAX_ROWS = 200000;   // 이 건수를 넘으면 오래된 행부터 지운다(시트 상한 대비)

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (err) {
    return json({ ok: false, error: 'busy' });
  }
  try {
    var payload = parseBody(e);
    if (!payload || !payload.rows || !payload.rows.length) return json({ ok: false, error: 'empty' });

    var sheet = getSheet();
    var received = new Date();
    var rows = payload.rows.map(function (r) {
      return [
        received,
        r.ts ? new Date(Number(r.ts)) : received,
        str(payload.session),
        str(payload.device),
        str(r.ip || payload.ip),
        TYPE_LABEL[r.type] || str(r.type),
        str(r.msg).slice(0, 1000),
        str(payload.page),
        str(payload.ua).slice(0, 300),
        str(payload.screen),
        Number(r.seq) || ''
      ];
    });

    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, HEADERS.length).setValues(rows);
    trim(sheet);
    return json({ ok: true, saved: rows.length });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

/** 배포 확인용 — 브라우저로 URL 을 열면 이 응답이 보이면 정상. */
function doGet() {
  return json({ ok: true, endpoint: 'sketch3d log', sheet: SHEET_NAME });
}

function parseBody(e) {
  if (!e) return null;
  // 본문(POST) 우선, 없으면 ?data= 쿼리도 허용
  var raw = (e.postData && e.postData.contents) || (e.parameter && e.parameter.data) || '';
  if (!raw) return null;
  return JSON.parse(raw);
}

function getSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, 2).setHorizontalAlignment('center');
  }
  return sheet;
}

function trim(sheet) {
  var over = sheet.getLastRow() - 1 - MAX_ROWS;
  if (over > 0) sheet.deleteRows(2, over);
}

function str(v) {
  return v === null || v === undefined ? '' : String(v);
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/*
 * "개인 API 키" 경로(backend === 'apikey') 를 검증하기 위한 모의 fetch.
 * window.claude 는 아예 정의하지 않는다 -- 이 페이지가 Artifact 밖(예: GitHub Pages)에서
 * 열렸을 때와 똑같은 조건을 만들어, 실제로 https://api.anthropic.com/v1/messages 로
 * 보내는 요청의 URL·헤더·바디를 가로채 검증하고, Anthropic Messages API 응답 모양의
 * 더미 데이터를 돌려준다. drive_apikey.py 가 이 스크립트를 page.add_init_script 로 주입한다.
 */
window.__fetchLog = [];
window.__forceStatus = null;   // 테스트가 다음 호출 1회만 강제로 에러 상태를 내게 함
window.__downloadLog = [];     // downloadPlain() 이 만드는 blob 다운로드 기록

window.__obsidianLog = [];         // 옵시디언 vault PUT 요청 기록 (URL/헤더/바디)
window.__obsForceStatus = null;    // 다음 호출 1회만 강제로 이 HTTP 상태를 내게 함
window.__obsForceNetworkError = false; // true 면 다음 호출 1회를 TypeError(연결 실패)로 만듦

(function () {
  var realFetch = window.fetch.bind(window);

  window.fetch = function (url, opts) {
    if (typeof url === 'string' && url.indexOf('127.0.0.1:2712') >= 0) {
      opts = opts || {};
      window.__obsidianLog.push({ url: url, method: opts.method, headers: opts.headers, body: opts.body });
      return new Promise(function (resolve, reject) {
        setTimeout(function () {
          if (window.__obsForceNetworkError) {
            window.__obsForceNetworkError = false;
            reject(new TypeError('Failed to fetch'));
            return;
          }
          if (window.__obsForceStatus) {
            var st = window.__obsForceStatus;
            window.__obsForceStatus = null;
            resolve({ ok: false, status: st, text: function () { return Promise.resolve('mock vault error body'); } });
            return;
          }
          resolve({ ok: true, status: 204, text: function () { return Promise.resolve(''); } });
        }, 5);
      });
    }
    if (typeof url === 'string' && url.indexOf('api.anthropic.com') >= 0) {
      opts = opts || {};
      window.__fetchLog.push({ url: url, headers: opts.headers, body: opts.body });
      return new Promise(function (resolve, reject) {
        if (opts.signal && opts.signal.aborted) {
          var abortErr = new Error('aborted'); abortErr.name = 'AbortError'; reject(abortErr); return;
        }
        setTimeout(function () {
          if (window.__forceStatus) {
            var status = window.__forceStatus;
            window.__forceStatus = null;
            resolve(fakeResponse(status, { type: 'error', error: { type: 'x', message: 'forced ' + status } }));
            return;
          }
          var body = JSON.parse(opts.body);
          var promptText = body.messages[0].content;
          var mQ = promptText.match(/(\d+)라운드의 (\d+)번째 질문을 만드세요/);
          if (mQ) {
            var round = parseInt(mQ[1], 10), idx = parseInt(mQ[2], 10);
            var obj = {
              kind: 'question',
              phase: idx <= 7 ? '탐색' : (idx <= 14 ? '전환' : '수렴'),
              isAssumptionFlip: idx === 10,
              note: '',
              question: 'API R' + round + 'Q' + idx + ' 첫 문장입니다. API 두 번째 문장입니다.',
              answerType: (idx === 9) ? 'choice' : 'open',
              choices: (idx === 9) ? ['후보A', '후보B', '후보C'] : []
            };
            // idx===3 은 일부러 마크다운 코드펜스로 감싸서 관대한 JSON 파싱 경로도 검증한다.
            var text = (idx === 3)
              ? ('여기 질문을 준비했습니다:\n```json\n' + JSON.stringify(obj) + '\n```\n감사합니다.')
              : JSON.stringify(obj);
            resolve(fakeResponse(200, anthropicMessage(text, body.model)));
            return;
          }
          if (promptText.indexOf('지금까지의 모든 답변을 종합') >= 0) {
            var rm = promptText.match(/"round":(\d+)/);
            var r = rm ? parseInt(rm[1], 10) : 1;
            var earlyStop = promptText.indexOf('다 채우지 않고') >= 0;
            var synObj = {
              kind: 'synthesis', round: r, converged: !!earlyStop,
              summary: 'API ' + r + '라운드 요약 문장1입니다. 요약 문장2입니다.',
              goals: ['API목표1', 'API목표2'],
              actionPlan: [{ step: '단계1', target: '대상', period: '1개월', how: '방법', verify: '검증' }],
              missingFacts: earlyStop ? [] : ['부족1'],
              message: 'API 코멘트입니다.'
            };
            resolve(fakeResponse(200, anthropicMessage(JSON.stringify(synObj), body.model)));
            return;
          }
          resolve(fakeResponse(200, anthropicMessage('패턴을 찾지 못했습니다', body.model)));
        }, 5);
      });
    }
    return realFetch(url, opts);
  };

  function anthropicMessage(text, model) {
    return {
      id: 'msg_test', type: 'message', role: 'assistant',
      content: [{ type: 'text', text: text }],
      model: model, stop_reason: 'end_turn',
      usage: { input_tokens: 500, output_tokens: 80 }
    };
  }
  function fakeResponse(status, jsonBody) {
    return { ok: status >= 200 && status < 300, status: status, json: function () { return Promise.resolve(jsonBody); } };
  }

  // downloadResult() 가 Artifact 밖에서 쓰는 blob <a download> 트릭을 가로채 기록만 한다
  // (Playwright 가 실제 파일 저장 다이얼로그를 열지 않도록).
  var realCreateObjectURL = URL.createObjectURL.bind(URL);
  URL.createObjectURL = function (blob) { return realCreateObjectURL(blob); };
  var realClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.download) { window.__downloadLog.push({ filename: this.download, href: this.href }); return; }
    return realClick.apply(this, arguments);
  };
})();

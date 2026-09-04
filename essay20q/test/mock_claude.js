/*
 * ../index.html 을 claude.ai Artifact 뷰어 밖(예: 이 저장소를 그냥 브라우저로 열었을 때)에서도
 * 구동해 보기 위한 window.claude.sample/downloads 모의 구현. drive_rounds.py 가 이 스크립트를
 * page.add_init_script 로 주입한 뒤 실제 클릭·입력으로 전체 흐름을 검증한다.
 * 진짜 Claude 응답이 아니라 정해진 패턴(질문 N번째/종합 요청)에 고정된 더미 JSON을 돌려준다.
 */
window.__promptLog = [];
window.__lastDownload = null;

window.claude = {
  use: function (name) {
    if (name === 'sample') {
      var fn = function (prompt, opts) {
        return Promise.reject({ code: 'invalid_request', message: 'use .json()' });
      };
      fn.json = function (prompt, opts) {
        window.__promptLog.push(prompt);
        return new Promise(function (resolve, reject) {
          setTimeout(function () {
            var mQ = prompt.match(/(\d+)라운드의 (\d+)번째 질문을 만드세요/);
            if (mQ) {
              var round = parseInt(mQ[1], 10), idx = parseInt(mQ[2], 10);
              resolve({
                kind: 'question',
                phase: idx <= 7 ? '탐색' : (idx <= 14 ? '전환' : '수렴'),
                isAssumptionFlip: (idx >= 8 && idx <= 14 && idx === 10),
                note: 'note-r' + round + '-' + idx,
                question: 'R' + round + 'Q' + idx + ' 첫 문장입니다. R' + round + 'Q' + idx + ' 두 번째 문장입니다.',
                answerType: (idx === 9) ? 'choice' : 'open',
                choices: (idx === 9) ? ['후보A', '후보B', '후보C'] : []
              });
              return;
            }
            if (prompt.indexOf('지금까지의 모든 답변을 종합') >= 0) {
              var rm = prompt.match(/"round":(\d+)/);
              var r = rm ? parseInt(rm[1], 10) : 1;
              var earlyStop = prompt.indexOf('다 채우지 않고') >= 0;
              var converged = earlyStop ? true : false;
              resolve({
                kind: 'synthesis', round: r, converged: converged,
                summary: r + '라운드 요약 첫 문장입니다. ' + r + '라운드 요약 두 번째 문장입니다.',
                goals: ['목표-r' + r + '-1', '목표-r' + r + '-2'],
                actionPlan: [{ step: '첫 단계', target: '대상', period: '2주', how: '방법', verify: '검증' }],
                missingFacts: converged ? [] : ['부족한사실1', '부족한사실2'],
                message: r + '라운드 코멘트입니다.'
              });
              return;
            }
            reject({ code: 'invalid_json', message: 'mock: no pattern matched' });
          }, 5);
        });
      };
      return Promise.resolve(fn);
    }
    if (name === 'downloads') {
      return Promise.resolve({
        save: function (req) { window.__lastDownload = req; return Promise.resolve({ status: 'saved' }); }
      });
    }
    return Promise.resolve(null);
  }
};

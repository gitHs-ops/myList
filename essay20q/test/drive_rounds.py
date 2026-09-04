"""
essay20q(index.html)를 헤드리스 브라우저로 실제 클릭해 가며 검증하는 회귀 테스트.

window.claude(Claude Artifact 런타임)는 claude.ai 밖에서는 존재하지 않으므로,
mock_claude.js 로 window.claude.use('sample'|'downloads') 를 흉내 낸다.
1라운드 20문항(선택형 1개 포함) -> 미수렴 종합 -> 2라운드 진입(이전 라운드 요약이
프롬프트에 실리는지 확인) -> 2라운드를 수렴 구간(15~20)까지 진행 -> 조기종료로
수렴 종합 -> 지난 라운드 UI·다운로드 파일 내용까지 확인한다.

사용법:
    pip install playwright
    python3 -m playwright install chromium   # 또는 이미 설치된 Chromium 경로를
                                              # CHROMIUM_PATH 환경변수로 지정
    python3 test/drive_rounds.py
"""
import os
import pathlib
from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).resolve().parent
html_path = HERE.parent / "index.html"
mock_path = HERE / "mock_claude.js"
url = "file://" + str(html_path)
CHROMIUM_PATH = os.environ.get("CHROMIUM_PATH")  # 비워두면 Playwright 기본 Chromium 사용


def log(m):
    print("[test]", m)


with sync_playwright() as p:
    launch_kwargs = {"headless": True}
    if CHROMIUM_PATH:
        launch_kwargs["executable_path"] = CHROMIUM_PATH
    browser = p.chromium.launch(**launch_kwargs)
    page = browser.new_page(viewport={"width": 900, "height": 1200})
    page.on("pageerror", lambda e: log(f"PAGEERROR: {e}"))
    page.on("console", lambda m: log(f"console:{m.type}: {m.text}") if m.type == "error" else None)
    page.on("dialog", lambda d: d.accept())

    page.add_init_script(path=str(mock_path))
    page.goto(url)
    page.wait_for_timeout(200)

    # ---- example fill / clear buttons ----
    assert page.locator("#topicInput").input_value() == ""
    page.click("#exampleFillBtn")
    page.wait_for_timeout(100)
    topic_val = page.locator("#topicInput").input_value()
    bg_val = page.locator("#backgroundInput").input_value()
    assert topic_val != "" and bg_val != "", "example fill button did not populate fields"
    log(f"example fill populated topic ({len(topic_val)} chars) and background ({len(bg_val)} chars)")
    assert page.locator("#startBtn").is_enabled(), "start button should enable from example content"

    page.click("#exampleClearBtn")
    page.wait_for_timeout(100)
    assert page.locator("#topicInput").input_value() == "", "example clear button did not clear topic"
    assert page.locator("#backgroundInput").input_value() == "", "example clear button did not clear background"
    assert not page.locator("#startBtn").is_enabled(), "start button should disable again after clearing"
    log("example fill/clear buttons verified")

    page.fill("#topicInput", "사이드 프로젝트를 올해 안에 수익화하고 싶다")
    page.fill("#backgroundInput", "주중 저녁 2시간 정도 시간을 낼 수 있고 예산은 200만원 이내다. 비슷한 서비스를 조사했지만 차별점을 못 찾았다.")
    page.wait_for_timeout(150)
    assert page.locator("#startBtn").is_enabled(), "start button should be enabled after filling fields"
    page.click("#startBtn")

    MAX_STEPS = 90
    step = 0
    round2_q1_prompt = None
    seen_choice_at = None
    checked_linebreak = False
    checked_converge_pill = False
    checked_linebreak_r2 = False
    checked_converge_pill_r2 = False

    while step < MAX_STEPS:
        step += 1
        page.wait_for_timeout(120)

        # settle: wait until neither loading nor asking/synthesizing leaves us in a transient state too long
        for _ in range(50):
            loading_visible = page.locator("#resultLoading").is_visible()
            if not loading_visible:
                break
            page.wait_for_timeout(100)

        err_visible = page.locator("#resultError").is_visible()
        if err_visible:
            txt = page.locator("#errorText").inner_text()
            raise AssertionError(f"Hit error state at step {step}: {txt}")

        q_visible = page.locator("#resultQuestion").is_visible()
        s_visible = page.locator("#resultSynthesis").is_visible()

        if q_visible:
            qnum = page.locator("#qNumLabel").inner_text()
            round_label = page.locator("#railRound").inner_text()
            is_choice = page.locator("#qChoiceBlock").is_visible()
            is_round2 = round_label.startswith("2라운드")

            if not checked_linebreak:
                qhtml = page.locator("#qText").inner_html()
                assert "<br>" in qhtml, f"expected <br> sentence break in multi-sentence question, got: {qhtml}"
                checked_linebreak = True
                log("sentence line-break (<br>) verified in question text (round 1)")
            if is_round2 and not checked_linebreak_r2:
                qhtml2 = page.locator("#qText").inner_html()
                assert "<br>" in qhtml2, f"round-2 question missing <br> sentence break, got: {qhtml2}"
                checked_linebreak_r2 = True
                log(f"sentence line-break (<br>) verified in round-2 question text ({qnum})")

            phase_now = page.locator("#qPhasePill").inner_text()
            if phase_now == "수렴":
                bg = page.evaluate("getComputedStyle(document.getElementById('qPhasePill')).backgroundColor")
                expected_var = page.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--accent-strong-tint').trim()")
                hexv = expected_var.lstrip('#')
                r, g, b = int(hexv[0:2], 16), int(hexv[2:4], 16), int(hexv[4:6], 16)
                expected_rgb = f"rgb({r}, {g}, {b})"
                assert bg == expected_rgb, f"수렴 pill background should be the light tint {expected_rgb}, got {bg}"
                if not checked_converge_pill:
                    checked_converge_pill = True
                    log(f"수렴 phase pill uses lighter tint background in round 1: {bg}")
                if is_round2 and not checked_converge_pill_r2:
                    checked_converge_pill_r2 = True
                    log(f"수렴 phase pill also uses lighter tint background in round 2 ({qnum}): {bg}")

            if is_round2 and round2_q1_prompt is None:
                round2_q1_prompt = page.evaluate("window.__promptLog[window.__promptLog.length - 1]")
                log(f"round2 Q1 captured, prompt length={len(round2_q1_prompt)}")

            early_stop_visible = page.get_attribute("#earlyStopRow", "hidden") is None
            # 2라운드가 자기 수렴 구간(>=16)까지 온 뒤에야 조기 종료 -- 그 구간도 실제로 거치게 한다.
            if is_round2 and early_stop_visible and checked_converge_pill_r2:
                log(f"round2 reached {qnum} (past 수렴 boundary), triggering early-stop synthesis")
                page.click("#earlyStopBtn")
                continue

            if is_choice:
                seen_choice_at = (round_label, qnum)
                chips = page.locator("#chipRow .chip")
                chips.nth(0).click()  # -> like
                chips.nth(1).click()  # -> like
                chips.nth(2).click(); chips.nth(2).click()  # -> like, dislike
                page.fill("#choiceFreeText", "추가 의견 테스트")
                assert page.locator("#submitChoiceBtn").is_enabled()
                page.click("#submitChoiceBtn")
            else:
                page.fill("#answerInput", f"{round_label} {qnum} 에 대한 테스트 답변입니다.")
                assert page.locator("#submitAnswerBtn").is_enabled()
                page.click("#submitAnswerBtn")
            continue

        if s_visible:
            round_tag = page.locator("#synthRoundTag").inner_text()
            converged_tag = page.locator("#synthConvergedTag").inner_text()
            log(f"synthesis shown: {round_tag} / {converged_tag}")
            has_continue = page.locator("#synthActions button:has-text('다음 라운드 계속하기')").count() > 0
            if has_continue:
                page.click("#synthActions button:has-text('다음 라운드 계속하기')")
                continue
            else:
                log("final synthesis reached (converged) -- stopping drive loop")
                break

        page.wait_for_timeout(150)

    else:
        raise AssertionError("drive loop exceeded MAX_STEPS without reaching a final converged synthesis")

    # ---- assertions on captured round-2 seed prompt ----
    assert round2_q1_prompt is not None, "never observed a round-2 question"
    assert "이전 라운드 요약" in round2_q1_prompt, "round-2 prompt missing prior-round seed block"
    assert "목표-r1-1" in round2_q1_prompt, "round-2 prompt missing round-1 goal text as seed"
    assert "1라운드 종합" in round2_q1_prompt, "round-2 prompt missing round-1 synthesis label"
    log("round-2 seed content verified in prompt")

    assert seen_choice_at is not None, "never exercised a choice-type question"
    log(f"choice-type question exercised at {seen_choice_at}")

    assert checked_linebreak and checked_converge_pill, "round-1 readability checks incomplete"
    assert checked_linebreak_r2 and checked_converge_pill_r2, "round-2 readability checks incomplete"
    log("round-1 and round-2 readability checks (line-break + pill color) confirmed")

    # ---- UI: prior-round history visible ----
    prior_hidden = page.get_attribute("#priorRoundsWrap", "hidden")
    assert prior_hidden is None, "prior rounds section should be visible once round 2 has happened"
    prior_summary = page.locator("#priorRoundsSummary").inner_text()
    assert "1개" in prior_summary
    page.click("#priorRoundsSummary")
    prior_text = page.locator("#priorRoundsList").inner_text()
    assert "1라운드 종합" in prior_text and "목표-r1-1" in prior_text
    log("prior-round UI content verified")

    # ---- download content ----
    page.click("#synthActions button:has-text('결과 다운로드')")
    page.wait_for_timeout(200)
    dl = page.evaluate("window.__lastDownload")
    assert dl is not None, "downloads.save was never called"
    data = dl["data"]
    log(f"download filename={dl['filename']} length={len(data)}")
    assert "이전 라운드 기록" in data and "1라운드 종합" in data, "download missing prior-round section"
    assert "R1Q1" in data, "download missing round-1 raw Q&A"

    log("ALL CHECKS PASSED")
    browser.close()

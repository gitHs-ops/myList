"""
essay20q(index.html)의 "개인 API 키" 경로(backend === 'apikey')를 검증하는 회귀 테스트.

window.claude 를 아예 정의하지 않아 Artifact 밖(GitHub Pages 등)에서 연 것과 같은
조건을 만들고, mock_fetch.js 로 window.fetch 를 가로채 https://api.anthropic.com 로
나가는 실제 요청의 URL·헤더·바디를 검증한 뒤 Anthropic Messages API 응답 모양의
더미 데이터를 돌려준다. 마크다운 코드펜스로 감싼 응답의 관대한 JSON 파싱, 401 에러
발생 시 재시도, 토큰 사용량 표시, Artifact 밖에서의 blob 다운로드까지 확인한다.

사용법: essay20q/test/drive_rounds.py 와 동일 (README 참고).
"""
import os
import pathlib
from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).resolve().parent
html_path = HERE.parent / "index.html"
mock_path = HERE / "mock_fetch.js"
url = "file://" + str(html_path)
CHROMIUM_PATH = os.environ.get("CHROMIUM_PATH")


def log(m):
    print("[apikey-test]", m)


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
    page.wait_for_timeout(400)  # initCapabilities() 는 claude.use() 실패를 기다렸다 확정한다

    # ---- window.claude 가 없을 때 API 키 카드가 실제로 나타나는지 ----
    apikey_hidden = page.get_attribute("#apiKeyCard", "hidden")
    assert apikey_hidden is None, "apiKeyCard should be visible when window.claude is absent"
    log("apiKeyCard visible (backend correctly falls back from artifact)")

    start_disabled_reason = page.locator("#startHint").inner_text()
    assert "API 키" in start_disabled_reason, f"start hint should mention API key setup, got: {start_disabled_reason}"

    # ---- 키 저장 ----
    page.fill("#apiKeyInput", "sk-ant-test-fake-key-for-testing-only")
    page.select_option("#apiModelSelect", "claude-sonnet-5")
    page.click("#apiKeySaveBtn")
    page.wait_for_timeout(100)
    status_text = page.locator("#apiKeyStatus").inner_text()
    assert "저장된 키를 사용합니다" in status_text and "Sonnet" in status_text, f"unexpected status: {status_text}"
    log(f"api key saved: {status_text}")

    # ---- 필드 채우고 시작 ----
    page.click("#exampleFillBtn")
    page.wait_for_timeout(100)
    assert page.locator("#startBtn").is_enabled(), "start button should now be enabled (key + fields present)"
    page.click("#startBtn")

    def wait_for_question(max_wait_steps=60):
        for _ in range(max_wait_steps):
            page.wait_for_timeout(120)
            if page.locator("#resultError").is_visible():
                return "error"
            if page.locator("#resultQuestion").is_visible():
                return "question"
            if page.locator("#resultSynthesis").is_visible():
                return "synthesis"
        raise AssertionError("timed out waiting for a visible result state")

    # ---- Q1: fetch 호출 모양 검증 ----
    state1 = wait_for_question()
    assert state1 == "question", f"expected question after start, got {state1}"
    fetch_log = page.evaluate("window.__fetchLog")
    assert len(fetch_log) == 1, f"expected exactly 1 fetch call for Q1, got {len(fetch_log)}"
    call0 = fetch_log[0]
    assert call0["url"] == "https://api.anthropic.com/v1/messages"
    assert call0["headers"]["x-api-key"] == "sk-ant-test-fake-key-for-testing-only"
    assert call0["headers"]["anthropic-version"] == "2023-06-01"
    assert call0["headers"]["anthropic-dangerous-direct-browser-access"] == "true"
    import json
    body0 = json.loads(call0["body"])
    assert body0["model"] == "claude-sonnet-5", f"expected selected model in request body, got {body0.get('model')}"
    assert "1라운드의 1번째 질문을 만드세요" in body0["messages"][0]["content"]
    log("fetch call headers/body verified for Q1 (model, x-api-key, browser-access header)")

    usage_text = page.locator("#usageInfo").inner_text()
    assert "입력" in usage_text and "$" in usage_text, f"usage display should show tokens/cost after first call, got: {usage_text}"
    log(f"usage display after Q1: {usage_text}")

    def answer_current_question():
        is_choice = page.locator("#qChoiceBlock").is_visible()
        if is_choice:
            chips = page.locator("#chipRow .chip")
            chips.nth(0).click()
            page.click("#submitChoiceBtn")
        else:
            page.fill("#answerInput", "테스트 답변입니다.")
            page.click("#submitAnswerBtn")

    # ---- Q1 -> Q2 ----
    answer_current_question()
    assert wait_for_question() == "question"

    # ---- Q2 -> Q3 (Q3 응답은 mock 이 마크다운 코드펜스로 감싼다: 관대한 파싱 확인) ----
    answer_current_question()
    assert wait_for_question() == "question"
    q3_text = page.locator("#qText").inner_text()
    assert "R1Q3" in q3_text, f"fenced JSON response should still parse into a real question, got: {q3_text}"
    log(f"fenced-JSON tolerant parsing verified: {q3_text[:40]}...")

    # ---- Q3 -> Q4 ----
    answer_current_question()
    assert wait_for_question() == "question"

    # ---- 강제로 401 에러를 내고 재시도가 복구되는지 확인 ----
    page.evaluate("window.__forceStatus = 401")
    answer_current_question()  # Q4 답변 제출 -> Q5 요청이 강제로 401
    state_after_401 = wait_for_question()
    assert state_after_401 == "error", f"expected error state after forced 401, got {state_after_401}"
    err_text = page.locator("#errorText").inner_text()
    assert "API 키" in err_text, f"401 should map to the bad_api_key message, got: {err_text}"
    assert not page.locator("#retryBtn").is_hidden(), "retry button should be offered for bad_api_key"
    log(f"401 correctly mapped to retryable error: {err_text}")

    page.click("#retryBtn")
    assert wait_for_question() == "question", "retry should succeed once __forceStatus is cleared"
    log("retry after 401 recovered successfully")

    # ---- Q5: earlyStopRow 로 조기 종료 ----
    qnum = page.locator("#qNumLabel").inner_text()
    assert "5/20" in qnum, f"expected to be at question 5, got {qnum}"
    early_hidden = page.get_attribute("#earlyStopRow", "hidden")
    assert early_hidden is None, "early-stop link should be visible from question 5"
    page.click("#earlyStopBtn")
    assert wait_for_question() == "synthesis"
    converged_tag = page.locator("#synthConvergedTag").inner_text()
    assert converged_tag == "수렴 완료", f"early-stop should be treated as converged, got {converged_tag}"
    log("early-stop synthesis reached via API-key backend")

    usage_text_final = page.locator("#usageInfo").inner_text()
    log(f"final usage display: {usage_text_final}")
    assert page.evaluate("window.__fetchLog.length") >= 6, "expected at least 6 real fetch calls across the flow"

    # ---- 다운로드가 downloadsCap 이 아니라 blob(<a download>) 경로로 가는지 ----
    page.click("#synthActions button:has-text('결과 다운로드')")
    page.wait_for_timeout(150)
    downloads = page.evaluate("window.__downloadLog")
    assert len(downloads) == 1, f"expected exactly one blob download attempt, got {downloads}"
    assert downloads[0]["filename"].endswith(".md")
    log(f"plain blob download path used (no window.claude present): {downloads[0]['filename']}")

    log("ALL API-KEY BACKEND CHECKS PASSED")
    browser.close()

"""
essay20q(index.html)의 "옵시디언으로 보내기" 기능을 검증하는 회귀 테스트.

두 부분으로 나뉜다:
  1) Artifact 모드(mock_claude.js, window.claude 존재)에서는 옵시디언 버튼이
     아예 나타나지 않아야 한다 -- Artifact sandbox 는 127.0.0.1 로의 fetch 를
     막으므로 이 기능은 개인 API 키 모드에서만 켠다.
  2) 개인 API 키 모드(mock_fetch.js, window.claude 없음)에서는 종합 결과 화면에
     버튼이 나타나고, 모달 열기/취소/빈 키 검증/저장 후 실제 PUT 요청(URL·헤더·
     프런트매터 포함 바디)·성공 상태 표시·HTTP 에러 상태 표시·연결 실패(TypeError)
     상태 표시까지 확인한다. mock_fetch.js 를 확장해 127.0.0.1:2712x 로 가는 요청도
     가로채도록 했다(window.__obsidianLog/__obsForceStatus/__obsForceNetworkError).

사용법: essay20q/test/drive_rounds.py 와 동일 (README 참고).
"""
import os
import pathlib
from urllib.parse import unquote
from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).resolve().parent
html_path = HERE.parent / "index.html"
url = "file://" + str(html_path)
CHROMIUM_PATH = os.environ.get("CHROMIUM_PATH")


def log(m):
    print("[obsidian-test]", m)


def launch_page(p, mock_filename):
    launch_kwargs = {"headless": True}
    if CHROMIUM_PATH:
        launch_kwargs["executable_path"] = CHROMIUM_PATH
    browser = p.chromium.launch(**launch_kwargs)
    page = browser.new_page(viewport={"width": 900, "height": 1200})
    page.on("pageerror", lambda e: log(f"PAGEERROR: {e}"))
    page.on("console", lambda m: log(f"console:{m.type}: {m.text}") if m.type == "error" else None)
    page.on("dialog", lambda d: d.accept())
    page.add_init_script(path=str(HERE / mock_filename))
    page.goto(url)
    page.wait_for_timeout(400)
    return browser, page


def wait_for_question_or_synthesis(page, max_wait_steps=60):
    for _ in range(max_wait_steps):
        page.wait_for_timeout(120)
        if page.locator("#resultError").is_visible():
            return "error"
        if page.locator("#resultQuestion").is_visible():
            return "question"
        if page.locator("#resultSynthesis").is_visible():
            return "synthesis"
    raise AssertionError("timed out waiting for a visible result state")


def answer_current_question(page):
    if page.locator("#qChoiceBlock").is_visible():
        page.locator("#chipRow .chip").nth(0).click()
        page.click("#submitChoiceBtn")
    else:
        page.fill("#answerInput", "테스트 답변입니다.")
        page.click("#submitAnswerBtn")


def drive_to_early_stop_synthesis(page):
    """Q5까지 답하고 earlyStopBtn 으로 조기 종합에 도달한다 (두 backend 공통)."""
    page.click("#exampleFillBtn")
    page.wait_for_timeout(100)
    page.click("#startBtn")
    assert wait_for_question_or_synthesis(page) == "question"
    for _ in range(4):
        answer_current_question(page)
        assert wait_for_question_or_synthesis(page) == "question"
    page.click("#earlyStopBtn")
    assert wait_for_question_or_synthesis(page) == "synthesis"


# ---------------------------------------------------------------- Part 1: artifact mode gating
with sync_playwright() as p:
    browser, page = launch_page(p, "mock_claude.js")
    drive_to_early_stop_synthesis(page)
    assert page.locator("#obsExportBtn").count() == 0, \
        "옵시디언 버튼은 Artifact 모드(backend==='artifact')에서는 절대 나타나면 안 된다 (CSP 로 fetch 가 막힘)"
    log("Artifact 모드: 옵시디언 버튼 미노출 확인 (게이팅 정상)")
    browser.close()

# ---------------------------------------------------------------- Part 2: apikey mode full flow
with sync_playwright() as p:
    browser, page = launch_page(p, "mock_fetch.js")

    page.fill("#apiKeyInput", "sk-ant-test-fake-key-for-testing-only")
    page.select_option("#apiModelSelect", "claude-sonnet-5")
    page.click("#apiKeySaveBtn")
    page.wait_for_timeout(100)

    drive_to_early_stop_synthesis(page)
    assert page.locator("#obsExportBtn").is_visible(), "개인 API 키 모드에서는 옵시디언 버튼이 보여야 한다"
    log("API 키 모드: 옵시디언 버튼 노출 확인")

    # ---- 모달 열기: 기본 서버 주소 확인 ----
    page.click("#obsExportBtn")
    page.wait_for_timeout(100)
    assert "show" in page.get_attribute("#obsModal", "class"), "버튼 클릭 시 모달이 열려야 한다"
    assert page.locator("#obsBase").input_value() == "http://127.0.0.1:27123", "기본 서버 주소가 맞아야 한다"
    log("모달 열림 + 기본 서버 주소 확인")

    # ---- 빈 키로 저장 시도: 배너 에러, 모달 유지 ----
    page.fill("#obsKey", "")
    page.click("#obsSaveBtn")
    page.wait_for_timeout(100)
    assert "show" in page.get_attribute("#obsModal", "class"), "키가 없으면 모달이 닫히면 안 된다"
    banner_text = page.locator("#obsBanner").inner_text()
    assert "API 키" in banner_text, f"빈 키 검증 배너가 나와야 하는데: {banner_text}"
    log(f"빈 키 검증 확인: {banner_text}")

    # ---- 정상 저장 -> 실제 PUT 요청 검증 ----
    page.fill("#obsFolder", "스무고개")
    page.fill("#obsKey", "test-obsidian-api-key")
    page.click("#obsSaveBtn")
    page.wait_for_timeout(200)
    assert "show" not in (page.get_attribute("#obsModal", "class") or ""), "저장 후 모달은 닫혀야 한다"

    obs_log = page.evaluate("window.__obsidianLog")
    assert len(obs_log) == 1, f"PUT 요청이 정확히 1번 나가야 하는데: {obs_log}"
    call0 = obs_log[0]
    assert call0["method"] == "PUT"
    assert call0["url"].startswith("http://127.0.0.1:27123/vault/"), f"URL이 vault 엔드포인트여야: {call0['url']}"
    decoded_url = unquote(call0["url"])
    assert "스무고개/에세이식_스무고개_1라운드_" in decoded_url, f"폴더명·파일명이 경로에 있어야: {decoded_url}"
    assert call0["headers"]["Authorization"] == "Bearer test-obsidian-api-key"
    assert call0["headers"]["Content-Type"] == "text/markdown; charset=utf-8"
    assert call0["body"].startswith("---\ntopic:"), f"프런트매터로 시작해야: {call0['body'][:60]}"
    assert "API 1라운드 요약" in call0["body"], "종합 요약 본문이 실제로 실려 있어야 한다"
    log(f"PUT 요청 검증 통과: {decoded_url}")
    log(f"본문 앞부분: {call0['body'][:120].splitlines()}")

    status_text = page.locator("#obsStatus").inner_text()
    assert "저장했습니다" in status_text, f"성공 상태 문구가 나와야: {status_text}"
    log(f"성공 상태 표시 확인: {status_text}")

    # ---- HTTP 에러(500) 경로 ----
    page.evaluate("window.__obsForceStatus = 500")
    page.click("#obsExportBtn")
    page.wait_for_timeout(100)
    # 이미 저장된 설정이 있으므로 키 입력칸이 채워져 있어야 한다
    assert page.locator("#obsKey").input_value() == "test-obsidian-api-key"
    page.click("#obsSaveBtn")
    page.wait_for_timeout(200)
    status_text_err = page.locator("#obsStatus").inner_text()
    assert "HTTP 500" in status_text_err, f"HTTP 500 에러가 상태에 반영돼야: {status_text_err}"
    log(f"HTTP 에러 상태 표시 확인: {status_text_err}")

    # ---- 연결 실패(TypeError) 경로 ----
    page.evaluate("window.__obsForceNetworkError = true")
    page.click("#obsExportBtn")
    page.wait_for_timeout(100)
    page.click("#obsSaveBtn")
    page.wait_for_timeout(200)
    status_text_net = page.locator("#obsStatus").inner_text()
    assert "연결하지 못했습니다" in status_text_net, f"연결 실패 메시지가 나와야: {status_text_net}"
    log(f"연결 실패 상태 표시 확인: {status_text_net}")

    assert page.evaluate("window.__obsidianLog.length") == 3, "총 PUT 시도(성공1 + HTTP에러1 + 성공한 재시도의 fetch자체는 성공) 확인"

    log("ALL OBSIDIAN EXPORT CHECKS PASSED")
    browser.close()

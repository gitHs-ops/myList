"""
essay20q(index.html)의 "개인 API 키로 사용하기" 카드에 붙은 접기/펼치기 토글 버튼을
검증하는 회귀 테스트.

window.claude 를 정의하지 않아 개인 API 키 카드가 나타나는 조건을 만든 뒤, 토글
버튼을 눌러 카드 본문(설명·입력창·모델 선택·저장 버튼)이 접히고 펼쳐지는지, 버튼
문구가 같이 바뀌는지, 접혀 있어도 상태 문구(#apiKeyStatus)는 계속 보이는지, 새로고침
후에도 접힌 상태가 localStorage 로 그대로 유지되는지 확인한다.

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
    print("[toggle-test]", m)


with sync_playwright() as p:
    launch_kwargs = {"headless": True}
    if CHROMIUM_PATH:
        launch_kwargs["executable_path"] = CHROMIUM_PATH
    browser = p.chromium.launch(**launch_kwargs)
    page = browser.new_page(viewport={"width": 900, "height": 900})
    page.on("pageerror", lambda e: log(f"PAGEERROR: {e}"))
    page.on("dialog", lambda d: d.accept())
    page.add_init_script(path=str(mock_path))
    page.goto(url)
    page.wait_for_timeout(400)

    # ---- 기본 상태: 저장된 설정 없음 -> 펼쳐져 있어야 한다 ----
    assert page.locator("#apiKeyCard").is_visible()
    assert not page.locator("#apiKeyCardBody").is_hidden(), "저장된 설정이 없으면 기본은 펼침 상태여야 한다"
    assert page.locator("#apiKeyToggleBtn").inner_text() == "간략히 보기"
    log("기본 상태: 펼쳐짐, 버튼 문구 '간략히 보기' 확인")

    # ---- 펼쳐진 상태에서 정상적으로 키 저장 ----
    page.fill("#apiKeyInput", "sk-ant-test-fake-key-for-toggle-test")
    page.click("#apiKeySaveBtn")
    page.wait_for_timeout(100)
    assert "저장된 키를 사용합니다" in page.locator("#apiKeyStatus").inner_text()
    log("키 저장 확인")

    # ---- 토글 클릭 -> 접힘, 입력창은 숨고 상태 문구는 계속 보임 ----
    page.click("#apiKeyToggleBtn")
    page.wait_for_timeout(100)
    assert page.locator("#apiKeyCardBody").is_hidden(), "토글 클릭 후 본문이 접혀야 한다"
    assert page.locator("#apiKeyToggleBtn").inner_text() == "자세히 보기"
    assert page.locator("#apiKeyInput").is_hidden(), "접힌 상태에서는 키 입력창이 보이면 안 된다"
    status_while_collapsed = page.locator("#apiKeyStatus").inner_text()
    assert "저장된 키를 사용합니다" in status_while_collapsed, \
        f"접혀 있어도 상태 문구는 계속 보여야: {status_while_collapsed}"
    log("토글 클릭: 본문 접힘 + 버튼 문구 전환 + 접힌 채로도 상태 문구 노출 확인")

    # ---- 새로고침 후에도 접힌 상태가 localStorage 로 유지되는지 ----
    page.reload()
    page.wait_for_timeout(400)
    assert page.locator("#apiKeyCardBody").is_hidden(), "새로고침 후에도 접힌 상태가 유지돼야 한다"
    assert page.locator("#apiKeyToggleBtn").inner_text() == "자세히 보기"
    log("새로고침 후 접힘 상태 유지(localStorage) 확인")

    # ---- 다시 펼치기 ----
    page.click("#apiKeyToggleBtn")
    page.wait_for_timeout(100)
    assert not page.locator("#apiKeyCardBody").is_hidden(), "토글을 다시 누르면 펼쳐져야 한다"
    assert page.locator("#apiKeyToggleBtn").inner_text() == "간략히 보기"
    log("재토글: 다시 펼쳐짐 확인")

    log("ALL API-KEY CARD TOGGLE CHECKS PASSED")
    browser.close()

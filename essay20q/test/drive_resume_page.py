"""
소개 페이지/설정 페이지 분리가 "이어서 진행하기" 흐름과 잘 맞물리는지 확인하는 회귀 테스트.

새 세션은 소개 페이지부터 보여야 하지만, 이미 진행 중이던 기록(localStorage)이 있는
채로 다시 열면 소개 페이지를 건너뛰고 곧장 설정 페이지 + "이어서 진행 중이던 세션이
있어요" 배너를 보여줘야 한다. "이어하기"를 누르면 실제로 이전 질문 화면이 그대로
복원되는지까지 확인한다.

사용법: essay20q/test/drive_rounds.py 와 동일 (README 참고).
"""
import os
import pathlib
from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).resolve().parent
html_path = HERE.parent / "index.html"
mock_path = HERE / "mock_claude.js"
url = "file://" + str(html_path)
CHROMIUM_PATH = os.environ.get("CHROMIUM_PATH")


def log(m):
    print("[resume-page-test]", m)


with sync_playwright() as p:
    launch_kwargs = {"headless": True}
    if CHROMIUM_PATH:
        launch_kwargs["executable_path"] = CHROMIUM_PATH
    browser = p.chromium.launch(**launch_kwargs)
    page = browser.new_page(viewport={"width": 900, "height": 1000})
    page.on("pageerror", lambda e: log(f"PAGEERROR: {e}"))
    page.on("dialog", lambda d: d.accept())
    page.add_init_script(path=str(mock_path))
    page.goto(url)
    page.wait_for_timeout(300)

    # ---- 새 세션: 소개 페이지부터 시작해야 한다 ----
    assert page.locator("#introPage").is_visible()
    assert page.get_attribute("#setupPage", "hidden") is not None
    assert page.get_attribute("#resumeBanner", "hidden") is not None, "진행 기록이 없으면 배너도 없어야 한다"
    log("새 세션: 소개 페이지만 보임, 배너 없음 확인")

    # ---- 설정 페이지로 넘어가 1문항까지 진행해 진행 기록을 만든다 ----
    page.click("#introStartBtn")
    page.wait_for_timeout(100)
    page.click("#exampleFillBtn")
    page.wait_for_timeout(100)
    page.click("#startBtn")

    for _ in range(60):
        page.wait_for_timeout(120)
        if page.locator("#resultQuestion").is_visible():
            break
    else:
        raise AssertionError("첫 질문이 나타나지 않았다")
    log("1번째 질문까지 진행해 진행 기록 생성")

    # ---- 새로고침: 소개 페이지를 건너뛰고 곧장 설정 페이지 + 배너가 보여야 한다 ----
    page.reload()
    page.wait_for_timeout(300)
    assert page.get_attribute("#introPage", "hidden") is not None, \
        "진행 기록이 있으면 소개 페이지를 건너뛰어야 한다"
    assert page.locator("#setupPage").is_visible(), "진행 기록이 있으면 곧장 설정 페이지가 보여야 한다"
    assert page.locator("#resumeBanner").is_visible(), "진행 기록이 있으면 이어하기 배너가 보여야 한다"
    log("새로고침 후 소개 페이지 건너뛰고 설정 페이지 + 배너 확인")

    # ---- "이어하기" -> 실제로 이전 질문이 복원되는지 ----
    page.click("#resumeContinueBtn")
    page.wait_for_timeout(200)
    assert page.get_attribute("#resumeBanner", "hidden") is not None, "이어하기 후 배너는 닫혀야 한다"
    assert page.locator("#resultQuestion").is_visible(), "이어하기 후 질문 화면이 복원돼야 한다"
    assert page.locator("#topicInput").input_value() != "", "이어하기 후 주제 입력값도 복원돼야 한다"
    log("이어하기: 배너 닫힘 + 질문 화면 복원 확인")

    log("ALL RESUME-PAGE-SPLIT CHECKS PASSED")
    browser.close()

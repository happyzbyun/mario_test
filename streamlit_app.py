"""마리오 스타일 게임 - Streamlit Cloud 진입점 (PRD 16장, F-54/F-55).

게임 본체는 index.html + style.css + *.js + assets/*.png 그대로다.
Streamlit 은 입력마다 스크립트를 다시 실행하는 구조라 60FPS 게임 루프를 파이썬으로 돌릴 수 없으므로,
기존 파일들을 한 개의 HTML 로 합쳐(CSS·JS 인라인, 이미지 data URI) iframe 컴포넌트로 띄운다.

로컬 실행:  streamlit run streamlit_app.py
"""
from __future__ import annotations

import base64
import re
from pathlib import Path

import streamlit as st
import streamlit.components.v1 as components

ROOT = Path(__file__).resolve().parent
ASSETS = ROOT / "assets"

# 게임을 이루는 파일 (변경되면 캐시를 새로 만든다)
GAME_FILES = [
    "index.html", "style.css",
    "map.js", "player.js", "enemy.js", "item.js", "storage.js", "game.js",
]

LINK_CSS = re.compile(r'<link\s+rel="stylesheet"\s+href="([^"]+)"\s*/?>')
SCRIPT_SRC = re.compile(r'<script\s+src="([^"]+)"\s*>\s*</script>')
ASSET_PNG = re.compile(r"assets/([\w-]+)\.png")


def _read(name: str) -> str:
    return (ROOT / name).read_text(encoding="utf-8")


def _png_data_uri(name: str) -> str | None:
    path = ASSETS / f"{name}.png"
    if not path.is_file():
        return None  # 없으면 원래 경로를 둔다 → 게임이 대체 도형으로 그린다 (F-34)
    return "data:image/png;base64," + base64.b64encode(path.read_bytes()).decode("ascii")


def _inline_assets(js: str) -> str:
    return ASSET_PNG.sub(lambda m: _png_data_uri(m.group(1)) or m.group(0), js)


def _safe_script(js: str) -> str:
    # 인라인 <script> 안에서 "</script" 가 나오면 태그가 끝나 버리므로 막아 둔다
    return js.replace("</script", "<\\/script")


def _files_signature() -> tuple:
    paths = [ROOT / f for f in GAME_FILES] + sorted(ASSETS.glob("*.png"))
    return tuple((p.name, p.stat().st_mtime_ns, p.stat().st_size) for p in paths if p.exists())


@st.cache_data(show_spinner=False)
def build_game_html(_signature: tuple) -> str:
    """index.html 을 기준으로 CSS·JS·이미지를 모두 인라인한 단일 HTML 을 만든다."""
    html = _read("index.html")
    html = LINK_CSS.sub(lambda m: f"<style>\n{_read(m.group(1))}\n</style>", html)
    html = SCRIPT_SRC.sub(
        lambda m: f"<script>\n{_safe_script(_inline_assets(_read(m.group(1))))}\n</script>", html
    )
    # iframe 안에서 처음 클릭하면 바로 키보드 입력을 받도록 포커스를 잡는다
    html = html.replace(
        "</body>",
        "<script>document.addEventListener('pointerdown', () => window.focus());</script>\n</body>",
    )
    return html


def main() -> None:
    st.set_page_config(page_title="마리오 스타일 게임", page_icon="🎮", layout="wide")

    with st.sidebar:
        st.header("조작법")
        st.markdown(
            "- **← →** 이동\n"
            "- **Space** 점프\n"
            "- **S** 또는 저장 버튼: 저장\n"
            "- **P / Esc** 일시정지\n"
            "- 메뉴: **↑ ↓ Enter** 또는 마우스 클릭"
        )
        st.header("휴대폰")
        st.markdown(
            "- 화면 왼쪽 아래 **◀ ▶** 버튼: 이동\n"
            "- 버튼 밖 화면 **터치**: 점프\n"
            "- 오른쪽 위 **저장**, **Ⅱ**(일시정지) 버튼\n"
            "- 가로 화면을 권장합니다"
        )
        st.divider()
        height = st.slider("게임 화면 높이(px)", min_value=360, max_value=900, value=560, step=20,
                           help="높이를 바꾸면 화면이 다시 그려지며 게임이 처음부터 시작됩니다. 저장 데이터는 유지됩니다.")
        st.caption("저장 데이터와 최고 기록은 이 브라우저에만 저장됩니다.")

    st.title("마리오 스타일 게임")
    st.caption("5개 스테이지, 각 500m. 버섯을 피하거나 밟고, 물음표 블록의 파워 열매로 커져서 GOAL까지 달려 보세요.")
    st.info("**PC**: 게임 화면을 한 번 클릭한 뒤 키보드로 조작하세요.  \n"
            "**휴대폰**: 화면의 ◀ ▶ 버튼으로 이동하고, 버튼 밖을 터치하면 점프합니다. (가로 화면 권장)", icon="🎮")

    html = build_game_html(_files_signature())
    try:
        components.html(html, height=height, scrolling=False, tab_index=0)
    except TypeError:  # tab_index 를 지원하지 않는 예전 Streamlit
        components.html(html, height=height, scrolling=False)


if __name__ == "__main__":
    main()

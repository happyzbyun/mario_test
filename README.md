# 마리오 스타일 게임

브라우저에서 바로 실행되는 2D 횡스크롤 플랫폼 게임입니다. (HTML5 Canvas + Vanilla JS, 외부 라이브러리 없음)

- 5개 스테이지(초록 들판 → 노을 사막 → 눈꽃 설원 → 달밤 숲 → 용암 성), 스테이지마다 500m
- 버섯은 밟으면 제거, 옆에서 닿으면 사망 / 물음표 블록의 파워 열매를 먹으면 커져서 한 번 더 버틸 수 있음
- 주인공 3종(아머 히어로, 핑크 토끼, 구름 강아지) — 모두 오리지널 디자인 (`assets/make_chars.py`로 생성)
- `localStorage` 저장/이어하기, 스테이지별·전체 최고 기록

## 조작

| 키 | 동작 |
|---|---|
| ← → | 이동 |
| Space | 점프 |
| S / 저장 버튼 | 저장 |
| P / Esc | 일시정지 |
| ↑ ↓ Enter, 마우스 | 메뉴 선택 |

**휴대폰·태블릿**: 화면 왼쪽 아래 **◀ ▶** 버튼으로 이동하고, 버튼 밖 화면을 **터치**하면 점프합니다. 이동 버튼을 누른 채 다른 손가락으로 점프할 수 있습니다. 오른쪽 위에 **저장**과 **Ⅱ**(일시정지) 버튼이 있습니다. 가로 화면을 권장합니다.

## 실행 방법

### 1. 파일로 바로 실행
`index.html`을 브라우저로 열면 됩니다. 설치가 필요 없습니다.

### 2. Streamlit으로 실행
```bash
pip install -r requirements.txt
streamlit run streamlit_app.py
```
`streamlit_app.py`는 게임 파일(`index.html`, `style.css`, `*.js`, `assets/*.png`)을 한 개의 HTML로 합쳐 Streamlit 화면 안에 띄웁니다. 게임 코드를 고치면 Streamlit 화면에도 그대로 반영됩니다.

## Streamlit Cloud 배포

1. 이 폴더 전체를 GitHub 저장소에 올립니다. (`streamlit_app.py`, `requirements.txt`가 저장소 루트에 있어야 합니다.)
2. [share.streamlit.io](https://share.streamlit.io)에서 **Create app** → 저장소와 브랜치를 고르고, **Main file path**에 `streamlit_app.py`를 입력한 뒤 **Deploy**를 누릅니다.
3. 배포된 페이지에서 게임 화면을 한 번 클릭한 뒤 키보드로 플레이합니다.

## 파일 구조

| 파일 | 내용 |
|---|---|
| `index.html`, `style.css` | 화면 구성 |
| `game.js` | 게임 루프, 상태 관리, 렌더링 |
| `player.js` / `enemy.js` / `item.js` | 주인공 / 버섯 / 파워 열매 |
| `map.js` | 5개 스테이지 맵 데이터, 카메라 |
| `storage.js` | 저장/불러오기 |
| `assets/` | 캐릭터 이미지와 생성 스크립트 |
| `streamlit_app.py`, `requirements.txt`, `.streamlit/` | Streamlit 배포 |
| `PRD.md`, `PROMPTS.md` | 요구사항 문서, 개발 단계 프롬프트 |
| `test/review.js` | Playwright 검토 스크립트 |

## 저작권

원작 게임의 이미지·캐릭터는 사용하지 않았습니다. 캐릭터, 버섯, 지형, 배경은 모두 직접 그린 오리지널 디자인입니다.

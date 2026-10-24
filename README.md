# taebo-games-crazyarcade

크레이지 아케이드 PC판(서비스 종료 직전 마지막 패치 00967)을 휴대폰 브라우저에서 하는 게임. 그래픽·맵·배경음악·효과음은
모두 PC 클라이언트 원본에서 뽑아 쓰고, 조작만 모바일판(크아M)처럼 터치 조이스틱과 물풍선 버튼으로 바꿨습니다.

- 게임: [`crazyarcade/`](crazyarcade/) (사이트 첫 화면은 `crazyarcade/`로 넘어갑니다)
- 원본 데이터: 비공개 저장소 `ceaser501/taebo-games-crazyarcade-assets` (`pc/PatchData`)
- 온라인 대전: Cloudflare Durable Objects 방 서버 (`server/`), 사이트와 같은 주소의 `/api` (`functions/`)

## 실행

```bash
npm install
npm run ca:assets -- ../taebo-games-crazyarcade-assets   # 원본 데이터 변환 (최초 1회, 1분 정도)
npm run build
npm start                                               # http://localhost:8080/crazyarcade/ (방 서버 포함)
npm test                                                # 모든 맵에서 컴퓨터끼리 대전시켜 보기
```

맵을 원본에서 다시 뽑으려면 `node crazyarcade/tools/build-maps.mjs ../taebo-games-crazyarcade-assets` (결과 `maps-data.js`는 저장소에 들어 있어 평소엔 필요 없음).

`npm start`는 `dist/`를 열고 `/api`를 Durable Object와 같은 방 로직(`RoomCore`)으로 흉내 냅니다. 창 두 개를 열면 혼자서
온라인 대전을 시험할 수 있고, `DEV_LAG=120 npm start`로 휴대폰 데이터처럼 지연을 줄 수 있습니다.
변환에는 `ffmpeg`가 있으면 소리를 MP3로 바꿉니다(아이폰은 원본 Ogg를 못 틉니다).

## 손으로 배포 (Cloudflare)

맥에서는 아래 한 줄이면 원본 데이터 받기(없으면 clone, 있으면 pull)·변환·빌드·방 서버 배포·사이트 배포까지 합니다.

```bash
npm run release
```

상점의 꾸미기(머리장식 772개, 물풍선 527개)와 탈것 그림은 마지막 패치에 없는 `CharTE`·`FxMonster` 팩에 있어서,
`npm run release`가 archive.org의 전체 설치본에서 필요한 부분만 받아 `crazyarcade/.cache/extra/`에 둡니다(처음 한 번 100MB 정도).
따로 받으려면 `node crazyarcade/tools/fetch-extra.mjs`.

처음 한 번은 `npx wrangler login`(브라우저 로그인)이 필요합니다. Pages 프로젝트 `taesu-crazyarcade`는 처음 실행할 때 만들어지고,
주소는 `https://taesu-crazyarcade.pages.dev`입니다. 소리를 아이폰에서도 틀려면 `brew install ffmpeg`가 있어야 합니다.

## 자동 배포 (GitHub Actions)

`main`에 푸시하면 `.github/workflows/deploy.yml`이 원본 데이터를 받아 변환·빌드한 뒤 방 서버(Worker
`taebo-crazyarcade-server`)를 먼저, 사이트(Pages 프로젝트 `taesu-crazyarcade`)를 다음에 배포합니다. 주소는
`https://taesu-crazyarcade.pages.dev`입니다. 저장소 Settings → Secrets and variables → Actions에 다음이 필요하며,
없으면 배포 단계는 건너뜁니다.

| 이름 | 내용 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API 토큰. 권한: Account › Workers Scripts: Edit, Account › Cloudflare Pages: Edit |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 계정 ID |
| `CA_ASSETS_TOKEN` | `ceaser501/taebo-games-crazyarcade-assets`를 읽을 수 있는 GitHub 토큰 (Contents: Read) |

손으로 올릴 때는 `npx wrangler login` 후 `npm run deploy:server && npm run deploy`.
비밀번호 화면을 걸고 싶으면 `SITE_PASSWORD='비밀번호' npm run build`로 빌드합니다(파일 주소를 알면 우회되는 간이 잠금).

Durable Objects는 무료 플랜에서도 SQLite 방식 클래스로 쓸 수 있습니다(`server/wrangler.toml`의 `new_sqlite_classes`).
방에 사람이 있는 동안만 깨어 있고, 무료 한도(하루 요청 10만, 실행 13,000 GB-초)는 친구끼리 하루 몇십 판에 충분합니다.

## 구조

| 파일 | 내용 |
|---|---|
| `crazyarcade/js/shared/sim.js` | 게임 규칙: 이동(모서리 미끄러짐), 물풍선, 물줄기, 연쇄, 갇힘·구출·터뜨리기, 아이템, 승패. 결정적(시드 난수) |
| `crazyarcade/js/shared/room.js` | 방: 8자리, 방장 설정(팀전/개인전, 맵), 준비, 컴퓨터 추가, 라운드 진행·스냅샷 전송 |
| `crazyarcade/js/shared/ai.js` | 컴퓨터 플레이어 (위험 지도 + 너비 우선 탐색) |
| `crazyarcade/js/shared/maps-data.js` | 원본 맵 파일(FxMap `Map/*`)에서 뽑은 대전 맵 122개: 칸·시작 위치·맵별 아이템 비율 그대로 (`crazyarcade/tools/build-maps.mjs`) |
| `crazyarcade/js/scene-game.js` | 게임 화면, 내 캐릭터 예측·보정, 다른 사람 보간, PC판 화면 그대로의 오른쪽 패널 |
| `crazyarcade/js/scene-menus.js` | 로그인(닉네임) → 로비(방 목록) → 대기방 (PC판 배경·버튼 그대로) |
| `crazyarcade/js/input.js` | 키보드 + 크아M식 터치 조작 |
| `crazyarcade/js/scene-shop.js` | 상점: 캐릭터·머리장식·물풍선·펫을 게임에서 모은 루찌로 사기, 착용 |
| `crazyarcade/js/wallet.js` | 루찌·보유·착용 (이 브라우저에 저장) |
| `crazyarcade/tools/ca-formats.mjs` | PatchData `.idx/.idd`, 암호화된 항목(맵·표) 풀기, 스프라이트, RLE 픽셀 해석 |
| `crazyarcade/tools/convert-assets.mjs` | 원본 → PNG 시트 + JSON, JPEG 배경, MP3/Ogg |
| `server/worker.js` | Durable Object `Room`(방마다 하나, 초당 30틱) · `Lobby`(방 목록) |

온라인 동기화: 방 서버가 게임을 초당 30번 계산하고 매 틱 상태를 보냅니다. 내 캐릭터는 같은 규칙 코드로 바로 움직이고
(입력 지연 없음), 서버 위치와의 차이를 왕복 시간만큼 되돌려 비교해 조금씩 맞춥니다. 다른 캐릭터는 3틱(0.1초) 늦게
그려서 두 스냅샷 사이를 보간합니다. 물풍선은 누르자마자 내 화면에 먼저 놓입니다.

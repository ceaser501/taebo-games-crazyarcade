# 맵 복원 도구 (개발용, Python)

공식 맵 데이터(`FxMap.idd`의 `Map/*`)는 고정 키로 암호화되어 있어 직접 읽지 못합니다. 대신 각 맵의
미리보기 이미지(`Etc/<맵>_mm`, 148×128, 암호화 안 됨)를 테마 타일과 칸마다 맞춰 보아 배치를 복원합니다.
결과물은 `crazyarcade/js/shared/maps-data.js` (저장소에 포함)이고, 게임을 빌드할 때는 이 도구가 필요 없습니다.

```bash
pip install pillow numpy
npm run ca:assets -- ../taebo-games-crazyarcade-assets     # 타일셋 PNG (CA_TILESETS=Tile00,... 로 전부 뽑기)
cd ../taebo-games-crazyarcade-assets/pc/PatchData            # (FxSound 등 분할 파일은 합친 뒤)
python mm.py OUT Village10 Patrit14 ...                     # 미리보기 PNG
python detect.py OUT/*.png                                   # 맵마다 맞는 타일셋 찾기
python recon.py Tile00 OUT/Village10.png OUT/Village10.json OUT/Village10_dbg.png
python buildmaps.py crazyarcade/js/shared/maps-data.js OUT/*.json
```

- `idx.py`, `sprite.py`, `rle.py`: `crazyarcade/tools/ca-formats.mjs`와 같은 포맷 해석 (Python판)
- `recon.py`: 아래 줄부터 위로, 이미 정한 아래쪽 키 큰 물체가 겹치는 것까지 그려 보며 칸마다 바닥×물체 조합 중
  가장 비슷한 것을 고릅니다. `_dbg.png`는 복원 결과(왼쪽)와 공식 미리보기(오른쪽)
- `buildmaps.py`: 물체 종류(부서짐/단단함/덤불), 여러 칸짜리 물체가 막는 칸, 시작 위치, 테마 배경음악을 붙여 표로 만듭니다.
  복원 오차가 큰 맵(다른 타일셋을 쓰는 맵 등)은 빼고 만듭니다.

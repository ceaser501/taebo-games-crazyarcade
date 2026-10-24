// One command from a Mac: fetch the original data, convert it, build and deploy.
//
//   npm run release
//
// The private data repo is looked for next to this repo and in the home folder, and cloned
// next to this repo when it is in neither place. Later runs just pull it.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const NAME = 'taebo-games-crazyarcade-assets';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const run = (cmd, cwd = root) => execSync(cmd, { cwd, stdio: 'inherit' });

const candidates = [path.resolve(root, '..', NAME), path.join(os.homedir(), NAME)];
let assets = candidates.find((dir) => fs.existsSync(path.join(dir, '.git')));
if (assets) {
  console.log(`\n▶ 원본 데이터 최신으로 받기: ${assets}`);
  run('git pull --ff-only origin main', assets);
} else {
  assets = candidates[0];
  console.log(`\n▶ 원본 데이터 받기 (600MB 정도, 처음 한 번만 오래 걸려요): ${assets}`);
  run(`git clone https://github.com/ceaser501/${NAME}.git "${assets}"`);
}

// Deploy only what is on GitHub: stop when this folder is behind or has its own edits.
console.log('\n▶ 게임 코드 확인');
const out = (cmd) => execSync(cmd, { cwd: root }).toString().trim();
// Compare with the same branch on GitHub (whichever branch this folder is on).
const branch = out('git rev-parse --abbrev-ref HEAD');
run(`git fetch -q origin ${branch}`);
const behind = Number(out(`git rev-list --count HEAD..origin/${branch}`));
// npm on another machine may rewrite package-lock.json; that changes nothing that ships.
const dirty = out('git status --porcelain --untracked-files=no -- . ":(exclude)package-lock.json"');
if (behind || dirty) {
  console.error(`\n배포를 멈췄어요. 이 폴더(${root})의 게임 코드가 GitHub 최신(${branch})이 아니에요.`);
  if (behind) console.error(`- 최신보다 ${behind}개 커밋 뒤에 있어요.`);
  if (dirty) console.error(`- 이 폴더에서 바뀐 파일이 있어요:\n${dirty}`);
  console.error(`\n최신으로 맞추려면(이 폴더에서 바꾼 내용은 사라져요):\n  git fetch origin ${branch} && git reset --hard origin/${branch}\n그다음 다시 npm run release`);
  process.exit(1);
}
console.log(`게임 코드 ${out('git rev-parse --short HEAD')} (최신)`);

try { execSync('ffmpeg -version', { stdio: 'ignore' }); } catch {
  console.warn('\n⚠ ffmpeg가 없어서 소리를 Ogg 그대로 올려요. 아이폰에서 소리가 안 나요. (brew install ffmpeg)');
}
console.log('\n▶ 꾸미기·탈것 그림 받기 (archive.org, 처음 한 번 100MB 정도)');
try { run('node crazyarcade/tools/fetch-extra.mjs'); } catch { console.warn('⚠ 받지 못해서 상점 꾸미기 없이 진행해요.'); }
console.log('\n▶ 변환');
run(`node crazyarcade/tools/convert-assets.mjs "${assets}"`);
console.log('\n▶ 빌드');
run('npx webpack --config webpack.config.prod.js');
console.log('\n▶ 방 서버 배포 (Durable Objects)');
run('npm run deploy:server');
console.log('\n▶ 사이트 배포');
// The first run creates the Pages project; later runs find it already there.
try { execSync('npx -y wrangler@3 pages project create taesu-crazyarcade --production-branch main', { cwd: root, stdio: 'ignore' }); } catch { /* exists */ }
run('npm run deploy');
console.log('\n완료: https://taesu-crazyarcade.pages.dev');

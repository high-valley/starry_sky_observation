// 公開する画面の通し確認：はじめの画面 → 指でなぞるモード → 星空・時刻・設定・バージョン欄。
// ビルド結果を配信して実行する（CI では vite preview）。手元: npm run build && npm run preview のあと
//   node tests-e2e/smoke.mjs        （APP_URL で確認先を変えられる。公開画面も確かめられる）
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');

const URL0 = process.env.APP_URL ?? 'http://127.0.0.1:4173/';
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ja-JP', timezoneId: 'Asia/Tokyo',
  geolocation: { latitude: 35.68, longitude: 139.77 }, permissions: ['geolocation'],
});
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
p.on('requestfailed', (r) => { if (!/fonts\.(googleapis|gstatic)/.test(r.url())) errors.push(`読み込み失敗 ${r.url()}`); });
const ok = (c, msg) => { if (!c) throw new Error(`FAIL: ${msg}`); console.log(`ok: ${msg}`); };

await p.goto(URL0);
await p.waitForFunction(() => /空/.test(document.querySelector('#allsky-caption')?.textContent ?? '') && !/計算しています/.test(document.querySelector('#allsky-caption').textContent));
ok(true, 'はじめの画面に全天図が出る');

// 全天図に星が描かれている（真っ暗ではない）
const lit = await p.evaluate(() => {
  const c = document.getElementById('allsky');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] > 200) n++;
  return n;
});
ok(lit > 200, `全天図に明るい点がある（${lit}px）`);

await p.click('#start-manual');
await p.waitForSelector('#start', { state: 'hidden' });
await p.waitForFunction(() => document.getElementById('dir-name').textContent !== '—');
ok(true, `星空の画面に切り替わる（${await p.textContent('#dir-name')}）`);

// 北を向くと北極星、高度は緯度くらい
await p.evaluate(() => { const s = window.__sky.state; s.manualAz = 0; s.manualAlt = 35; s.fov = 60; });
await p.waitForTimeout(400);
ok((await p.textContent('#dir-name')) === '北', '北を向ける');
ok((await p.textContent('#target')).includes('北極星'), '北・高度35°の照準の先に北極星がある');

// 時刻を今夜21時に
await p.click('[data-sheet="time-sheet"]');
await p.click('#time-tonight');
ok(/21:00/.test(await p.textContent('#time-chip')), `今夜21時に変えられる（${await p.textContent('#time-chip')}）`);
await p.click('#time-now');
ok(/今$/.test((await p.textContent('#time-chip')).trim()), '今に戻せる');
await p.click('#time-sheet .sheet-close');

// 設定のバージョン欄（ビルドでは version.json と同じ ID）
await p.click('[data-sheet="settings-sheet"]');
const id = (await p.textContent('#version-panel .version-id')).trim();
const remote = await p.evaluate(async () => (await (await fetch('version.json', { cache: 'no-store' })).json()).id).catch(() => null);
ok(id && id !== 'dev' && id === remote, `バージョン ${id} が version.json と一致する`);
await p.waitForFunction(() => /最新版です/.test(document.querySelector('#version-panel .version-status').textContent));
ok(true, '最新版の確認ができる');

ok((await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0, 'スマホ幅で横にはみ出さない');
ok(errors.length === 0, `エラーなし${errors.length ? `：${errors.join(' / ')}` : ''}`);
await browser.close();

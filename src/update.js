// 「最新版か」の確認と、新しいバージョンがあるときの帯・設定画面のバージョン欄。
// 判定そのものは version.js（画面に依存しない）にあり、ここは画面への表示だけを受け持つ。
import { CURRENT, DEV_ID, applyUpdate, fetchLatest, formatBuiltAt, isNewer, stripUpdateParam } from './version.js';

const update = { status: CURRENT.id === DEV_ID ? 'dev' : 'idle', latest: null, checkedAt: 0, dismissed: null };
let checking = false;

const hhmm = (ms) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** 設定画面のバージョン欄 */
function renderPanel() {
  const panel = document.getElementById('version-panel');
  if (!panel) return;
  const built = formatBuiltAt(CURRENT.builtAt);
  panel.querySelector('.version-id').textContent = CURRENT.id;
  panel.querySelector('.version-built').textContent = built ? `（${built} ビルド）` : '';
  panel.querySelector('.version-status').textContent = {
    checking: '確認しています…',
    latest: `最新版です（${update.checkedAt ? `${hhmm(update.checkedAt)} 確認` : ''}）`,
    available: `新しいバージョンがあります（${CURRENT.id} → ${update.latest?.id}）`,
    error: '確認できませんでした。通信を確認してください',
    dev: '開発中のため、確認しません',
    idle: '',
  }[update.status];
  panel.classList.toggle('has-update', update.status === 'available');
  const button = panel.querySelector('button');
  button.textContent = update.status === 'available' ? '更新する' : '最新版を確認';
  button.disabled = update.status === 'checking' || update.status === 'dev';
}

/** 画面の上に出す「新しいバージョンがあります」の帯 */
function renderBanner() {
  let bar = document.getElementById('update-banner');
  const show = update.status === 'available' && update.dismissed !== update.latest?.id;
  document.body.classList.toggle('has-update-banner', show);
  if (!show) return bar?.remove();
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'update-banner';
    bar.setAttribute('role', 'status');
    document.body.prepend(bar);
  }
  const text = document.createElement('span');
  text.textContent = '新しいバージョンがあります';
  const go = document.createElement('button');
  go.className = 'pill primary-pill';
  go.textContent = '更新する';
  go.onclick = () => applyUpdate(update.latest);
  const later = document.createElement('button');
  later.className = 'pill';
  later.textContent = 'あとで';
  later.onclick = () => { update.dismissed = update.latest?.id; renderBanner(); };
  bar.replaceChildren(text, go, later);
}

function render() {
  renderPanel();
  renderBanner();
}

/** サーバーの version.json と比べる。manual=true は、ボタンから押したとき（確認中・失敗も画面に出す） */
export async function checkUpdate(manual) {
  if (CURRENT.id === DEV_ID || checking) return;
  checking = true;
  if (manual) { update.status = 'checking'; render(); }
  const latest = await fetchLatest();
  checking = false;
  update.checkedAt = Date.now();
  if (!latest) { if (manual || update.status === 'checking') update.status = 'error'; }
  else if (isNewer(CURRENT, latest)) Object.assign(update, { status: 'available', latest });
  else Object.assign(update, { status: 'latest', latest });
  render();
}

/** 開いたとき・5分ごと・画面に戻ってきたとき（前回から1分以上たっていれば）に、自動で確認する */
export function watchUpdates() {
  // 更新後に URL に残った目印 _v を消す
  const clean = stripUpdateParam(location.href);
  if (clean) history.replaceState(null, '', clean);

  document.querySelector('#version-panel button')?.addEventListener('click', () => {
    if (update.status === 'available') applyUpdate(update.latest);
    else checkUpdate(true);
  });
  render();
  checkUpdate(false);
  setInterval(() => checkUpdate(false), 5 * 60_000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - update.checkedAt > 60_000) checkUpdate(false);
  });
}

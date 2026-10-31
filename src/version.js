/**
 * 「最新版か」の確認と更新。画面に埋め込んだビルドの目印（__BUILD_ID__）と、
 * サーバーに置かれた version.json の目印を比べる。画面にも Firebase にも依存しない部分だけを置く。
 */

/** @typedef {{id: string, builtAt: string|null}} Version */

/** 開発中（vite dev）は、更新の確認をしない */
export const DEV_ID = 'dev';

/** この画面が読み込まれたときのバージョン */
export const CURRENT = /** @type {Version} */ ({
  id: typeof __BUILD_ID__ === 'undefined' ? DEV_ID : __BUILD_ID__,
  builtAt: typeof __BUILD_TIME__ === 'undefined' ? null : __BUILD_TIME__,
});

/**
 * サーバー上の最新のバージョンを取る。キャッシュは使わない。取れなかったら null。
 * @param {{fetch?: typeof fetch, baseUrl?: string, now?: () => number}} [deps]
 */
export async function fetchLatest({ fetch: f = globalThis.fetch, baseUrl = globalThis.document?.baseURI ?? '', now = Date.now } = {}) {
  try {
    const url = new URL('version.json', baseUrl);
    url.searchParams.set('t', String(now())); // 途中のキャッシュにも当たらないように
    const res = await f(url, { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data?.id === 'string' && data.id ? { id: data.id, builtAt: data.builtAt ?? null } : null;
  } catch {
    return null;
  }
}

/** 最新のほうが新しい（＝更新できる）か。開発中・取得失敗のときは false */
export function isNewer(current, latest) {
  return !!latest && current.id !== DEV_ID && latest.id !== current.id;
}

/** 「2026/10/29 15:04」のような表示（ブラウザのタイムゾーン）。なければ空 */
export function formatBuiltAt(iso) {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 更新後の読み込み先：今のURL（ルームなどはそのまま）に、キャッシュを避けるための目印 _v を付ける */
export function updateUrl(href, latestId) {
  const url = new URL(href);
  url.searchParams.set('_v', latestId);
  return url.toString();
}

/** 更新後に URL に残った _v を取り除く（ルームのURLなどをきれいに保つ） */
export function stripUpdateParam(href) {
  const url = new URL(href);
  if (!url.searchParams.has('_v')) return null;
  url.searchParams.delete('_v');
  return url.pathname + url.search + url.hash;
}

/** 保存されているキャッシュを消してから、最新版を読み込み直す */
export async function applyUpdate(latest, { location = globalThis.location, caches = globalThis.caches, serviceWorker = globalThis.navigator?.serviceWorker } = {}) {
  try {
    if (caches?.keys) await Promise.all((await caches.keys()).map((k) => caches.delete(k)));
    if (serviceWorker?.getRegistrations) await Promise.all((await serviceWorker.getRegistrations()).map((r) => r.unregister()));
  } catch { /* 消せなくても読み込み直しはする */ }
  location.replace(updateUrl(location.href, latest.id));
}

import { describe, expect, it, vi } from 'vitest';
import { applyUpdate, fetchLatest, formatBuiltAt, isNewer, stripUpdateParam, updateUrl } from '../src/version.js';

const res = (body, ok = true) => ({ ok, json: async () => body });

describe('fetchLatest', () => {
  it('version.json を、キャッシュを使わずに取る', async () => {
    const f = vi.fn(async () => res({ id: 'abc1234', builtAt: '2026-10-29T06:00:00.000Z' }));
    const v = await fetchLatest({ fetch: f, baseUrl: 'https://example.com/cards/', now: () => 111 });
    expect(v).toEqual({ id: 'abc1234', builtAt: '2026-10-29T06:00:00.000Z' });
    const [url, opts] = f.mock.calls[0];
    expect(String(url)).toBe('https://example.com/cards/version.json?t=111');
    expect(opts.cache).toBe('no-store');
  });
  it('取れない・壊れているときは null', async () => {
    expect(await fetchLatest({ fetch: async () => res({}, false), baseUrl: 'https://x.test/' })).toBeNull();
    expect(await fetchLatest({ fetch: async () => res({ nope: 1 }), baseUrl: 'https://x.test/' })).toBeNull();
    expect(await fetchLatest({ fetch: async () => res({ id: '' }), baseUrl: 'https://x.test/' })).toBeNull();
    expect(await fetchLatest({ fetch: async () => { throw new Error('offline'); }, baseUrl: 'https://x.test/' })).toBeNull();
  });
});

describe('isNewer', () => {
  it('目印が違えば更新できる。同じなら最新', () => {
    expect(isNewer({ id: 'a1' }, { id: 'b2' })).toBe(true);
    expect(isNewer({ id: 'a1' }, { id: 'a1' })).toBe(false);
  });
  it('取得に失敗したとき（null）・開発中は、更新ありとしない', () => {
    expect(isNewer({ id: 'a1' }, null)).toBe(false);
    expect(isNewer({ id: 'dev' }, { id: 'b2' })).toBe(false);
  });
});

describe('formatBuiltAt', () => {
  it('日時を読みやすく。なければ空', () => {
    expect(formatBuiltAt('2026-10-29T06:05:00.000Z')).toMatch(/^2026\/10\/29 \d{2}:05$/);
    expect(formatBuiltAt(null)).toBe('');
    expect(formatBuiltAt('ばらばら')).toBe('');
  });
});

describe('更新用のURL', () => {
  it('今のURL（ルーム）を保ったまま、_v を付ける', () => {
    expect(updateUrl('https://x.test/cards/?room=abc', 'b2')).toBe('https://x.test/cards/?room=abc&_v=b2');
    expect(updateUrl('https://x.test/cards/', 'b2')).toBe('https://x.test/cards/?_v=b2');
  });
  it('2回目の更新でも _v は1つだけ', () => {
    expect(updateUrl('https://x.test/cards/?_v=old&room=abc', 'new')).toBe('https://x.test/cards/?_v=new&room=abc');
  });
  it('読み込み後に _v だけを取り除く', () => {
    expect(stripUpdateParam('https://x.test/cards/?room=abc&_v=b2')).toBe('/cards/?room=abc');
    expect(stripUpdateParam('https://x.test/cards/?_v=b2')).toBe('/cards/');
    expect(stripUpdateParam('https://x.test/cards/?room=abc')).toBeNull();
  });
});

describe('applyUpdate', () => {
  it('キャッシュと Service Worker を消してから、新しいURLへ移る', async () => {
    const deleted = [];
    const unregistered = [];
    const location = { href: 'https://x.test/cards/?room=r1', replace: vi.fn() };
    await applyUpdate(
      { id: 'b2' },
      {
        location,
        caches: { keys: async () => ['c1', 'c2'], delete: async (k) => deleted.push(k) },
        serviceWorker: { getRegistrations: async () => [{ unregister: async () => unregistered.push(1) }] },
      },
    );
    expect(deleted).toEqual(['c1', 'c2']);
    expect(unregistered).toHaveLength(1);
    expect(location.replace).toHaveBeenCalledWith('https://x.test/cards/?room=r1&_v=b2');
  });
  it('キャッシュが使えない環境でも、読み込み直しはする', async () => {
    const location = { href: 'https://x.test/', replace: vi.fn() };
    await applyUpdate({ id: 'b2' }, { location, caches: undefined, serviceWorker: undefined });
    expect(location.replace).toHaveBeenCalled();
  });
  it('キャッシュを消すのに失敗しても、読み込み直しはする', async () => {
    const location = { href: 'https://x.test/', replace: vi.fn() };
    await applyUpdate({ id: 'b2' }, { location, caches: { keys: async () => { throw new Error('denied'); } } });
    expect(location.replace).toHaveBeenCalled();
  });
});

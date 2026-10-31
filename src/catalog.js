// 星データの読み込みと前処理（J2000 単位ベクトルに変換）
import { raDecToVec } from './astro.js';

// B-V 色指数 → 表示色（色温度の目安を見やすく誇張しすぎない程度に）
const BV_COLORS = [
  [-0.4, [155, 178, 255]],
  [0.0, [202, 216, 255]],
  [0.3, [240, 242, 255]],
  [0.6, [255, 246, 228]],
  [1.0, [255, 222, 182]],
  [1.5, [255, 196, 140]],
  [2.0, [255, 168, 104]],
];

export function bvToRgb(bv) {
  if (bv <= BV_COLORS[0][0]) return BV_COLORS[0][1];
  for (let i = 1; i < BV_COLORS.length; i++) {
    const [b1, c1] = BV_COLORS[i];
    if (bv <= b1) {
      const [b0, c0] = BV_COLORS[i - 1];
      const t = (bv - b0) / (b1 - b0);
      return c0.map((c, k) => Math.round(c + (c1[k] - c) * t));
    }
  }
  return BV_COLORS[BV_COLORS.length - 1][1];
}

export async function loadCatalog(base = './data/') {
  const [stars, cons, names] = await Promise.all(
    ['stars.json', 'constellations.json', 'starnames.json'].map((f) =>
      fetch(base + f).then((r) => {
        if (!r.ok) throw new Error(`${f} を読み込めませんでした (${r.status})`);
        return r.json();
      })),
  );

  const n = stars.length;
  const vec = new Float32Array(n * 3);
  const mag = new Float32Array(n);
  const color = new Array(n);
  stars.forEach(([ra, dec, m, bv], i) => {
    const v = raDecToVec(ra, dec);
    vec.set(v, i * 3);
    mag[i] = m;
    const [r, g, b] = bvToRgb(bv);
    color[i] = `rgb(${r},${g},${b})`;
  });

  const constellations = cons.map((c) => ({
    id: c.id, ja: c.ja, en: c.en, rank: c.rank,
    label: raDecToVec(c.ra, c.dec),
    lines: c.lines.map((seg) => seg.map(([ra, dec]) => raDecToVec(ra, dec))),
  }));
  const conById = Object.fromEntries(constellations.map((c) => [c.id, c]));

  const named = names.map((s) => ({
    ...s,
    vec: raDecToVec(s.ra, s.dec),
    conJa: conById[s.con] ? conById[s.con].ja : '',
    rgb: color[stars.findIndex((t) => t[0] === s.ra && t[1] === s.dec)] || '#fff',
  }));

  return { count: n, vec, mag, color, constellations, named };
}

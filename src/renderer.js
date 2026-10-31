// Canvas 描画。透視（心射）図法なので、大円（地平線・星座線）は画面上で直線になる。
import { DEG, matMul, matVec, dot, directionName } from './astro.js';

export const COLORS = {
  sky: '#14204a',
  skyDeep: '#0c1433',
  star: '#fff3d6',
  line: 'rgba(157,176,255,0.55)',
  lineCam: 'rgba(190,205,255,0.85)',
  conName: 'rgba(196,208,255,0.9)',
  starName: 'rgba(255,243,214,0.92)',
  ground: 'rgba(36,26,52,0.62)',
  groundCam: 'rgba(36,26,52,0.28)',
  horizon: 'rgba(244,198,78,0.85)',
  grid: 'rgba(157,176,255,0.16)',
  accent: '#f4c64e',
};

const FONT_SKY = '"Shippori Mincho", "Hiragino Mincho ProN", "Yu Mincho", serif';
const FONT_UI = '"Zen Kaku Gothic New", "Hiragino Sans", "Noto Sans JP", sans-serif';
const CARDINALS = [
  [0, '北'], [45, '北東'], [90, '東'], [135, '南東'], [180, '南'], [225, '南西'], [270, '西'], [315, '北西'],
];

export class SkyRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = 1;
    this.w = 0;
    this.h = 0;
    this.hits = [];
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (w === this.w && h === this.h && dpr === this.dpr) return;
    this.w = w; this.h = h; this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
  }

  /**
   * @param {object} p
   *   frame: observerFrame の結果, basis: {f,u,r}, fov: 縦の視野角[deg],
   *   catalog, bodies, opts: {camera, lines, names, grid}
   */
  draw(p) {
    this.resize();
    const { ctx, w, h } = this;
    const { frame, basis, fov, catalog, bodies, opts } = p;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    this.hits = [];

    // 投影パラメータ
    const focal = h / 2 / Math.tan((fov / 2) * DEG);
    const cx = w / 2, cy = h / 2;
    const B = [...basis.r, ...basis.u, ...basis.f];
    const camJ2000 = matMul(B, frame.j2000ToEnu);
    const upJ2000 = frame.j2000ToEnu.slice(6, 9); // 天頂成分（地平線より下の判定用）
    this.proj = { focal, cx, cy, B };

    if (!opts.camera) {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, COLORS.skyDeep);
      g.addColorStop(1, COLORS.sky);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    } else {
      // 実際の空の上でも星が読めるよう、ごく薄く夜の色を重ねる
      ctx.fillStyle = 'rgba(12,20,51,0.38)';
      ctx.fillRect(0, 0, w, h);
    }

    const project = (cam) => {
      if (cam[2] <= 1e-4) return null;
      return [cx + (cam[0] / cam[2]) * focal, cy - (cam[1] / cam[2]) * focal];
    };
    this.project = (enu) => project(matVec(B, enu));
    const projectJ = (v) => project(matVec(camJ2000, v));

    if (opts.grid) this.drawAltGrid(B, focal, cx, cy);

    // ---- 星座線
    if (opts.lines) {
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = opts.camera ? COLORS.lineCam : COLORS.line;
      ctx.beginPath();
      for (const c of catalog.constellations) {
        for (const seg of c.lines) {
          let prev = matVec(camJ2000, seg[0]);
          for (let i = 1; i < seg.length; i++) {
            const cur = matVec(camJ2000, seg[i]);
            this.segment(prev, cur, focal, cx, cy);
            prev = cur;
          }
        }
      }
      ctx.stroke();
    }

    // ---- 恒星（等級順に並んでいるので、限界等級で打ち切り）
    const limit = Math.min(6.0, 4.6 + Math.max(0, (60 - fov) / 30));
    const scale = Math.max(0.85, Math.min(1.8, 60 / fov)) * (opts.camera ? 1.15 : 1);
    const { vec, mag, color, count } = catalog;
    const m = camJ2000;
    for (let i = 0; i < count; i++) {
      const mg = mag[i];
      if (mg > limit) break;
      const x = vec[i * 3], y = vec[i * 3 + 1], z = vec[i * 3 + 2];
      const cz = m[6] * x + m[7] * y + m[8] * z;
      if (cz <= 0) continue;
      const sx = cx + ((m[0] * x + m[1] * y + m[2] * z) / cz) * focal;
      const sy = cy - ((m[3] * x + m[4] * y + m[5] * z) / cz) * focal;
      if (sx < -10 || sx > w + 10 || sy < -10 || sy > h + 10) continue;
      const below = upJ2000[0] * x + upJ2000[1] * y + upJ2000[2] * z < 0;
      const r = Math.max(0.95, (limit + 1.0 - mg) * 0.62) * scale;
      ctx.globalAlpha = below ? 0.35 : Math.min(1, 0.6 + (limit - mg) * 0.2);
      if (mg < 1.6) {
        const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, r * 3.2);
        g.addColorStop(0, color[i]);
        g.addColorStop(0.3, color[i]);
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(sx, sy, r * 3.2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = color[i];
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;

    // ---- 地面（地平線より下）
    this.drawGround(B, focal, cx, cy, opts.camera);

    // ---- 星座名
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (opts.names) {
      ctx.font = `500 ${fov > 80 ? 13 : 15}px ${FONT_SKY}`;
      for (const c of catalog.constellations) {
        const s = projectJ(c.label);
        if (!s || s[0] < -40 || s[0] > w + 40 || s[1] < -20 || s[1] > h + 20) continue;
        if (fov > 90 && c.rank > 2) continue;
        this.text(c.ja, s[0], s[1], COLORS.conName, opts.camera);
        this.hits.push({ kind: 'constellation', x: s[0], y: s[1], r: 30, obj: c });
      }
    }

    // ---- 明るい星の名前
    const nameLimit = fov > 80 ? 1.6 : fov > 45 ? 2.1 : 2.6;
    ctx.font = `400 12px ${FONT_SKY}`;
    ctx.textAlign = 'left';
    for (const s of catalog.named) {
      const p2 = projectJ(s.vec);
      if (!p2 || p2[0] < -20 || p2[0] > w + 20 || p2[1] < -20 || p2[1] > h + 20) continue;
      this.hits.push({ kind: 'star', x: p2[0], y: p2[1], r: 26, obj: s });
      if (opts.names && s.mag <= nameLimit) this.text(s.ja, p2[0] + 8, p2[1] - 8, COLORS.starName, opts.camera);
    }

    // ---- 太陽・月・惑星
    for (const b of bodies) this.drawBody(b, focal, opts.camera);

    // ---- 地平線と方位
    this.drawHorizon(B, focal, cx, cy);
  }

  /** カメラ座標の 2 点を結ぶ（手前側にクリップ） */
  segment(a, b, focal, cx, cy) {
    const near = 0.01;
    if (a[2] < near && b[2] < near) return;
    if (a[2] < near || b[2] < near) {
      const t = (near - a[2]) / (b[2] - a[2]);
      const c = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, near];
      if (a[2] < near) a = c; else b = c;
    }
    const ctx = this.ctx;
    ctx.moveTo(cx + (a[0] / a[2]) * focal, cy - (a[1] / a[2]) * focal);
    ctx.lineTo(cx + (b[0] / b[2]) * focal, cy - (b[1] / b[2]) * focal);
  }

  text(str, x, y, color, onCamera) {
    const ctx = this.ctx;
    if (onCamera) {
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(12,20,51,0.75)';
      ctx.strokeText(str, x, y);
    }
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
  }

  /** 地平面より下を塗る: 画面上の点 (x,y) の視線 = r*X + u*Y + f, 地面は上向き成分 < 0 */
  drawGround(B, focal, cx, cy, onCamera) {
    const { ctx, w, h } = this;
    const nx = B[2], ny = B[5], nz = B[8]; // 各基底ベクトルの天頂成分
    const side = (px, py) => nx * ((px - cx) / focal) + ny * ((cy - py) / focal) + nz;
    const rect = [[0, 0], [w, 0], [w, h], [0, h]];
    const poly = [];
    for (let i = 0; i < 4; i++) {
      const a = rect[i], b = rect[(i + 1) % 4];
      const sa = side(...a), sb = side(...b);
      if (sa < 0) poly.push(a);
      if ((sa < 0) !== (sb < 0)) {
        const t = sa / (sa - sb);
        poly.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    }
    if (poly.length < 3) return;
    ctx.fillStyle = onCamera ? COLORS.groundCam : COLORS.ground;
    ctx.beginPath();
    poly.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fill();
  }

  drawHorizon(B, focal, cx, cy) {
    const { ctx } = this;
    // 地平線: 方位 0..360 の点を結ぶ（大円なので短い線分の連結で十分）
    ctx.strokeStyle = COLORS.horizon;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    let prev = null;
    for (let az = 0; az <= 360; az += 5) {
      const cur = matVec(B, [Math.sin(az * DEG), Math.cos(az * DEG), 0]);
      if (prev) this.segment(prev, cur, focal, cx, cy);
      prev = cur;
    }
    ctx.stroke();

    ctx.font = `700 15px ${FONT_UI}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const [az, name] of CARDINALS) {
      const s = this.project([Math.sin(az * DEG), Math.cos(az * DEG), 0]);
      if (!s) continue;
      ctx.fillStyle = COLORS.accent;
      ctx.beginPath();
      ctx.moveTo(s[0], s[1] - 6);
      ctx.lineTo(s[0], s[1] + 6);
      ctx.stroke();
      this.text(name, s[0], s[1] + 9, name.length === 1 ? COLORS.accent : 'rgba(244,198,78,0.75)', true);
    }
  }

  drawAltGrid(B, focal, cx, cy) {
    const { ctx } = this;
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let alt = 15; alt < 90; alt += 15) {
      let prev = null;
      for (let az = 0; az <= 360; az += 3) {
        const cur = matVec(B, [Math.cos(alt * DEG) * Math.sin(az * DEG), Math.cos(alt * DEG) * Math.cos(az * DEG), Math.sin(alt * DEG)]);
        if (prev) this.segment(prev, cur, focal, cx, cy);
        prev = cur;
      }
    }
    for (let az = 0; az < 360; az += 30) {
      // 天頂から地平までの方位線（大円の一部）
      let prev = matVec(B, [0, 0, 1]);
      for (let k = 1; k <= 6; k++) {
        const alt = 90 - k * 15;
        const cur = matVec(B, [Math.cos(alt * DEG) * Math.sin(az * DEG), Math.cos(alt * DEG) * Math.cos(az * DEG), Math.sin(alt * DEG)]);
        this.segment(prev, cur, focal, cx, cy);
        prev = cur;
      }
    }
    ctx.stroke();
  }

  drawBody(b, focal, onCamera) {
    const s = this.project(b.enu);
    if (!s) return;
    const { ctx, w, h } = this;
    if (s[0] < -60 || s[0] > w + 60 || s[1] < -60 || s[1] > h + 60) return;
    const below = b.alt < 0;
    ctx.globalAlpha = below ? 0.5 : 1;
    let r;
    if (b.kind === 'sun' || b.kind === 'moon') {
      r = Math.max(9, 0.265 * DEG * focal); // 視直径 約0.53°
      if (b.kind === 'sun') {
        const g = ctx.createRadialGradient(s[0], s[1], r * 0.6, s[0], s[1], r * 4);
        g.addColorStop(0, 'rgba(255,214,120,0.9)');
        g.addColorStop(1, 'rgba(255,214,120,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(s[0], s[1], r * 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffe9a8';
        ctx.beginPath();
        ctx.arc(s[0], s[1], r, 0, Math.PI * 2);
        ctx.fill();
      } else {
        this.drawMoon(b, s, r);
      }
    } else {
      r = Math.max(2.6, 3.6 - b.mag * 0.45);
      const g = ctx.createRadialGradient(s[0], s[1], 0, s[0], s[1], r * 3);
      g.addColorStop(0, b.color);
      g.addColorStop(0.35, b.color);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(s[0], s[1], r * 3, 0, Math.PI * 2);
      ctx.fill();
      // 惑星は星と区別できるよう細い輪を添える
      ctx.strokeStyle = 'rgba(244,198,78,0.7)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(s[0], s[1], r + 5, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.font = `600 13px ${FONT_SKY}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    this.text(b.ja, s[0] + r + 7, s[1] + 1, COLORS.accent, onCamera);
    ctx.globalAlpha = 1;
    this.hits.push({ kind: 'body', x: s[0], y: s[1], r: Math.max(28, r + 10), obj: b });
  }

  /** 月の満ち欠け: 太陽の方向を画面上で求め、明るい側を描く */
  drawMoon(b, s, r) {
    const { ctx } = this;
    const sunDir = this.sunEnu;
    let ang = 0;
    if (sunDir) {
      // 月から太陽へ少し進んだ点を投影して、画面上の向きを得る
      const k = 0.02;
      const t = [b.enu[0] + sunDir[0] * k, b.enu[1] + sunDir[1] * k, b.enu[2] + sunDir[2] * k];
      const p = this.project(t);
      if (p) ang = Math.atan2(p[1] - s[1], p[0] - s[0]);
    }
    ctx.save();
    ctx.translate(s[0], s[1]);
    ctx.rotate(ang);
    ctx.fillStyle = 'rgba(60,66,92,0.85)';
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    // 明るい側（+x 方向）: 半円 + 楕円（明暗境界）
    const k = b.illum; // 0..1
    ctx.fillStyle = '#f6f0dc';
    ctx.beginPath();
    ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2, false);
    const ex = Math.abs(1 - 2 * k) * r;
    // k>0.5 なら楕円は暗い側に膨らむ（凸月）、k<0.5 なら明るい側に食い込む（三日月）
    ctx.ellipse(0, 0, ex, r, 0, Math.PI / 2, -Math.PI / 2, k < 0.5);
    ctx.fill();
    ctx.restore();
  }
}

/** 全天図（星座早見盤ふう）: 天頂が中心、北が上、東が左 */
export function drawAllSky(ctx, size, frame, catalog, bodies, progress = 1) {
  const R = size / 2 - 22;
  const c = size / 2;
  ctx.clearRect(0, 0, size, size);
  const proj = (enu) => {
    // 立体射影
    const k = R / (1 + enu[2]);
    return [c - enu[0] * k, c - enu[1] * k];
  };
  const M = frame.j2000ToEnu;
  ctx.save();
  ctx.beginPath();
  ctx.arc(c, c, R, 0, Math.PI * 2);
  const g = ctx.createRadialGradient(c, c, 0, c, c, R);
  g.addColorStop(0, '#1b2a5e');
  g.addColorStop(1, '#101a40');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.clip();

  // 星座線（progress で描き進める）
  ctx.strokeStyle = 'rgba(157,176,255,0.5)';
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  const total = catalog.constellations.length;
  catalog.constellations.forEach((con, idx) => {
    if (idx / total > progress) return;
    for (const seg of con.lines) {
      let prev = null;
      for (const v of seg) {
        const e = matVec(M, v);
        const p = e[2] > -0.05 ? proj(e) : null;
        if (p && prev) { ctx.moveTo(...prev); ctx.lineTo(...p); }
        prev = p;
      }
    }
  });
  ctx.stroke();

  for (let i = 0; i < catalog.count; i++) {
    const mg = catalog.mag[i];
    if (mg > 5.2) break;
    const v = [catalog.vec[i * 3], catalog.vec[i * 3 + 1], catalog.vec[i * 3 + 2]];
    const e = matVec(M, v);
    if (e[2] < 0) continue;
    const [x, y] = proj(e);
    ctx.globalAlpha = Math.min(1, 0.35 + (5.2 - mg) * 0.2);
    ctx.fillStyle = catalog.color[i];
    ctx.beginPath();
    ctx.arc(x, y, Math.max(0.5, (5.6 - mg) * 0.5), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  for (const b of bodies) {
    if (b.enu[2] < 0) continue;
    const [x, y] = proj(b.enu);
    ctx.fillStyle = b.kind === 'sun' ? '#ffe9a8' : b.kind === 'moon' ? '#f6f0dc' : b.color;
    ctx.beginPath();
    ctx.arc(x, y, b.kind === 'planet' ? 2.4 : 6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // 縁と方位
  ctx.strokeStyle = 'rgba(244,198,78,0.8)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(c, c, R, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#f4c64e';
  ctx.font = `700 13px ${FONT_UI}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const [az, name] of [[0, '北'], [90, '東'], [180, '南'], [270, '西']]) {
    const a = az * DEG;
    ctx.fillText(name, c - Math.sin(a) * (R + 12), c - Math.cos(a) * (R + 12));
  }
}

export { directionName, dot };

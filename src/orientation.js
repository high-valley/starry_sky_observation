// 端末の向き → 視線方向（ENU 座標の基底ベクトル）
//
// W3C DeviceOrientation: 地球座標 x=東, y=北, z=上。
// 端末座標 x=画面右, y=画面上, z=画面手前。背面カメラは -z を向く。
// 回転は Z(alpha) → X'(beta) → Y''(gamma) の内因性回転。

import { DEG } from './astro.js';

// ---- クォータニオン [w, x, y, z]
const qMul = (a, b) => [
  a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
  a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
  a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
  a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
];
const qAxis = (x, y, z, ang) => {
  const s = Math.sin(ang / 2);
  return [Math.cos(ang / 2), x * s, y * s, z * s];
};
export function qRotate(q, v) {
  const [w, x, y, z] = q;
  const ix = w * v[0] + y * v[2] - z * v[1];
  const iy = w * v[1] + z * v[0] - x * v[2];
  const iz = w * v[2] + x * v[1] - y * v[0];
  const iw = -x * v[0] - y * v[1] - z * v[2];
  return [
    ix * w + iw * -x + iy * -z - iz * -y,
    iy * w + iw * -y + iz * -x - ix * -z,
    iz * w + iw * -z + ix * -y - iy * -x,
  ];
}
function qSlerp(a, b, t) {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  if (d < 0) { b = b.map((c) => -c); d = -d; }
  if (d > 0.9995) {
    const r = a.map((c, i) => c + (b[i] - c) * t);
    const n = Math.hypot(...r);
    return r.map((c) => c / n);
  }
  const th = Math.acos(d), s = Math.sin(th);
  const wa = Math.sin((1 - t) * th) / s, wb = Math.sin(t * th) / s;
  return a.map((c, i) => c * wa + b[i] * wb);
}

export function quatFromEuler(alpha, beta, gamma) {
  return qMul(qMul(qAxis(0, 0, 1, alpha * DEG), qAxis(1, 0, 0, beta * DEG)), qAxis(0, 1, 0, gamma * DEG));
}

/** 視線の基底 {f:前, u:上, r:右} を ENU で */
export function basisFromQuat(q) {
  return { f: qRotate(q, [0, 0, -1]), u: qRotate(q, [0, 1, 0]), r: qRotate(q, [1, 0, 0]) };
}

/** 方位・高度・回転から基底を作る（手動モード用） */
export function basisFromAzAlt(azDeg, altDeg) {
  const az = azDeg * DEG, alt = altDeg * DEG;
  const f = [Math.cos(alt) * Math.sin(az), Math.cos(alt) * Math.cos(az), Math.sin(alt)];
  const r = [Math.cos(az), -Math.sin(az), 0];
  const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  return { f, u, r };
}

/**
 * センサーの監視。absolute=true なら方位は真北基準（磁北の偏角は未補正）。
 */
export class OrientationTracker {
  constructor() {
    this.q = null;          // 平滑化後
    this.target = null;     // 最新のセンサー値
    this.absolute = false;
    this.headingOffset = 0; // 手動の方位補正 [deg]（+で視野が東へ回る）
    this.iosOffset = null;  // iOS: alpha を北基準にするための補正
    this.lastEvent = 0;
    this._onAbs = (e) => this._handle(e, true);
    this._onRel = (e) => this._handle(e, false);
  }

  static needsPermission() {
    return typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function';
  }

  /** ユーザー操作の中で呼ぶこと（iOS の許可ダイアログ） */
  async start() {
    if (typeof DeviceOrientationEvent === 'undefined') return false;
    if (OrientationTracker.needsPermission()) {
      try {
        const res = await DeviceOrientationEvent.requestPermission();
        if (res !== 'granted') return false;
      } catch {
        return false;
      }
    }
    if ('ondeviceorientationabsolute' in window) {
      window.addEventListener('deviceorientationabsolute', this._onAbs);
    }
    window.addEventListener('deviceorientation', this._onRel);
    return true;
  }

  stop() {
    window.removeEventListener('deviceorientationabsolute', this._onAbs);
    window.removeEventListener('deviceorientation', this._onRel);
  }

  get active() {
    return this.target !== null && performance.now() - this.lastEvent < 2000;
  }

  _handle(e, isAbsEvent) {
    if (e.alpha == null || e.beta == null || e.gamma == null) return;
    // 絶対方位イベントが来ているなら、相対イベントは無視
    if (!isAbsEvent && this._gotAbs) return;
    let alpha = e.alpha;
    let absolute = isAbsEvent || e.absolute === true;
    if (isAbsEvent) this._gotAbs = true;

    if (!absolute && typeof e.webkitCompassHeading === 'number' && e.webkitCompassHeading >= 0) {
      // iOS: alpha は起動時基準。コンパス方位から北基準へのずれを推定し、なめらかに追従させる
      const off = -e.webkitCompassHeading - alpha;
      if (this.iosOffset === null) this.iosOffset = off;
      else {
        const d = ((off - this.iosOffset + 540) % 360) - 180;
        this.iosOffset += d * 0.05;
      }
      alpha += this.iosOffset;
      absolute = true;
    }
    this.absolute = absolute;
    this.target = quatFromEuler(alpha, e.beta, e.gamma);
    this.lastEvent = performance.now();
  }

  /** 毎フレーム呼ぶ。画面回転と手動補正を加えた基底を返す */
  basis() {
    if (!this.target) return null;
    this.q = this.q ? qSlerp(this.q, this.target, 0.22) : this.target;
    const screenAngle = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
    // ワールドの鉛直軸まわりの方位補正 × 端末姿勢 × 画面回転
    const yaw = qAxis(0, 0, 1, -this.headingOffset * DEG);
    const q = qMul(qMul(yaw, this.q), qAxis(0, 0, 1, -screenAngle * DEG));
    return basisFromQuat(q);
  }
}

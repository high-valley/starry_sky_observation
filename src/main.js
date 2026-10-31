import { observerFrame, solarSystemBodies, matVec, enuToAzAlt, directionName, dot, DEG, RAD } from './astro.js';
import { loadCatalog } from './catalog.js';
import { SkyRenderer, drawAllSky } from './renderer.js';
import { OrientationTracker, basisFromAzAlt } from './orientation.js';
import { watchUpdates } from './update.js';

const DEFAULT_LOC = { lat: 35.6812, lon: 139.7671, label: '東京駅付近（仮の位置）' };
const STORE_KEY = 'sorakazashi:v1';

const $ = (sel) => document.querySelector(sel);
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const state = {
  lat: DEFAULT_LOC.lat,
  lon: DEFAULT_LOC.lon,
  locLabel: DEFAULT_LOC.label,
  mode: 'manual',
  opts: { camera: false, lines: true, names: true, grid: false },
  timeOffsetMin: 0,
  fov: 70,
  manualAz: 180,
  manualAlt: 40,
};

// ---------------------------------------------------------------- 保存
function loadSaved() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (!s) return;
    if (Number.isFinite(s.lat) && Number.isFinite(s.lon)) {
      state.lat = s.lat; state.lon = s.lon; state.locLabel = s.locLabel || '前回の位置';
    }
    if (s.opts) Object.assign(state.opts, { lines: s.opts.lines, names: s.opts.names, grid: s.opts.grid });
    if (Number.isFinite(s.headingOffset)) tracker.headingOffset = s.headingOffset;
  } catch { /* 保存領域が使えない環境では毎回初期値 */ }
}
function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      lat: state.lat, lon: state.lon, locLabel: state.locLabel,
      opts: state.opts, headingOffset: tracker.headingOffset,
    }));
  } catch { /* noop */ }
}

// ---------------------------------------------------------------- 時刻
const now = () => new Date(Date.now() + state.timeOffsetMin * 60000);
const fmtTime = new Intl.DateTimeFormat('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

function offsetText(min) {
  if (Math.round(min) === 0) return '今';
  const a = Math.round(Math.abs(min)), h = Math.floor(a / 60), m = a % 60;
  const span = (h ? `${h}時間` : '') + (m ? `${m}分` : '');
  return min > 0 ? `${span}後` : `${span}前`;
}

function updateTimeUI() {
  const t = fmtTime.format(now());
  const chip = $('#time-chip');
  chip.textContent = state.timeOffsetMin === 0 ? `${t} 今` : `${t} ${offsetText(state.timeOffsetMin)}`;
  chip.classList.toggle('shifted', state.timeOffsetMin !== 0);
  $('#time-label').textContent = `${t}（${offsetText(state.timeOffsetMin)}）`;
  $('#time-offset').value = String(state.timeOffsetMin);
}

function setOffsetTo(hour) {
  // 次に来る指定時刻（今日か明日）までのずれ。スライダー範囲 ±12 時間に収める
  const d = new Date();
  const target = new Date(d);
  target.setHours(hour, 0, 0, 0);
  let diff = (target - d) / 60000; // 秒まで合わせ、ちょうどその時刻にする
  if (diff < -720) diff += 1440;
  if (diff > 720) diff -= 1440;
  state.timeOffsetMin = diff;
  updateTimeUI();
}

// ---------------------------------------------------------------- 位置
function setLocation(lat, lon, label) {
  state.lat = lat; state.lon = lon; state.locLabel = label;
  $('#location-label').textContent = `${label}（北緯 ${lat.toFixed(2)}°、東経 ${lon.toFixed(2)}°）`
    .replace('北緯 -', '南緯 ').replace('東経 -', '西経 ');
  $('#lat-input').value = lat.toFixed(2);
  $('#lon-input').value = lon.toFixed(2);
  save();
}

function requestLocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) { toast('この端末では位置情報を使えません。設定から緯度・経度を入力できます。'); return resolve(false); }
    navigator.geolocation.getCurrentPosition(
      (pos) => { setLocation(pos.coords.latitude, pos.coords.longitude, '現在地'); resolve(true); },
      (err) => {
        const why = err.code === 1 ? '位置情報の利用が許可されていません' : '位置情報を取得できませんでした';
        toast(`${why}。${state.locLabel}の空を表示しています。`);
        resolve(false);
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 10 * 60000 },
    );
  });
}

// ---------------------------------------------------------------- カメラ
let stream = null;
async function setCamera(on) {
  const view = $('#view');
  const video = $('#camera');
  if (on) {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      video.srcObject = stream;
      await video.play().catch(() => {});
      state.opts.camera = true;
    } catch (e) {
      state.opts.camera = false;
      toast(e && e.name === 'NotAllowedError'
        ? 'カメラの利用が許可されていません。星空だけを表示します。'
        : 'カメラを起動できませんでした。星空だけを表示します。');
    }
  } else {
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
    video.srcObject = null;
    state.opts.camera = false;
  }
  view.classList.toggle('camera-on', state.opts.camera);
  syncToggles();
}

// ---------------------------------------------------------------- UI 部品
let toastTimer = 0;
function toast(msg, ms = 4200) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

function syncToggles() {
  document.querySelectorAll('[data-toggle]').forEach((b) => {
    b.setAttribute('aria-pressed', String(!!state.opts[b.dataset.toggle]));
  });
  $('#opt-grid').checked = state.opts.grid;
  $('#mode-sensor').classList.toggle('active', state.mode === 'sensor');
  $('#mode-manual').classList.toggle('active', state.mode === 'manual');
}

function openSheet(id) {
  document.querySelectorAll('.sheet').forEach((s) => { s.hidden = s.id !== id; });
}
function closeSheets() {
  document.querySelectorAll('.sheet').forEach((s) => { s.hidden = true; });
}

const fmtDeg = (x) => `${Math.round(x)}°`;
function azAltRows(enu) {
  const { az, alt } = enuToAzAlt(enu);
  return [
    ['方位', `${directionName(az)}（${fmtDeg(az)}）`],
    ['高度', alt >= 0 ? `${alt.toFixed(1)}°` : `${alt.toFixed(1)}°（地平線の下）`],
  ];
}

function showInfo(hit) {
  const o = hit.obj;
  let name = '', sub = '', rows = [];
  if (hit.kind === 'star') {
    name = o.ja;
    sub = `${o.conJa ? `${o.conJa}の星` : '恒星'}　${o.en}`;
    rows = [['明るさ', `${o.mag.toFixed(1)} 等`], ...azAltRows(matVec(current.frame.j2000ToEnu, o.vec))];
  } else if (hit.kind === 'constellation') {
    name = o.ja;
    sub = o.en;
    rows = azAltRows(matVec(current.frame.j2000ToEnu, o.label));
  } else if (o.kind === 'sun') {
    name = '太陽';
    sub = '直接見ないでください';
    rows = azAltRows(o.enu);
  } else if (o.kind === 'moon') {
    name = '月';
    sub = o.waxing ? '満ちていく月' : '欠けていく月';
    rows = [
      ['月齢', `約 ${o.ageDays.toFixed(1)}`],
      ['光っている割合', `${Math.round(o.illum * 100)}%`],
      ['距離', `${Math.round(o.distKm).toLocaleString('ja-JP')} km`],
      ...azAltRows(o.enu),
    ];
  } else {
    name = o.ja;
    sub = `惑星　${o.en}`;
    rows = [
      ['明るさ', `${o.mag.toFixed(1)} 等（目安）`],
      ['地球からの距離', `${o.distAU.toFixed(2)} 天文単位`],
      ...azAltRows(o.enu),
    ];
  }
  $('#info-name').textContent = name;
  $('#info-sub').textContent = sub;
  const dl = $('#info-data');
  dl.replaceChildren(...rows.flatMap(([k, v]) => {
    const dt = document.createElement('dt'); dt.textContent = k;
    const dd = document.createElement('dd'); dd.textContent = v;
    return [dt, dd];
  }));
  openSheet('info');
}

// ---------------------------------------------------------------- 描画ループ
const tracker = new OrientationTracker();
const renderer = new SkyRenderer($('#sky'));
let catalog = null;
const current = { frame: null, bodies: [], basis: null, bodiesAt: 0, bodiesOffset: null };
let sensorWaitStart = 0;

function viewBasis() {
  if (state.mode === 'sensor') {
    const b = tracker.basis();
    if (b && tracker.active) return b;
    if (sensorWaitStart && performance.now() - sensorWaitStart > 3500) {
      sensorWaitStart = 0;
      setMode('manual');
      toast('端末の向きを取得できませんでした。画面を指でなぞって見回せます。');
    }
  }
  return basisFromAzAlt(state.manualAz, state.manualAlt);
}

function updateHud(basis) {
  const { az, alt } = enuToAzAlt(basis.f);
  $('#dir-name').textContent = directionName(az);
  $('#dir-detail').textContent = `${fmtDeg(az)}　高度 ${alt.toFixed(0)}°`;

  // 照準の先にあるもの
  const { w, h } = renderer;
  let best = null, bestD = Math.min(w, h) * 0.12;
  let bestCon = null, bestConD = Math.min(w, h) * 0.28;
  for (const hit of renderer.hits) {
    const d = Math.hypot(hit.x - w / 2, hit.y - h / 2);
    if (hit.kind === 'constellation') { if (d < bestConD) { bestConD = d; bestCon = hit; } }
    else if (d < bestD) { bestD = d; best = hit; }
  }
  const el = $('#target');
  if (best) {
    const o = best.obj;
    const sub = best.kind === 'star' ? `${o.conJa || ''}　${o.mag.toFixed(1)}等` : o.kind === 'planet' ? '惑星' : '';
    el.innerHTML = `<span class="t-name"></span><span class="t-sub"></span>`;
    el.firstChild.textContent = o.ja;
    el.lastChild.textContent = sub;
  } else if (bestCon && bestConD > Math.min(w, h) * 0.1) {
    el.innerHTML = `<span class="t-sub"></span>`;
    el.firstChild.textContent = `${bestCon.obj.ja}のあたり`;
  } else {
    el.textContent = '';
  }

  // 太陽の注意
  const sun = current.bodies.find((b) => b.id === 'sun');
  const nearSun = sun && sun.alt > -1 && Math.acos(Math.min(1, dot(basis.f, sun.enu))) * RAD < 20;
  $('#sun-warning').hidden = !(nearSun && state.opts.camera);
}

let lastHud = 0;
function loop(t) {
  requestAnimationFrame(loop);
  if (!catalog || $('#view').hidden) return;
  const date = now();
  current.frame = observerFrame(date, state.lat, state.lon);
  if (t - current.bodiesAt > 1000 || current.bodiesOffset !== state.timeOffsetMin) {
    current.bodies = solarSystemBodies(current.frame);
    current.bodiesAt = t;
    current.bodiesOffset = state.timeOffsetMin;
  }
  const basis = viewBasis();
  current.basis = basis;
  renderer.sunEnu = current.bodies.length ? current.bodies[0].enu : null;
  renderer.draw({ frame: current.frame, basis, fov: state.fov, catalog, bodies: current.bodies, opts: state.opts });
  if (t - lastHud > 120) {
    updateHud(basis);
    lastHud = t;
  }
  if (Math.floor(t / 15000) !== Math.floor((t - 16) / 15000)) updateTimeUI();
}

// ---------------------------------------------------------------- 操作
function setMode(mode) {
  state.mode = mode;
  if (mode === 'manual' && current.basis) {
    const { az, alt } = enuToAzAlt(current.basis.f);
    state.manualAz = az;
    state.manualAlt = Math.max(-30, Math.min(89.9, alt));
    state.fov = Math.max(state.fov, 60);
  }
  syncToggles();
}

async function enterSensorMode() {
  const ok = await tracker.start(); // iOS の許可ダイアログはタップ直後に出す必要がある
  if (!ok) {
    toast('端末の向きを使えませんでした。画面を指でなぞって見回せます。');
    setMode('manual');
    return;
  }
  state.mode = 'sensor';
  state.fov = 62;
  sensorWaitStart = performance.now();
  syncToggles();
  setTimeout(() => {
    if (state.mode === 'sensor' && tracker.active && !tracker.absolute) {
      toast('この端末では北の向きがわからないため、方位がずれることがあります。設定で補正できます。', 6000);
    }
  }, 2500);
}

function bindPointer() {
  const view = $('#sky');
  const pointers = new Map();
  let gesture = null;

  view.addEventListener('pointerdown', (e) => {
    view.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      gesture = { type: 'drag', x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), moved: false };
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      gesture = { type: 'pinch', dist: Math.hypot(a.x - b.x, a.y - b.y), fov: state.fov };
    }
  });

  view.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!gesture) return;
    if (gesture.type === 'pinch' && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      state.fov = Math.max(15, Math.min(110, (gesture.fov * gesture.dist) / Math.max(d, 1)));
      return;
    }
    if (gesture.type !== 'drag') return;
    const dx = e.clientX - gesture.x, dy = e.clientY - gesture.y;
    gesture.x = e.clientX; gesture.y = e.clientY;
    if (Math.hypot(e.clientX - gesture.sx, e.clientY - gesture.sy) > 6) gesture.moved = true;
    const degPerPx = state.fov / renderer.h;
    if (state.mode === 'sensor') {
      tracker.headingOffset = Math.max(-45, Math.min(45, tracker.headingOffset - dx * degPerPx));
      syncHeadingUI();
    } else {
      state.manualAz = (state.manualAz - dx * degPerPx + 360) % 360;
      state.manualAlt = Math.max(-30, Math.min(89.9, state.manualAlt + dy * degPerPx));
    }
  });

  const end = (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (gesture && gesture.type === 'drag' && !gesture.moved && performance.now() - gesture.t < 400) {
      tap(e.clientX, e.clientY);
    }
    if (gesture && gesture.type === 'drag' && gesture.moved && state.mode === 'sensor') save();
    gesture = pointers.size === 1 ? null : gesture;
    if (pointers.size === 0) gesture = null;
  };
  view.addEventListener('pointerup', end);
  view.addEventListener('pointercancel', end);

  view.addEventListener('wheel', (e) => {
    e.preventDefault();
    state.fov = Math.max(15, Math.min(110, state.fov * Math.exp(e.deltaY * 0.001)));
  }, { passive: false });

  // キーボードでも見回せるように
  window.addEventListener('keydown', (e) => {
    if (e.target.closest('input')) return;
    const step = e.shiftKey ? 15 : 5;
    const map = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    if (map[e.key] && state.mode === 'manual') {
      state.manualAz = (state.manualAz + map[e.key][0] + 360) % 360;
      state.manualAlt = Math.max(-30, Math.min(89.9, state.manualAlt + map[e.key][1]));
      e.preventDefault();
    } else if (e.key === '+' || e.key === '=') state.fov = Math.max(15, state.fov / 1.15);
    else if (e.key === '-') state.fov = Math.min(110, state.fov * 1.15);
    else if (e.key === 'Escape') closeSheets();
  });
}

function tap(x, y) {
  const rect = renderer.canvas.getBoundingClientRect();
  const px = x - rect.left, py = y - rect.top;
  let best = null, bestD = Infinity;
  for (const h of renderer.hits) {
    const d = Math.hypot(h.x - px, h.y - py);
    // 星・惑星を星座名より優先
    const weighted = h.kind === 'constellation' ? d * 1.6 : d;
    if (d < h.r && weighted < bestD) { bestD = weighted; best = h; }
  }
  if (best) showInfo(best);
  else closeSheets();
}

function syncHeadingUI() {
  const v = Math.round(tracker.headingOffset);
  $('#heading-offset').value = String(v);
  $('#heading-offset-label').textContent = `${v > 0 ? '+' : ''}${v}°`;
}

function bindUI() {
  document.querySelectorAll('[data-toggle]').forEach((b) => {
    b.addEventListener('click', () => {
      const key = b.dataset.toggle;
      if (key === 'camera') return setCamera(!state.opts.camera);
      state.opts[key] = !state.opts[key];
      syncToggles();
      save();
    });
  });
  document.querySelectorAll('[data-sheet]').forEach((b) => {
    b.addEventListener('click', () => {
      const s = document.getElementById(b.dataset.sheet);
      if (s.hidden) openSheet(b.dataset.sheet); else closeSheets();
    });
  });
  document.querySelectorAll('.sheet-close').forEach((b) => b.addEventListener('click', closeSheets));
  $('#time-chip').addEventListener('click', () => openSheet('time-sheet'));

  $('#time-offset').addEventListener('input', (e) => {
    state.timeOffsetMin = Number(e.target.value);
    updateTimeUI();
  });
  $('#time-now').addEventListener('click', () => { state.timeOffsetMin = 0; updateTimeUI(); });
  $('#time-tonight').addEventListener('click', () => setOffsetTo(21));
  $('#time-dawn').addEventListener('click', () => setOffsetTo(4));

  $('#opt-grid').addEventListener('change', (e) => { state.opts.grid = e.target.checked; save(); });
  $('#heading-offset').addEventListener('input', (e) => {
    tracker.headingOffset = Number(e.target.value);
    syncHeadingUI();
    save();
  });
  $('#relocate').addEventListener('click', () => requestLocation());
  $('#apply-coords').addEventListener('click', () => {
    const lat = Number($('#lat-input').value), lon = Number($('#lon-input').value);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      toast('緯度は -90〜90、経度は -180〜180 の数で入力してください。');
      return;
    }
    setLocation(lat, lon, '入力した位置');
    toast('観測地を変更しました。');
  });
  $('#mode-sensor').addEventListener('click', () => enterSensorMode());
  $('#mode-manual').addEventListener('click', () => setMode('manual'));

  $('#start-sensor').addEventListener('click', async () => {
    const sensor = enterSensorMode();
    leaveStart();
    await sensor;
    requestLocation();
    if (state.mode === 'sensor') setCamera(true);
  });
  $('#start-manual').addEventListener('click', () => {
    setMode('manual');
    leaveStart();
    requestLocation();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && stream) setCamera(false).then(() => { resumeCamera = true; });
    else if (!document.hidden && resumeCamera) { resumeCamera = false; setCamera(true); }
  });
}
let resumeCamera = false;

function leaveStart() {
  const start = $('#start');
  start.classList.add('leaving');
  $('#view').hidden = false;
  setTimeout(() => { start.hidden = true; }, reduceMotion ? 0 : 320);
}

// ---------------------------------------------------------------- はじめの画面の全天図
function drawStartSky() {
  const canvas = $('#allsky');
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const size = 320;
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const frame = observerFrame(new Date(), state.lat, state.lon);
  const bodies = solarSystemBodies(frame);
  const sun = bodies[0];
  const t0 = performance.now();
  const step = () => {
    const p = reduceMotion ? 1 : Math.min(1, (performance.now() - t0) / 1400);
    drawAllSky(ctx, size, frame, catalog, bodies, p);
    if (p < 1 && !$('#start').hidden) requestAnimationFrame(step);
  };
  step();
  const time = fmtTime.format(new Date());
  $('#allsky-caption').textContent = sun.alt > 0
    ? `${time}、${state.locLabel}の真上の空。太陽が出ていても、星はここにあります。`
    : `${time}、${state.locLabel}の真上の空。`;
}

// ---------------------------------------------------------------- 起動
async function init() {
  $('#view').hidden = true;
  loadSaved();
  setLocation(state.lat, state.lon, state.locLabel);
  syncToggles();
  syncHeadingUI();
  updateTimeUI();
  bindUI();
  bindPointer();
  watchUpdates();
  try {
    catalog = await loadCatalog();
  } catch (e) {
    $('#allsky-caption').textContent = `星のデータを読み込めませんでした。通信状況を確認して再読み込みしてください。（${e.message}）`;
    return;
  }
  drawStartSky();
  requestAnimationFrame(loop);
  if (new URLSearchParams(location.search).has('manual')) $('#start-manual').click();
}

init();

// テスト・デバッグ用
window.__sky = { state, tracker, current, DEG };

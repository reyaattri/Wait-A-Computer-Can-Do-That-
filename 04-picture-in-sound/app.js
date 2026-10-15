import { $, $$, initShell, seg, toast, dropZone, download, fitCanvas } from "../shared/ui.js";

initShell();

// ── Colour map: inferno (polynomial fit by Matt Zucker) ─────────────────────
const LUT = (() => {
  const c = [
    [0.0002189403691192265, 0.001651004631001012, -0.01948089843709184],
    [0.1065134194856116, 0.5639564367884091, 3.932712388889277],
    [11.60249308247187, -3.972853965665698, -15.9423941062914],
    [-41.70399613139459, 17.43639888205313, 44.35414519872813],
    [77.162935699427, -33.40235894210092, -81.80730925738993],
    [-71.31942824499214, 32.62606426397723, 73.20951985803202],
    [25.13112622477341, -12.24266895238567, -23.07032500287172],
  ];
  const lut = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    for (let k = 0; k < 3; k++) {
      let v = c[6][k];
      for (let j = 5; j >= 0; j--) v = c[j][k] + t * v;
      lut[i * 3 + k] = Math.round(Math.min(1, Math.max(0, v)) * 255);
    }
  }
  return lut;
})();

// ── State ───────────────────────────────────────────────────────────────────
const S = {
  src: "text",
  emoji: "🦊",
  image: null,
  pic: null,            // {data: Float32Array, w, h}
  samples: null,        // Float32Array of the encoded clip (or loaded file, mono)
  sampleRate: 44100,
  clipIsOurs: true,
  band: [1500, 9000],
  dirty: true,
  ctx: null, analyser: null, gain: null, srcNode: null,
  playing: false, playStart: 0, playDur: 0,
  mic: null, micSource: null,
  revealed: false,
  tailUntil: 0, clock0: 0, shifted: 0,
  windowSec: 8.5,
};

const ui = {
  msg: $("#msg"), dur: $("#dur"), fLo: $("#fLo"), fHi: $("#fHi"), rows: $("#rows"), gamma: $("#gamma"),
  vol: $("#vol"), floor: $("#floor"), reveal: $("#reveal"),
  spec: $("#spec"), axes: $("#axes"), wave: $("#wave"), preview: $("#preview"),
};

const EMOJI = ["🦊", "🐈", "❤️", "🙂", "🌙", "🎵", "🚀", "🧠", "👻", "🌸", "⭐", "🐍"];
const grid = $("#emojiGrid");
EMOJI.forEach((e) => {
  const b = document.createElement("button");
  b.textContent = e; if (e === S.emoji) b.classList.add("on");
  b.addEventListener("click", () => { $$("button", grid).forEach((x) => x.classList.toggle("on", x === b)); S.emoji = e; refreshPicture(); });
  grid.appendChild(b);
});

seg($("#srcSeg"), (v) => {
  S.src = v;
  $$(".src-pane").forEach((p) => (p.hidden = p.dataset.pane !== v));
  refreshPicture();
});

dropZone($("#imgDrop"), async ([f]) => {
  if (!f.type.startsWith("image/")) return toast("That's not an image");
  const img = new Image();
  img.src = URL.createObjectURL(f);
  await img.decode();
  S.image = img;
  refreshPicture();
  toast("Picture loaded — press Play");
}, "image/*");

// ── Picture → brightness matrix ─────────────────────────────────────────────
// Split words into exactly `lines` lines minimising the widest line (small DP).
function wrapBalanced(ctx, words, lines) {
  const n = words.length;
  const width = (a, b) => ctx.measureText(words.slice(a, b).join(" ")).width;
  const memo = new Map();
  const best = (i, k) => {
    if (k === 1) return { cost: width(i, n), breaks: [] };
    const key = i * 16 + k;
    if (memo.has(key)) return memo.get(key);
    let res = { cost: Infinity, breaks: [] };
    for (let j = i + 1; j <= n - k + 1; j++) {
      const rest = best(j, k - 1), c = Math.max(width(i, j), rest.cost);
      if (c < res.cost) res = { cost: c, breaks: [j, ...rest.breaks] };
    }
    memo.set(key, res);
    return res;
  };
  const cuts = [0, ...best(0, lines).breaks, n];
  return cuts.slice(0, -1).map((a, i) => words.slice(a, cuts[i + 1]).join(" "));
}

function renderSource() {
  const cv = document.createElement("canvas");
  const ctx = cv.getContext("2d");
  if (S.src === "text") {
    const text = (ui.msg.value.trim() || " ").toUpperCase();
    const words = text.split(/\s+/);
    const fs = 120, lh = fs * 1.02;
    ctx.font = `800 ${fs}px Inter, "Segoe UI", sans-serif`;
    const targetAspect = (+ui.dur.value) / 2.4; // ~2.4 s per line height of time
    let best = null;
    for (let k = 1; k <= Math.min(4, words.length); k++) {
      const lines = wrapBalanced(ctx, words, k);
      const w = Math.max(...lines.map((l) => ctx.measureText(l).width));
      const asp = w / (lines.length * lh);
      const score = Math.abs(Math.log(asp / targetAspect));
      if (!best || score < best.score) best = { lines, w, score };
    }
    const pad = fs * 0.35;
    cv.width = Math.ceil(best.w + pad * 2); cv.height = Math.ceil(best.lines.length * lh + pad * 2);
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.font = `800 ${fs}px Inter, "Segoe UI", sans-serif`;
    ctx.fillStyle = "#fff"; ctx.textBaseline = "middle"; ctx.textAlign = "center";
    best.lines.forEach((l, i) => ctx.fillText(l, cv.width / 2, pad + lh * (i + 0.5)));
  } else if (S.src === "emoji") {
    cv.width = 280; cv.height = 240;
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.font = `200px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(S.emoji, cv.width / 2, cv.height / 2 + 12);
  } else {
    const img = S.image;
    if (!img) { cv.width = 320; cv.height = 180; ctx.fillStyle = "#000"; ctx.fillRect(0, 0, 320, 180);
      ctx.fillStyle = "#555"; ctx.font = "600 22px Inter, sans-serif"; ctx.textAlign = "center"; ctx.fillText("drop a picture", 160, 96); }
    else {
      const s = Math.min(1, 600 / Math.max(img.naturalWidth, img.naturalHeight));
      cv.width = Math.round(img.naturalWidth * s); cv.height = Math.round(img.naturalHeight * s);
      ctx.drawImage(img, 0, 0, cv.width, cv.height);
    }
  }
  return cv;
}

function buildPicture() {
  const srcCv = renderSource();
  const h = +ui.rows.value;
  const aspect = srcCv.width / srcCv.height;
  const w = Math.max(16, Math.min(720, Math.round(h * aspect * 1.0)));
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#000"; ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(srcCv, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;
  const data = new Float32Array(w * h);
  const g = ui.gamma.checked ? 2.2 : 1;
  for (let i = 0; i < w * h; i++) {
    const l = (0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2]) / 255;
    data[i] = Math.pow(l, g);
  }
  S.pic = { data, w, h };

  // preview
  const pv = ui.preview;
  pv.width = w; pv.height = h;
  const pctx = pv.getContext("2d");
  const im = pctx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const v = Math.round(Math.min(1, data[i]) * 255) * 3;
    im.data[i * 4] = LUT[v]; im.data[i * 4 + 1] = LUT[v + 1]; im.data[i * 4 + 2] = LUT[v + 2]; im.data[i * 4 + 3] = 255;
  }
  pctx.putImageData(im, 0, 0);
  $("#srcDims").textContent = `${w}×${h}`;
}

// ── Picture → audio (additive synthesis) ────────────────────────────────────
function synth() {
  const { data, w, h } = S.pic;
  const sr = S.sampleRate;
  const T = +ui.dur.value;
  const n = Math.round(T * sr);
  const out = new Float32Array(n);
  const [fLo, fHi] = S.band;
  // per-sample column coordinate (time → x)
  const colPos = new Float32Array(n);
  for (let i = 0; i < n; i++) colPos[i] = Math.min(w - 1.0001, (i / n) * w - 0.5 < 0 ? 0 : (i / n) * w - 0.5);

  let seed = 1234567;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

  for (let r = 0; r < h; r++) {
    // row 0 is the top of the picture → highest frequency
    let any = 0;
    for (let x = 0; x < w; x++) any += data[r * w + x];
    if (any < 1e-4) continue;
    const f = fHi - (r / (h - 1)) * (fHi - fLo);
    const wv = (2 * Math.PI * f) / sr;
    const cw = Math.cos(wv), sw = Math.sin(wv);
    const ph = rnd() * 2 * Math.PI;
    let re = Math.cos(ph), im = Math.sin(ph);
    const row = r * w;
    for (let i = 0; i < n; i++) {
      const p = colPos[i], x0 = p | 0, t = p - x0;
      const a = data[row + x0] * (1 - t) + data[row + x0 + 1] * t;
      out[i] += a * im;
      const nre = re * cw - im * sw;
      im = re * sw + im * cw; re = nre;
      if ((i & 4095) === 0) { const m = 1 / Math.hypot(re, im); re *= m; im *= m; }
    }
  }
  // fades + normalise
  const fade = Math.round(0.03 * sr);
  let peak = 1e-9;
  for (let i = 0; i < n; i++) {
    const e = Math.min(1, i / fade, (n - 1 - i) / fade);
    out[i] *= e; const a = Math.abs(out[i]); if (a > peak) peak = a;
  }
  const g = 0.89 / peak;
  for (let i = 0; i < n; i++) out[i] *= g;
  S.samples = out; S.clipIsOurs = true; S.dirty = false;
  drawWave();
}

function toWav(samples, sr) {
  const n = samples.length, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); w(8, "WAVE"); w(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, "data"); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 32767, true);
  return new Blob([buf], { type: "audio/wav" });
}

// ── Audio graph ─────────────────────────────────────────────────────────────
function ensureCtx() {
  if (S.ctx) return;
  S.ctx = new AudioContext();
  S.analyser = S.ctx.createAnalyser();
  S.analyser.fftSize = 2048;
  S.analyser.smoothingTimeConstant = 0;
  S.gain = S.ctx.createGain();
  S.gain.gain.value = +ui.vol.value;
  S.gain.connect(S.ctx.destination);
  S.freq = new Float32Array(S.analyser.frequencyBinCount);
}

function play() {
  ensureCtx();
  stopMic();
  if (S.dirty || !S.samples) { buildPicture(); synth(); }
  stop(true);
  const buf = S.ctx.createBuffer(1, S.samples.length, S.sampleRate);
  buf.copyToChannel(S.samples, 0);
  const node = S.ctx.createBufferSource();
  node.buffer = buf;
  node.connect(S.analyser);   // analyser sees the raw signal (volume-independent)
  node.connect(S.gain);
  node.onended = () => {
    if (S.srcNode !== node) return;
    S.playing = false; S.srcNode = null; setLive();
    // keep scrolling a moment so the picture ends up centred
    if (S.clipIsOurs) S.tailUntil = performance.now() + S.windowSec * 0.028 * 1000;
  };
  S.ctx.resume();
  node.start();
  S.srcNode = node;
  S.playing = true;
  S.playStart = S.ctx.currentTime;
  S.playDur = buf.duration;
  S.windowSec = S.clipIsOurs ? buf.duration * 1.06 : Math.min(14, Math.max(6, buf.duration));
  clearSpec();
  S.clock0 = performance.now(); S.shifted = 0;
  $("#heroPlay").classList.add("hidden");
  setLive();
}

function stop(silent) {
  S.tailUntil = 0;
  if (S.srcNode) { const n = S.srcNode; S.srcNode = null; try { n.stop(); } catch {} }
  S.playing = false;
  if (!silent) setLive();
}

async function toggleMic() {
  if (S.mic) { stopMic(); return; }
  ensureCtx(); stop(true);
  try {
    S.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  } catch (e) { toast("Microphone blocked: " + e.message); return; }
  S.ctx.resume();
  S.micSource = S.ctx.createMediaStreamSource(S.mic);
  S.micSource.connect(S.analyser);
  S.windowSec = S.samples && S.clipIsOurs ? S.samples.length / S.sampleRate * 1.06 : 10;
  clearSpec(); S.clock0 = performance.now(); S.shifted = 0;
  $("#heroPlay").classList.add("hidden");
  $("#micBtn").classList.add("rec"); $("#micBtn span").textContent = "Stop listening";
  if (!S.revealed) setReveal(true);
  setLive();
}
function stopMic() {
  if (!S.mic) return;
  S.mic.getTracks().forEach((t) => t.stop());
  S.micSource.disconnect(); S.mic = null; S.micSource = null;
  $("#micBtn").classList.remove("rec"); $("#micBtn span").textContent = "Listen via mic";
  setLive();
}

function setLive() {
  document.body.classList.toggle("playing", S.playing || !!S.mic);
  document.body.classList.toggle("mic", !!S.mic);
  $("#liveText").textContent = S.mic ? "microphone" : S.playing ? "playing" : "idle";
  const pb = $("#playBtn");
  pb.querySelector("span").textContent = S.playing ? "Stop" : "Play";
  pb.querySelector("svg").innerHTML = S.playing
    ? '<rect x="6.5" y="6.5" width="11" height="11" rx="1.5" fill="currentColor"/>'
    : '<path d="M8 5.5v13l11-6.5z" fill="currentColor"/>';
}

// ── Spectrogram rendering ───────────────────────────────────────────────────
let specCtx, colCv, colCtx, colImg, dims;

function viewBand() {
  if (S.clipIsOurs || S.mic) {
    const [a, b] = S.band, m = (b - a) * 0.09;
    return [Math.max(0, a - m), b + m];
  }
  return [0, Math.min(20000, (S.ctx?.sampleRate || 44100) / 2)];
}

function resize() {
  dims = fitCanvas(ui.spec);
  fitCanvas(ui.axes, ui.spec.parentElement);
  specCtx = ui.spec.getContext("2d");
  colCv = document.createElement("canvas");
  colCv.width = 1; colCv.height = ui.spec.height;
  colCtx = colCv.getContext("2d");
  colImg = colCtx.createImageData(1, ui.spec.height);
  clearSpec();
  drawAxes();
  fitCanvas(ui.wave);
  drawWave();
}

function clearSpec() {
  specCtx.fillStyle = "#000";
  specCtx.fillRect(0, 0, ui.spec.width, ui.spec.height);
}

function drawAxes() {
  const c = ui.axes.getContext("2d"), W = ui.axes.width, H = ui.axes.height, d = dims.dpr;
  c.clearRect(0, 0, W, H);
  const [lo, hi] = viewBand();
  const span = hi - lo;
  const step = span > 12000 ? 2000 : span > 6000 ? 1000 : 500;
  c.font = `500 ${10.5 * d}px "JetBrains Mono", monospace`;
  c.textBaseline = "middle";
  for (let f = Math.ceil(lo / step) * step; f <= hi; f += step) {
    const y = H - ((f - lo) / span) * H;
    c.fillStyle = "rgba(255,255,255,.07)";
    c.fillRect(46 * d, y, W, 1);
    c.fillStyle = "rgba(255,255,255,.45)";
    c.fillText((f / 1000).toFixed(f % 1000 ? 1 : 0) + " kHz", 10 * d, y);
  }
  // "now" edge
  const g = c.createLinearGradient(W - 40 * d, 0, W, 0);
  g.addColorStop(0, "rgba(255,179,92,0)"); g.addColorStop(1, "rgba(255,179,92,.10)");
  c.fillStyle = g; c.fillRect(W - 40 * d, 0, 40 * d, H);
}

function floorDb() { return +ui.floor.value; }
const DB_RANGE_TOP = -22;

function specColumn() {
  S.analyser.getFloatFrequencyData(S.freq);
  const H = ui.spec.height, nyq = S.ctx.sampleRate / 2, bins = S.freq.length;
  const [lo, hi] = viewBand();
  const fl = floorDb(), rng = DB_RANGE_TOP - fl;
  const px = colImg.data;
  for (let y = 0; y < H; y++) {
    const f = lo + (1 - y / (H - 1)) * (hi - lo);
    const b = (f / nyq) * bins, b0 = Math.max(0, Math.min(bins - 2, b | 0)), t = b - b0;
    const db = S.freq[b0] * (1 - t) + S.freq[b0 + 1] * t;
    let v = (db - fl) / rng; v = v < 0 ? 0 : v > 1 ? 1 : v;
    const k = Math.round(v * 255) * 3;
    px[y * 4] = LUT[k]; px[y * 4 + 1] = LUT[k + 1]; px[y * 4 + 2] = LUT[k + 2]; px[y * 4 + 3] = 255;
  }
  colCtx.putImageData(colImg, 0, 0);
}

function frame(now) {
  requestAnimationFrame(frame);
  const active = S.playing || S.mic || now < S.tailUntil;
  if (active && S.analyser) {
    const W = ui.spec.width, H = ui.spec.height;
    // position is derived from the wall clock, so dropped frames never lose time
    const target = ((now - S.clock0) / 1000 / S.windowSec) * W;
    const dx = Math.floor(target - S.shifted);
    if (dx > 0) {
      S.shifted += dx;
      specCtx.globalCompositeOperation = "copy";
      specCtx.drawImage(ui.spec, -dx, 0);
      specCtx.globalCompositeOperation = "source-over";
      specColumn();
      specCtx.imageSmoothingEnabled = false;
      specCtx.drawImage(colCv, W - dx, 0, dx, H);
    }
  }
  // waveform playhead + readout
  if (S.samples) {
    const t = S.playing ? Math.min(S.playDur, S.ctx.currentTime - S.playStart) : 0;
    const dur = S.samples.length / S.sampleRate;
    $("#timeReadout").textContent = `${t.toFixed(2)} / ${dur.toFixed(2)} s`;
    drawWave(S.playing ? t / dur : -1);
  }
}

// waveform overview cache
let waveCache = null;
function drawWave(progress = -1) {
  const cv = ui.wave; if (!cv.width) return;
  const c = cv.getContext("2d"), W = cv.width, H = cv.height;
  if (!S.samples) { c.clearRect(0, 0, W, H); return; }
  if (!waveCache || waveCache.src !== S.samples || waveCache.W !== W) {
    const mins = new Float32Array(W), maxs = new Float32Array(W), n = S.samples.length;
    for (let x = 0; x < W; x++) {
      let mn = 1, mx = -1;
      const a = Math.floor((x / W) * n), b = Math.floor(((x + 1) / W) * n);
      for (let i = a; i < b; i++) { const s = S.samples[i]; if (s < mn) mn = s; if (s > mx) mx = s; }
      mins[x] = mn; maxs[x] = mx;
    }
    waveCache = { src: S.samples, W, mins, maxs };
  }
  c.clearRect(0, 0, W, H);
  const mid = H / 2, px = progress < 0 ? -1 : Math.floor(progress * W);
  for (let x = 0; x < W; x++) {
    c.fillStyle = x <= px ? "#F59E0B" : "#CBD5E1";
    const y0 = mid - waveCache.maxs[x] * mid * 0.92, y1 = mid - waveCache.mins[x] * mid * 0.92;
    c.fillRect(x, y0, 1, Math.max(1, y1 - y0));
  }
  if (px >= 0) { c.fillStyle = "#1E293B"; c.fillRect(px - 1, 0, 3, H); }
}

// ── Instant reveal: offline STFT of the whole clip ──────────────────────────
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const a = i + j, b = a + len / 2;
        const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}

function instantReveal() {
  if (S.dirty || !S.samples) { buildPicture(); synth(); }
  stop(true); stopMic();
  if (!S.revealed) setReveal(true);
  const N = 2048, W = ui.spec.width, H = ui.spec.height, x = S.samples, sr = S.sampleRate;
  const [lo, hi] = viewBand();
  const win = new Float32Array(N).map((_, i) => 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / N) + 0.08 * Math.cos((4 * Math.PI * i) / N));
  const margin = S.clipIsOurs ? 0.03 : 0;
  const cols = Math.round(W * (1 - 2 * margin)), x0 = Math.round(W * margin);
  const mags = new Float32Array(cols * (N / 2));
  let peak = 1e-12;
  const re = new Float32Array(N), im = new Float32Array(N);
  for (let c = 0; c < cols; c++) {
    const center = Math.floor(((c + 0.5) / cols) * x.length);
    for (let i = 0; i < N; i++) { const k = center - N / 2 + i; re[i] = (k >= 0 && k < x.length ? x[k] : 0) * win[i]; im[i] = 0; }
    fft(re, im);
    for (let b = 0; b < N / 2; b++) { const m = Math.hypot(re[b], im[b]); mags[c * (N / 2) + b] = m; if (m > peak) peak = m; }
  }
  const img = specCtx.createImageData(W, H);
  img.data.fill(0); for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;
  const rng = DB_RANGE_TOP - floorDb();
  for (let c = 0; c < cols; c++) {
    for (let y = 0; y < H; y++) {
      const f = lo + (1 - y / (H - 1)) * (hi - lo);
      const b = (f / (sr / 2)) * (N / 2), b0 = Math.min(N / 2 - 2, b | 0), t = b - b0;
      const m = mags[c * (N / 2) + b0] * (1 - t) + mags[c * (N / 2) + b0 + 1] * t;
      let v = (20 * Math.log10(m / peak + 1e-12) + rng) / rng; v = v < 0 ? 0 : v > 1 ? 1 : v;
      const k = Math.round(v * 255) * 3, o = (y * W + x0 + c) * 4;
      img.data[o] = LUT[k]; img.data[o + 1] = LUT[k + 1]; img.data[o + 2] = LUT[k + 2];
    }
  }
  specCtx.putImageData(img, 0, 0);
  toast("Full spectrogram computed");
}

// ── Reveal ──────────────────────────────────────────────────────────────────
function setReveal(on) {
  S.revealed = on;
  ui.reveal.checked = on;
  $("#veil").classList.toggle("gone", on);
  $("#previewWrap").classList.toggle("spoiler", !on);
}

// ── Wiring ──────────────────────────────────────────────────────────────────
function syncLabels() {
  let lo = +ui.fLo.value, hi = +ui.fHi.value;
  if (hi - lo < 1500) { if (document.activeElement === ui.fLo) lo = hi - 1500; else hi = lo + 1500; ui.fLo.value = lo; ui.fHi.value = hi; }
  S.band = [lo, hi];
  $("#durOut").textContent = (+ui.dur.value).toFixed(1) + " s";
  $("#bandOut").textContent = `${(lo / 1000).toFixed(1)} – ${(hi / 1000).toFixed(1)} kHz`;
  $("#rowsOut").textContent = ui.rows.value + " sine waves";
  $("#volOut").textContent = Math.round(ui.vol.value * 100) + "%";
  $("#floorOut").textContent = ui.floor.value + " dB";
  [ui.fLo, ui.fHi].forEach((r) => r.style.setProperty("--p", ((r.value - r.min) / (r.max - r.min)) * 100 + "%"));
}

let refreshT;
function refreshPicture() {
  S.dirty = true;
  clearTimeout(refreshT);
  refreshT = setTimeout(() => { buildPicture(); if (!S.playing) drawAxes(); }, 60);
}

[ui.dur, ui.fLo, ui.fHi, ui.rows, ui.gamma].forEach((el) => el.addEventListener("input", () => { syncLabels(); refreshPicture(); drawAxes(); }));
ui.msg.addEventListener("input", refreshPicture);
ui.vol.addEventListener("input", () => { syncLabels(); if (S.gain) S.gain.gain.setTargetAtTime(+ui.vol.value, S.ctx.currentTime, 0.02); });
ui.floor.addEventListener("input", syncLabels);
ui.reveal.addEventListener("change", () => setReveal(ui.reveal.checked));

const togglePlay = () => (S.playing ? stop() : play());
$("#playBtn").addEventListener("click", togglePlay);
$("#heroPlay").addEventListener("click", play);
ui.wave.addEventListener("click", play);
$("#dlBtn").addEventListener("click", () => {
  if (S.dirty || !S.samples || !S.clipIsOurs) { buildPicture(); synth(); }
  const name = S.src === "text" ? ui.msg.value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40) || "message" : S.src === "emoji" ? "emoji" : "picture";
  download(toWav(S.samples, S.sampleRate), `hidden-${name}.wav`);
  toast("Saved — try it in Audacity's spectrogram view");
});
$("#instantBtn").addEventListener("click", instantReveal);
$("#clearBtn").addEventListener("click", clearSpec);
$("#micBtn").addEventListener("click", toggleMic);

dropZone($("#audioDrop"), async ([f]) => {
  ensureCtx();
  try {
    const buf = await S.ctx.decodeAudioData(await f.arrayBuffer());
    const mono = new Float32Array(buf.length);
    for (let ch = 0; ch < buf.numberOfChannels; ch++) { const d = buf.getChannelData(ch); for (let i = 0; i < d.length; i++) mono[i] += d[i] / buf.numberOfChannels; }
    S.samples = mono; S.sampleRate = buf.sampleRate; S.clipIsOurs = false; S.dirty = false;
    drawAxes(); drawWave();
    toast(`Loaded ${f.name} — ${buf.duration.toFixed(1)} s`);
    play();
  } catch { toast("Couldn't decode that file"); }
}, "audio/*");

addEventListener("keydown", (e) => {
  if (e.target.matches("input[type=text], textarea")) return;
  if (e.code === "Space") { e.preventDefault(); togglePlay(); }
  else if (e.key === "r" || e.key === "R") setReveal(!S.revealed);
  else if (e.key === "i" || e.key === "I") instantReveal();
  else if (e.key === "m" || e.key === "M") toggleMic();
  else if (e.key === "c" || e.key === "C") clearSpec();
});

// typing a new message resets back to "our clip" mode
ui.msg.addEventListener("input", () => { if (!S.clipIsOurs) { S.clipIsOurs = true; S.sampleRate = 44100; drawAxes(); } });
$$("#srcSeg button, #emojiGrid button").forEach((b) => b.addEventListener("click", () => { if (!S.clipIsOurs) { S.clipIsOurs = true; S.sampleRate = 44100; drawAxes(); } }));

syncLabels();
await document.fonts.ready;
addEventListener("resize", resize);
resize();
buildPicture();
requestAnimationFrame(frame);

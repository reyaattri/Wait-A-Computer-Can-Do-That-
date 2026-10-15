import { $, $$, initShell, toast, dropZone, download, fitCanvas, fmt } from "../shared/ui.js";
initShell();

const INK = "#1E293B";
const worker = new Worker("worker.js?v=2");
const S = {
  src: null,            // full-resolution source picture
  crop: { zoom: 1, cx: 0.5, cy: 0.5 }, // framing inside the source (centre in 0..1)
  img: null,            // the framed, working-size picture the dots are made from
  w: 0, h: 0, dark: null,
  drag: null, framing: false,
  xs: null, ys: null,   // dots
  tour: null, shown: null, firstLen: 0, length: 0, swaps: 0,
  phase: "photo",
  pen: null,            // {t0, dur} while the first greedy tour is being "drawn"
  pending: null,        // tour updates that arrive while the pen is still drawing
};
const cv = $("#cv"), ctx = cv.getContext("2d");
let view = { w: 0, h: 0, dpr: 1 };

// ── Phases indicator ────────────────────────────────────────────────────────
const ORDER = ["photo", "dots", "path", "opt"];
function setPhase(p) {
  S.phase = p;
  const k = ORDER.indexOf(p === "done" ? "opt" : p);
  $$("#phases li").forEach((li, i) => {
    li.classList.toggle("done", i < k || p === "done");
    li.classList.toggle("on", i === k && p !== "done");
  });
}

// ── Picture → darkness map ──────────────────────────────────────────────────
const SAMPLES = ["🦊", "🐈", "🦉", "🙂", "🌻"];
SAMPLES.forEach((e, i) => {
  const b = document.createElement("button");
  b.textContent = e; if (i === 0) b.classList.add("on");
  b.onclick = () => { $$("#samples button").forEach((x) => x.classList.toggle("on", x === b)); forgetPhoto(); useEmoji(e); };
  $("#samples").appendChild(b);
});

function useEmoji(e) {
  const c = document.createElement("canvas"); c.width = 640; c.height = 640;
  const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, 640, 640);
  g.font = `430px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
  g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(e, 320, 340);
  usePicture(c);
}

function usePicture(source, keepCrop) {
  stopCam();
  const sw = source.videoWidth || source.naturalWidth || source.width, sh = source.videoHeight || source.naturalHeight || source.height;
  const k = Math.min(1, 1400 / Math.max(sw, sh));
  const c = document.createElement("canvas"); c.width = Math.round(sw * k); c.height = Math.round(sh * k);
  const g = c.getContext("2d");
  g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
  if (source.tagName === "VIDEO") { g.translate(c.width, 0); g.scale(-1, 1); } // un-mirror the selfie preview
  g.drawImage(source, 0, 0, c.width, c.height);
  S.src = c;
  if (!keepCrop) { S.crop = { zoom: 1, cx: 0.5, cy: 0.5 }; $("#zoom").value = 1; sync(); }
  rebuild();
}

// Remember the last real photo so a reload (or presenting later) keeps it. Stays in this browser only.
function rememberPhoto() {
  try {
    const k = Math.min(1, 1000 / Math.max(S.src.width, S.src.height));
    const c = document.createElement("canvas"); c.width = S.src.width * k; c.height = S.src.height * k;
    c.getContext("2d").drawImage(S.src, 0, 0, c.width, c.height);
    localStorage.setItem("tsp-photo", c.toDataURL("image/jpeg", 0.88));
    localStorage.setItem("tsp-crop", JSON.stringify(S.crop));
  } catch {}
}
function forgetPhoto() { try { localStorage.removeItem("tsp-photo"); localStorage.removeItem("tsp-crop"); } catch {} }

// Source rectangle for the current framing: a zoomed window around the chosen centre.
function cropRect() {
  const W = S.src.width, H = S.src.height, z = S.crop.zoom;
  const cw = W / z, ch = H / z;
  const x = Math.min(W - cw, Math.max(0, S.crop.cx * W - cw / 2));
  const y = Math.min(H - ch, Math.max(0, S.crop.cy * H - ch / 2));
  return { x, y, w: cw, h: ch };
}

function rebuild() {
  const r = cropRect(), maxSide = 560;
  const s = maxSide / Math.max(r.w, r.h);
  const w = Math.round(r.w * s), h = Math.round(r.h * s);
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.imageSmoothingQuality = "high";
  g.drawImage(S.src, r.x, r.y, r.w, r.h, 0, 0, w, h);
  S.img = c; S.w = w; S.h = h;
  computeDark();
  restipple();
}

// ── Tone mapping: what should be dark (= lots of dots)? ────────────────────
// 1. stretch contrast between the 1st and 99th percentile
// 2. boost local contrast (subtract a big blur) so features pop out of skin tones
// 3. add thin dark lines (difference of blurs) so eyes, brows and lips get traced
// 4. drop the lightest areas entirely, then apply a contrast curve
function blur(src, w, h, r) { // three box-blur passes ≈ Gaussian
  const a = Float32Array.from(src), b = new Float32Array(w * h);
  r = Math.max(1, Math.round(r));
  const div = 2 * r + 1;
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < h; y++) {
      const o = y * w; let acc = 0;
      for (let x = -r; x <= r; x++) acc += a[o + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        b[o + x] = acc / div;
        acc += a[o + Math.min(w - 1, x + r + 1)] - a[o + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += b[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        a[y * w + x] = acc / div;
        acc += b[Math.min(h - 1, y + r + 1) * w + x] - b[Math.max(0, y - r) * w + x];
      }
    }
  }
  return a;
}
function percentile(arr, q) {
  const hist = new Uint32Array(1024);
  for (let i = 0; i < arr.length; i++) hist[Math.min(1023, Math.max(0, (arr[i] * 1023) | 0))]++;
  let acc = 0; const target = q * arr.length;
  for (let i = 0; i < 1024; i++) { acc += hist[i]; if (acc >= target) return i / 1023; }
  return 1;
}

function computeDark() {
  const { w, h } = S, n = w * h, px = S.img.getContext("2d").getImageData(0, 0, w, h).data;
  const detail = +$("#detail").value, cut = +$("#cut").value, gam = +$("#gamma").value;
  const L = new Float32Array(n);
  for (let i = 0; i < n; i++) L[i] = (0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2]) / 255;
  const lo = percentile(L, 0.01), hi = percentile(L, 0.99), span = Math.max(0.05, hi - lo);
  for (let i = 0; i < n; i++) L[i] = Math.min(1, Math.max(0, (L[i] - lo) / span));

  const big = blur(L, w, h, Math.max(w, h) / 22);
  const fine = blur(L, w, h, 1), mid = blur(L, w, h, 3);
  const edge = new Float32Array(n);
  for (let i = 0; i < n; i++) edge[i] = Math.max(0, mid[i] - fine[i]); // > 0 on a thin dark line
  const eTop = Math.max(1e-3, percentile(edge, 0.995));

  S.dark = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const local = L[i] + detail * 0.9 * (L[i] - big[i]);   // local contrast
    let d = 1 - Math.min(1, Math.max(0, local));
    d = (d - cut) / (1 - cut);                              // ignore light areas
    d = d <= 0 ? 0 : Math.pow(d, gam);
    d += detail * 0.55 * Math.min(1, edge[i] / eTop);       // trace features
    S.dark[i] = d > 1 ? 1 : d < 0.02 ? 0 : d;
  }
}

function restipple() {
  S.tour = S.shown = null; S.pen = S.pending = null; S.swaps = 0; S.firstLen = S.length = 0;
  setPhase("dots");
  const n = +$("#nDots").value;
  worker.postMessage({ type: "stipple", dark: S.dark, w: S.w, h: S.h, n, iters: 26 });
  stats();
}

// ── Worker messages ─────────────────────────────────────────────────────────
worker.onmessage = ({ data: m }) => {
  if (m.type === "dots") { S.xs = m.xs; S.ys = m.ys; stats(); }
  else if (m.type === "stippled") { toast("Dots ready — press Space"); }
  else if (m.type === "tour") {
    if (m.phase === "greedy") {
      S.tour = m.tour; S.firstLen = m.firstLen; S.length = m.length; S.swaps = 0;
      S.pen = { t0: performance.now(), dur: 2600 };
      setPhase("path");
    } else if (S.pen) S.pending = m;
    else applyTour(m);
    stats();
  }
};
function applyTour(m) {
  S.tour = m.tour; S.length = m.length; S.swaps = m.swaps;
  setPhase(m.phase === "done" ? "done" : "opt");
  if (m.phase === "done") toast("Untangled! One continuous line");
  stats();
}

function solve() {
  if (!S.xs) return;
  $("#showDots").checked = false; // the line alone reads best
  worker.postMessage({ type: "solve", xs: S.xs, ys: S.ys });
}

// ── Stats ───────────────────────────────────────────────────────────────────
function stats() {
  $("#sDots").textContent = S.xs ? fmt(S.xs.length) : "—";
  const scale = 1000 / Math.max(S.w, S.h || 1); // report length in "picture widths × 1000"
  $("#sLen").textContent = S.length ? fmt(S.length * scale) : "—";
  $("#sGain").textContent = S.firstLen && S.length < S.firstLen ? `${((1 - S.length / S.firstLen) * 100).toFixed(1)}%` : "—";
  $("#sSwaps").textContent = S.tour ? fmt(S.swaps) : "—";
}

// ── Drawing ─────────────────────────────────────────────────────────────────
function layout() {
  const pad = 26 * view.dpr, W = cv.width, H = cv.height;
  const s = Math.min((W - pad * 2) / S.w, (H - pad * 2) / S.h);
  return { s, ox: (W - S.w * s) / 2, oy: (H - S.h * s) / 2 };
}

function frame(now) {
  requestAnimationFrame(frame);
  const W = cv.width, H = cv.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);
  if (!S.img) return;
  if (S.drag || S.framing) { drawFraming(W, H); return; }
  const { s, ox, oy } = layout();
  if ($("#showPhoto").checked) { ctx.globalAlpha = 0.22; ctx.drawImage(S.img, ox, oy, S.w * s, S.h * s); ctx.globalAlpha = 1; }

  // finish the pen animation, then let queued optimisation updates through
  let upto = S.tour ? S.tour.length : 0;
  if (S.pen) {
    const t = Math.min(1, (now - S.pen.t0) / S.pen.dur);
    upto = Math.max(2, Math.floor(S.tour.length * (1 - Math.pow(1 - t, 2))));
    if (t >= 1) { S.pen = null; if (S.pending) { applyTour(S.pending); S.pending = null; } else setPhase("opt"); }
  }

  const n = S.xs ? S.xs.length : 0;
  const dotR = Math.max(0.7, Math.min(2.2, s * Math.sqrt((S.w * S.h) / Math.max(1, n)) * 0.16));
  if ($("#showDots").checked && n) {
    ctx.fillStyle = S.tour ? "rgba(30,41,59,.35)" : INK;
    for (let i = 0; i < n; i++) ctx.fillRect(ox + S.xs[i] * s - dotR, oy + S.ys[i] * s - dotR, dotR * 2, dotR * 2);
  }

  if (S.tour && n) {
    const T = S.tour;
    ctx.strokeStyle = INK; ctx.lineJoin = ctx.lineCap = "round";
    const spacing = s * Math.sqrt((S.w * S.h) / n);   // average gap between dots on screen
    ctx.lineWidth = Math.max(0.55 * view.dpr, Math.min(1.8 * view.dpr, spacing * 0.32));
    ctx.beginPath();
    ctx.moveTo(ox + S.xs[T[0]] * s, oy + S.ys[T[0]] * s);
    for (let i = 1; i < upto; i++) ctx.lineTo(ox + S.xs[T[i]] * s, oy + S.ys[T[i]] * s);
    if (!S.pen) ctx.closePath();
    ctx.stroke();
    if (S.pen) { // the pen tip
      const p = T[upto - 1], x = ox + S.xs[p] * s, y = oy + S.ys[p] * s;
      ctx.fillStyle = "#F472B6"; ctx.strokeStyle = INK; ctx.lineWidth = 2 * view.dpr;
      ctx.beginPath(); ctx.arc(x, y, 7 * view.dpr, 0, 7); ctx.fill(); ctx.stroke();
    }
  }
}

function drawFraming(W, H) {
  const r = cropRect(), pad = 26 * view.dpr;
  const s = Math.min((W - pad * 2) / r.w, (H - pad * 2) / r.h);
  ctx.drawImage(S.src, r.x, r.y, r.w, r.h, (W - r.w * s) / 2, (H - r.h * s) / 2, r.w * s, r.h * s);
  ctx.fillStyle = "rgba(30,41,59,.8)"; ctx.font = `700 ${13 * view.dpr}px "Plus Jakarta Sans", sans-serif`;
  ctx.textAlign = "center"; ctx.fillText("Frame your face · release to redraw", W / 2, H - 10 * view.dpr);
}

// Drag the picture to move the frame (not while the line is being drawn).
cv.addEventListener("pointerdown", (e) => {
  if (!S.src || S.pen || (S.tour && S.phase !== "done")) return;
  S.drag = { x: e.clientX, y: e.clientY, cx: S.crop.cx, cy: S.crop.cy };
  cv.setPointerCapture(e.pointerId); cv.style.cursor = "grabbing";
});
cv.addEventListener("pointermove", (e) => {
  if (!S.drag) return;
  const r = cropRect(), rect = cv.getBoundingClientRect();
  const k = Math.max(r.w / rect.width, r.h / rect.height) * 1.08; // screen px → source px
  S.crop.cx = Math.min(1, Math.max(0, S.drag.cx - ((e.clientX - S.drag.x) * k) / S.src.width));
  S.crop.cy = Math.min(1, Math.max(0, S.drag.cy - ((e.clientY - S.drag.y) * k) / S.src.height));
});
cv.addEventListener("pointerup", () => {
  if (!S.drag) return;
  const moved = S.crop.cx !== S.drag.cx || S.crop.cy !== S.drag.cy;
  S.drag = null; cv.style.cursor = "";
  if (moved) { rebuild(); if (localStorage.getItem("tsp-photo")) rememberPhoto(); }
});

function resize() { view = fitCanvas(cv); view.dpr = cv.width / view.w; }
addEventListener("resize", resize);

// ── Camera ──────────────────────────────────────────────────────────────────
let stream = null;
async function startCam() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720, facingMode: "user" } });
  } catch (e) { toast("Camera blocked — drop a photo instead"); return; }
  const v = $("#video"); v.srcObject = stream; v.hidden = false; await v.play();
  $("#camUi").hidden = false; $("#count").textContent = "";
  $("#camBtn span").textContent = "Cancel selfie";
}
function stopCam() {
  if (!stream) return;
  stream.getTracks().forEach((t) => t.stop()); stream = null;
  $("#video").hidden = true; $("#camUi").hidden = true; $("#camBtn span").textContent = "Take a selfie";
}
async function snap() {
  for (const n of ["3", "2", "1"]) { $("#count").textContent = n; await new Promise((r) => setTimeout(r, 700)); }
  $("#count").textContent = "";
  $$("#samples button").forEach((x) => x.classList.remove("on"));
  usePicture($("#video")); rememberPhoto();
}
$("#camBtn").onclick = () => (stream ? stopCam() : startCam());
$("#snapBtn").onclick = snap;

dropZone($("#imgDrop"), async ([f]) => {
  if (!f.type.startsWith("image/")) return toast("Pick an image");
  const img = new Image(); img.src = URL.createObjectURL(f); await img.decode();
  $$("#samples button").forEach((x) => x.classList.remove("on"));
  usePicture(img); rememberPhoto();
}, "image/*");

// ── Controls ────────────────────────────────────────────────────────────────
function sync() {
  $("#nOut").textContent = fmt(+$("#nDots").value); $("#gOut").textContent = (+$("#gamma").value).toFixed(1);
  $("#dOut").textContent = (+$("#detail").value).toFixed(1); $("#cOut").textContent = Math.round(+$("#cut").value * 100) + "%";
  $("#zOut").textContent = (+$("#zoom").value).toFixed(1) + "×";
}
let rt;
$("#zoom").addEventListener("input", () => {
  sync(); if (!S.src) return;
  S.crop.zoom = +$("#zoom").value; S.framing = true;
  clearTimeout(rt); rt = setTimeout(() => { S.framing = false; rebuild(); if (localStorage.getItem("tsp-photo")) rememberPhoto(); }, 450);
});
for (const id of ["#detail", "#cut"]) $(id).addEventListener("input", () => { sync(); clearTimeout(rt); rt = setTimeout(() => { if (S.img) { computeDark(); restipple(); } }, 250); });
$("#nDots").addEventListener("input", () => { sync(); clearTimeout(rt); rt = setTimeout(() => S.img && restipple(), 250); });
$("#gamma").addEventListener("input", () => { sync(); clearTimeout(rt); rt = setTimeout(() => { if (S.img) { computeDark(); restipple(); } }, 250); });
$("#solveBtn").onclick = solve;

$("#pngBtn").onclick = () => {
  if (!S.tour) return toast("Connect the dots first");
  const out = document.createElement("canvas"), k = 2400 / Math.max(S.w, S.h), pad = 80;
  out.width = Math.round(S.w * k + pad * 2); out.height = Math.round(S.h * k + pad * 2);
  const g = out.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, out.width, out.height);
  g.strokeStyle = INK; g.lineWidth = 2.2; g.lineJoin = g.lineCap = "round"; g.beginPath();
  S.tour.forEach((p, i) => (i ? g.lineTo : g.moveTo).call(g, pad + S.xs[p] * k, pad + S.ys[p] * k)); g.closePath(); g.stroke();
  out.toBlob((b) => download(b, "one-line-portrait.png"));
};
$("#svgBtn").onclick = () => {
  if (!S.tour) return toast("Connect the dots first");
  const pts = Array.from(S.tour, (p) => `${S.xs[p].toFixed(1)},${S.ys[p].toFixed(1)}`).join(" ");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-10 -10 ${S.w + 20} ${S.h + 20}"><rect x="-10" y="-10" width="${S.w + 20}" height="${S.h + 20}" fill="#fff"/><polygon points="${pts}" fill="none" stroke="${INK}" stroke-width=".6" stroke-linejoin="round"/></svg>`;
  download(new Blob([svg], { type: "image/svg+xml" }), "one-line-portrait.svg");
};

addEventListener("keydown", (e) => {
  if (e.target.matches("input[type=text], textarea")) return;
  const k = e.key.toLowerCase();
  if (e.code === "Space") { e.preventDefault(); stream ? snap() : solve(); }
  else if (k === "c") $("#camBtn").click();
  else if (k === "d") { $("#showDots").checked = !$("#showDots").checked; }
  else if (k === "i") { $("#showPhoto").checked = !$("#showPhoto").checked; }
});

sync();
await document.fonts.ready;
resize();
// Start from the last photo used here, otherwise the fox.
const saved = (() => { try { return localStorage.getItem("tsp-photo"); } catch { return null; } })();
if (saved) {
  const img = new Image(); img.src = saved; await img.decode();
  try { S.crop = { ...S.crop, ...JSON.parse(localStorage.getItem("tsp-crop") || "{}") }; } catch {}
  $("#zoom").value = S.crop.zoom; sync();
  $$("#samples button").forEach((x) => x.classList.remove("on"));
  usePicture(img, true);
} else useEmoji(SAMPLES[0]);
requestAnimationFrame(frame);

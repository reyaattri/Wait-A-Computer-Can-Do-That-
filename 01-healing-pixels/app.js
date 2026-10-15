import { $, $$, initShell, toast, fmt } from "../shared/ui.js";
initShell();

// Creatures we may have trained weights for (weights/<name>.json from train/train_nca.py).
const CANDIDATES = [
  { name: "lizard", emoji: "🦎" }, { name: "butterfly", emoji: "🦋" },
  { name: "mushroom", emoji: "🍄" }, { name: "heart", emoji: "💖" },
];

let M = null;            // model: {C, H, G, w1, b1, w2, target}
let state, next, aliveA, aliveB, aliveU, hidden, perc;
let steps = 0, paused = false, pristine = null;
const cv = $("#cv"), ctx = cv.getContext("2d");
let img;

// ── Load whichever trained models exist ─────────────────────────────────────
const available = [];
await Promise.all(CANDIDATES.map(async (c) => {
  try { const r = await fetch(`weights/${c.name}.json?v=1`, { cache: "no-cache" }); if (r.ok) { c.data = await r.json(); available.push(c); } } catch {}
}));
available.sort((a, b) => CANDIDATES.indexOf(a) - CANDIDATES.indexOf(b));

if (!available.length) { $("#missing").hidden = false; $("#hintPill").classList.add("gone"); }
available.forEach((c, i) => {
  const b = document.createElement("button");
  b.textContent = c.emoji; b.title = c.name;
  b.onclick = () => { $$("#creatures button").forEach((x) => x.classList.toggle("on", x === b)); load(c.data); seed(); };
  $("#creatures").appendChild(b);
  if (i === 0) b.classList.add("on");
});

function load(d) {
  const C = d.channels, H = d.hidden, G = d.grid;
  M = { C, H, G, w1: Float64Array.from(d.w1), b1: Float64Array.from(d.b1), w2: Float64Array.from(d.w2), target: Float32Array.from(d.target), tsize: Math.round(Math.sqrt(d.target.length / 4)) };
  // Float64 on purpose: Float32 state decays into denormals, which x86 CPUs process ~6× slower
  state = new Float64Array(G * G * C); next = new Float64Array(G * G * C);
  aliveA = new Uint8Array(G * G); aliveB = new Uint8Array(G * G); aliveU = new Uint8Array(G * G);
  hidden = new Float64Array(H); perc = new Float64Array(3 * C);
  cv.width = G; cv.height = G; img = ctx.createImageData(G, G);
  // target mask (alpha>0.1), centred in the grid, for the "healed" score
  const pad = (G - M.tsize) / 2;
  M.mask = new Uint8Array(G * G);
  for (let y = 0; y < M.tsize; y++) for (let x = 0; x < M.tsize; x++) if (M.target[(y * M.tsize + x) * 4 + 3] > 0.1) M.mask[(y + pad) * G + x + pad] = 1;
  buildBrain();
}

function seed() {
  if (!M) return;
  state.fill(0);
  const { G, C } = M, c = ((G >> 1) * G + (G >> 1)) * C;
  for (let k = 3; k < C; k++) state[c + k] = 1;
  steps = 0; pristine = null;
}

// ── One update of the cellular automaton (mirrors train_nca.py exactly) ─────
function computeAlive(src, out) {
  const G = M.G, C = M.C;
  for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) {
    let a = 0;
    for (let dy = -1; dy <= 1 && !a; dy++) { const yy = y + dy; if (yy < 0 || yy >= G) continue;
      for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx < 0 || xx >= G) continue;
        if (src[(yy * G + xx) * C + 3] > 0.1) { a = 1; break; } } }
    out[y * G + x] = a;
  }
}

function step() {
  // local references keep V8's hot loops fast (module-level lets are ~10× slower here)
  const G = M.G, C = M.C, H = M.H, w1 = M.w1, b1 = M.b1, w2 = M.w2, P = 3 * C;
  const st = state, nx = next, pc = perc, hd = hidden, alA = aliveA, alB = aliveB, alU = aliveU;
  computeAlive(st, alA);
  // Cells one ring outside the living area are cleared at the end, but (as in PyTorch) their
  // update still counts when deciding whether their neighbours survive — so compute them too.
  for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) {
    let u = 0;
    for (let dy = -1; dy <= 1 && !u; dy++) { const yy = y + dy; if (yy < 0 || yy >= G) continue;
      for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx >= 0 && xx < G && alA[yy * G + xx]) { u = 1; break; } } }
    alU[y * G + x] = u;
  }
  nx.set(st);
  for (let y = 0; y < G; y++) {
    const yu = ((y - 1 + G) % G) * G, ym = y * G, yd = ((y + 1) % G) * G;
    for (let x = 0; x < G; x++) {
      if (!alU[ym + x]) continue;                  // far from any life: can't affect anything
      if (Math.random() > 0.5) continue;           // stochastic update (fire rate 0.5)
      const xl = (x - 1 + G) % G, xr = (x + 1) % G;
      const iUL = (yu + xl) * C, iU = (yu + x) * C, iUR = (yu + xr) * C;
      const iL = (ym + xl) * C, iM = (ym + x) * C, iR = (ym + xr) * C;
      const iDL = (yd + xl) * C, iD = (yd + x) * C, iDR = (yd + xr) * C;
      // perception: identity, Sobel-x, Sobel-y per channel (interleaved like torch's grouped conv)
      for (let c = 0; c < C; c++) {
        const ul = st[iUL + c], u = st[iU + c], ur = st[iUR + c];
        const l = st[iL + c], r = st[iR + c];
        const dl = st[iDL + c], d = st[iD + c], dr = st[iDR + c];
        pc[c * 3] = st[iM + c];
        pc[c * 3 + 1] = (ur + 2 * r + dr - ul - 2 * l - dl) / 8;
        pc[c * 3 + 2] = (dl + 2 * d + dr - ul - 2 * u - ur) / 8;
      }
      for (let h = 0; h < H; h++) {
        let s = b1[h]; const o = h * P;
        for (let p = 0; p < P; p++) s += w1[o + p] * pc[p];
        hd[h] = s > 0 ? s : 0;
      }
      for (let c = 0; c < C; c++) {
        let s = 0; const o = c * H;
        for (let h = 0; h < H; h++) s += w2[o + h] * hd[h];
        nx[iM + c] += s;
      }
    }
  }
  computeAlive(nx, alB);
  for (let i = 0; i < G * G; i++) if (!(alA[i] && alB[i])) nx.fill(0, i * C, i * C + C);
  state = nx; next = st;
  steps++;
}

// ── Rendering ───────────────────────────────────────────────────────────────
function render() {
  const { G, C } = M, d = img.data;
  let alive = 0, inter = 0, uni = 0;
  for (let i = 0; i < G * G; i++) {
    const o = i * C;
    const a = Math.min(1, Math.max(0, state[o + 3]));
    // premultiplied RGBA over white paper
    const r = Math.min(1, Math.max(0, state[o])), g = Math.min(1, Math.max(0, state[o + 1])), b = Math.min(1, Math.max(0, state[o + 2]));
    d[i * 4] = (1 - a + r) * 255; d[i * 4 + 1] = (1 - a + g) * 255; d[i * 4 + 2] = (1 - a + b) * 255; d[i * 4 + 3] = 255;
    const on = a > 0.1 ? 1 : 0; alive += on;
    inter += on & M.mask[i]; uni += on | M.mask[i];
  }
  ctx.putImageData(img, 0, 0);
  const health = uni ? inter / uni : 0;
  $("#sStep").textContent = fmt(steps);
  $("#sAlive").textContent = fmt(alive);
  $("#sHealth").textContent = `${Math.round(health * 100)}%`;
  if (!$("#brain").hidden) renderBrain();
}

// hidden channels as small multiples (mint = positive, pink = negative)
let brainCtx = [];
function buildBrain() {
  const g = $("#brainGrid"); g.innerHTML = ""; brainCtx = [];
  for (let k = 4; k < M.C; k++) {
    const c = document.createElement("canvas"); c.width = M.G; c.height = M.G; g.appendChild(c);
    brainCtx.push({ ctx: c.getContext("2d"), img: c.getContext("2d").createImageData(M.G, M.G), ch: k });
  }
}
function renderBrain() {
  const { G, C } = M;
  for (const b of brainCtx) {
    const d = b.img.data;
    for (let i = 0; i < G * G; i++) {
      const v = Math.max(-1, Math.min(1, state[i * C + b.ch])), t = Math.abs(v);
      const [R, Gc, B] = v >= 0 ? [52, 211, 153] : [244, 114, 182];
      d[i * 4] = 255 + (R - 255) * t; d[i * 4 + 1] = 255 + (Gc - 255) * t; d[i * 4 + 2] = 255 + (B - 255) * t; d[i * 4 + 3] = 255;
    }
    b.ctx.putImageData(b.img, 0, 0);
  }
}

// ── Main loop: run as many steps as fit in the frame budget ─────────────────
function frame() {
  requestAnimationFrame(frame);
  if (!M) return;
  if (!paused) {
    const want = +$("#speed").value, t0 = performance.now();
    for (let i = 0; i < want && performance.now() - t0 < 24; i++) step();
  }
  render();
}

// ── Wounds ──────────────────────────────────────────────────────────────────
function cut(cx, cy, r) {
  const { G, C } = M;
  for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) {
    if (x < 0 || y < 0 || x >= G || y >= G) continue;
    if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) state.fill(0, (y * G + x) * C, (y * G + x) * C + C);
  }
}
function cutHalf() {
  if (!M) return;
  const { G, C } = M, side = Math.random() < 0.5;
  for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) if (side ? x < G / 2 : y < G / 2) state.fill(0, (y * G + x) * C, (y * G + x) * C + C);
  toast("Sliced in half — watch it regrow");
}
function randomHole() {
  if (!M) return;
  const { G } = M, a = Math.random() * Math.PI * 2, d = Math.random() * G * 0.15;
  cut(G / 2 + Math.cos(a) * d, G / 2 + Math.sin(a) * d, G * (0.1 + Math.random() * 0.08));
}

const dish = $("#dish"), brush = $("#brush");
let dragging = false;
function toCell(e) {
  const r = cv.getBoundingClientRect();
  return [((e.clientX - r.left) / r.width) * M.G, ((e.clientY - r.top) / r.height) * M.G, r];
}
function moveBrush(e) {
  if (!M) return;
  const [, , r] = toCell(e), size = (+$("#brushSize").value * 2 * r.width) / M.G;
  const dr = dish.getBoundingClientRect();
  brush.style.left = e.clientX - dr.left + "px"; brush.style.top = e.clientY - dr.top + "px";
  brush.style.width = brush.style.height = size + "px";
}
dish.addEventListener("pointerdown", (e) => { if (!M) return; dragging = true; dish.setPointerCapture(e.pointerId); const [x, y] = toCell(e); cut(x, y, +$("#brushSize").value); $("#hintPill").classList.add("gone"); });
dish.addEventListener("pointermove", (e) => { moveBrush(e); if (dragging) { const [x, y] = toCell(e); cut(x, y, +$("#brushSize").value); } });
dish.addEventListener("pointerup", () => (dragging = false));

// ── Controls ────────────────────────────────────────────────────────────────
const sync = () => { $("#spdOut").textContent = `${$("#speed").value}×`; $("#brushOut").textContent = `${$("#brushSize").value} cells`; };
$("#speed").addEventListener("input", sync); $("#brushSize").addEventListener("input", sync);
const togglePause = () => { paused = !paused; $("#pauseBtn").textContent = paused ? "Play" : "Pause"; };
$("#seedBtn").onclick = seed; $("#pauseBtn").onclick = togglePause;
$("#halfBtn").onclick = cutHalf; $("#holeBtn").onclick = randomHole;
$("#showBrain").addEventListener("change", () => { $("#brain").hidden = !$("#showBrain").checked; });
addEventListener("keydown", (e) => {
  if (e.target.matches("input[type=text], textarea")) return;
  const k = e.key.toLowerCase();
  if (k === "s") seed(); else if (k === "x") cutHalf(); else if (k === "r") randomHole();
  else if (k === "h") { $("#showBrain").click(); }
  else if (e.code === "Space") { e.preventDefault(); togglePause(); }
});

sync();
if (available.length) { load(available[0].data); seed(); }
requestAnimationFrame(frame);

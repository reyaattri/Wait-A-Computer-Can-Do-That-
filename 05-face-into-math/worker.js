// TSP art engine: stipple an image into dots, then find a short tour through all of them.
// Runs off the main thread so the page stays smooth while it crunches.
let job = 0;

onmessage = (e) => {
  const m = e.data;
  if (m.type === "stipple") { job++; stipple(m, job); }
  else if (m.type === "solve") { job++; solve(m, job); }
  else if (m.type === "stop") job++;
};

// Seeded RNG so a given picture always gives the same dots.
function rng(seed) { return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296); }

// ── 1. Stippling: weighted Voronoi (Secord 2002) ─────────────────────────────
// Dots are dropped where the picture is dark, then nudged ("Lloyd relaxation")
// to the darkness-weighted centre of their own region so they spread evenly.
function stipple({ dark, w, h, n, iters }, id) {
  const r = rng(42);
  let maxD = 0; for (let i = 0; i < dark.length; i++) if (dark[i] > maxD) maxD = dark[i];
  if (maxD <= 0) maxD = 1;
  const xs = new Float32Array(n), ys = new Float32Array(n);
  let k = 0, guard = 0;
  while (k < n && guard++ < n * 400) {
    const x = r() * w, y = r() * h;
    if (r() * maxD < dark[(y | 0) * w + (x | 0)]) { xs[k] = x; ys[k] = y; k++; }
  }
  for (; k < n; k++) { xs[k] = r() * w; ys[k] = r() * h; }
  postMessage({ type: "dots", xs, ys, iter: 0, iters });

  const cell = Math.max(2, Math.sqrt((w * h) / n) * 1.2);
  const gw = Math.ceil(w / cell), gh = Math.ceil(h / cell);
  const sx = new Float64Array(n), sy = new Float64Array(n), sw = new Float64Array(n);
  for (let it = 1; it <= iters; it++) {
    if (id !== job) return;
    const grid = buildGrid(xs, ys, n, cell, gw, gh);
    sx.fill(0); sy.fill(0); sw.fill(0);
    for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
      const d = dark[py * w + px]; if (d <= 0.002) continue;
      const j = nearest(px + 0.5, py + 0.5, xs, ys, grid, cell, gw, gh);
      if (j < 0) continue;
      sx[j] += d * (px + 0.5); sy[j] += d * (py + 0.5); sw[j] += d;
    }
    for (let j = 0; j < n; j++) if (sw[j] > 0) { xs[j] = sx[j] / sw[j]; ys[j] = sy[j] / sw[j]; }
    postMessage({ type: "dots", xs, ys, iter: it, iters });
  }
  postMessage({ type: "stippled" });
}

function buildGrid(xs, ys, n, cell, gw, gh) {
  const head = new Int32Array(gw * gh).fill(-1), next = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const c = Math.min(gh - 1, Math.max(0, (ys[i] / cell) | 0)) * gw + Math.min(gw - 1, Math.max(0, (xs[i] / cell) | 0));
    next[i] = head[c]; head[c] = i;
  }
  return { head, next };
}
function nearest(x, y, xs, ys, g, cell, gw, gh) {
  const cx = (x / cell) | 0, cy = (y / cell) | 0;
  let best = -1, bd = Infinity;
  for (let r = 0; r < Math.max(gw, gh); r++) {
    for (let gy = cy - r; gy <= cy + r; gy++) {
      if (gy < 0 || gy >= gh) continue;
      for (let gx = cx - r; gx <= cx + r; gx++) {
        if (gx < 0 || gx >= gw) continue;
        if (r > 0 && gy !== cy - r && gy !== cy + r && gx !== cx - r && gx !== cx + r) continue; // ring only
        for (let i = g.head[gy * gw + gx]; i >= 0; i = g.next[i]) {
          const d = (xs[i] - x) ** 2 + (ys[i] - y) ** 2;
          if (d < bd) { bd = d; best = i; }
        }
      }
    }
    if (best >= 0 && (r * cell) ** 2 > bd) break; // nothing closer can exist further out
  }
  return best;
}

// ── 2 + 3. Tour: nearest-neighbour start, then 2-opt improvement ────────────
function solve({ xs, ys }, id) {
  const n = xs.length;
  const dist = (a, b) => Math.hypot(xs[a] - xs[b], ys[a] - ys[b]);

  // k nearest neighbours of every dot (the only swaps worth trying)
  const K = 10;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) { minX = Math.min(minX, xs[i]); minY = Math.min(minY, ys[i]); maxX = Math.max(maxX, xs[i]); maxY = Math.max(maxY, ys[i]); }
  const cell = Math.max(1e-3, Math.sqrt(((maxX - minX + 1) * (maxY - minY + 1)) / n) * 1.5);
  const gw = Math.ceil((maxX - minX + 1) / cell), gh = Math.ceil((maxY - minY + 1) / cell);
  const gx = (i) => Math.min(gw - 1, ((xs[i] - minX) / cell) | 0), gy = (i) => Math.min(gh - 1, ((ys[i] - minY) / cell) | 0);
  const buckets = Array.from({ length: gw * gh }, () => []);
  for (let i = 0; i < n; i++) buckets[gy(i) * gw + gx(i)].push(i);
  const neigh = new Int32Array(n * K);
  for (let i = 0; i < n; i++) {
    const cand = [];
    for (let r = 1; cand.length < K + 1 && r < Math.max(gw, gh) + 1; r++) {
      cand.length = 0;
      for (let y = gy(i) - r; y <= gy(i) + r; y++) for (let x = gx(i) - r; x <= gx(i) + r; x++) {
        if (x < 0 || y < 0 || x >= gw || y >= gh) continue;
        for (const j of buckets[y * gw + x]) if (j !== i) cand.push(j);
      }
    }
    cand.sort((a, b) => dist(i, a) - dist(i, b));
    for (let k = 0; k < K; k++) neigh[i * K + k] = cand[Math.min(k, cand.length - 1)] ?? i;
  }

  // greedy nearest-neighbour walk (with grid lookups so it stays fast)
  const used = new Uint8Array(n), tour = new Int32Array(n);
  let cur = 0; used[0] = 1; tour[0] = 0;
  const alive = buckets.map((b) => b.slice());
  const removeFrom = (i) => { const b = alive[gy(i) * gw + gx(i)]; const p = b.indexOf(i); if (p >= 0) { b[p] = b[b.length - 1]; b.pop(); } };
  removeFrom(0);
  for (let t = 1; t < n; t++) {
    let best = -1, bd = Infinity;
    const cx = gx(cur), cy = gy(cur);
    for (let r = 0; r <= Math.max(gw, gh); r++) {
      for (let y = cy - r; y <= cy + r; y++) {
        if (y < 0 || y >= gh) continue;
        for (let x = cx - r; x <= cx + r; x++) {
          if (x < 0 || x >= gw) continue;
          if (r > 0 && y !== cy - r && y !== cy + r && x !== cx - r && x !== cx + r) continue;
          for (const j of alive[y * gw + x]) { const d = dist(cur, j); if (d < bd) { bd = d; best = j; } }
        }
      }
      if (best >= 0 && ((r) * cell) ** 2 > bd * bd) break;
    }
    used[best] = 1; removeFrom(best); tour[t] = best; cur = best;
  }
  const length = () => { let s = 0; for (let i = 0; i < n; i++) s += dist(tour[i], tour[(i + 1) % n]); return s; };
  const firstLen = length();
  postMessage({ type: "tour", tour: tour.slice(), length: firstLen, firstLen, swaps: 0, phase: "greedy" });

  // 2-opt with neighbour lists + "don't look" bits
  const pos = new Int32Array(n); for (let i = 0; i < n; i++) pos[tour[i]] = i;
  const next = (c) => tour[(pos[c] + 1) % n], prev = (c) => tour[(pos[c] - 1 + n) % n];
  const reverse = (i, j) => { // reverse tour[i..j] circularly, choosing the shorter side
    let len = ((j - i + n) % n) + 1;
    if (len * 2 > n) { const ni = (j + 1) % n, nj = (i - 1 + n) % n; i = ni; j = nj; len = n - len; }
    for (let k = 0; k < len >> 1; k++) {
      const a = (i + k) % n, b = (j - k + n) % n;
      const ta = tour[a], tb = tour[b];
      tour[a] = tb; pos[tb] = a; tour[b] = ta; pos[ta] = b;
    }
  };
  const dontLook = new Uint8Array(n); let queue = [], qh = 0; for (let i = 0; i < n; i++) queue.push(tour[i]);
  let swaps = 0, cur2 = firstLen, lastPost = performance.now();
  const step = () => {
    if (id !== job) return;
    const until = performance.now() + 40;
    while (qh < queue.length && performance.now() < until) {
      const a = queue[qh++]; dontLook[a] = 0;
      if (qh > 65536) { queue = queue.slice(qh); qh = 0; }
      let improved = false;
      for (const dir of [1, -1]) {
        const an = dir > 0 ? next(a) : prev(a);
        const dAn = dist(a, an);
        for (let k = 0; k < K && !improved; k++) {
          const c = neigh[a * K + k], dAc = dist(a, c);
          if (dAc >= dAn) break;
          const cn = dir > 0 ? next(c) : prev(c);
          if (c === an || cn === a) continue;
          const delta = dAc + dist(an, cn) - dAn - dist(c, cn);
          if (delta < -1e-9) {
            if (dir > 0) reverse(pos[an], pos[c]); else reverse(pos[c], pos[an]);
            cur2 += delta; swaps++; improved = true;
            for (const v of [a, an, c, cn]) if (!dontLook[v]) { dontLook[v] = 1; queue.push(v); }
          }
        }
        if (improved) break;
      }
    }
    const done = qh >= queue.length;
    if (done || performance.now() - lastPost > 90) {
      lastPost = performance.now();
      postMessage({ type: "tour", tour: tour.slice(), length: done ? length() : cur2, firstLen, swaps, phase: done ? "done" : "2opt" });
    }
    if (!done) setTimeout(step, 0);
  };
  setTimeout(step, 0);
}

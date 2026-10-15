import { $, initShell, toast, fitCanvas } from "../shared/ui.js";
initShell();

// ── Identity ───────────────────────────────────────────────────────────────
const ANIMALS = ["Otter", "Falcon", "Lynx", "Panda", "Koala", "Gecko", "Orca", "Raven", "Bison", "Heron", "Puffin", "Ibex", "Tapir", "Quokka", "Narwhal", "Lemur", "Badger", "Mantis", "Walrus", "Okapi"];
// A fresh identity per page load (sessionStorage would be cloned into popups and duplicated tabs).
const n0 = Math.floor(Math.random() * ANIMALS.length);
const me = { id: Math.random().toString(36).slice(2, 9), name: ANIMALS[n0], hue: Math.floor(Math.random() * 6), born: Date.now() };
const PALETTE = ["#F472B6", "#FBBF24", "#34D399", "#8B5CF6", "#38BDF8", "#FB923C"];
const INK = "#1E293B";
const color = (h) => PALETTE[((h % PALETTE.length) + PALETTE.length) % PALETTE.length];
document.documentElement.style.setProperty("--me", color(me.hue));
$("#meName").textContent = me.name;
const baseTitle = `${me.name} · Talking Tabs`;
document.title = baseTitle;
setFavicon(color(me.hue));

function setFavicon(c) {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><circle cx='16' cy='16' r='12' fill='${c}'/></svg>`;
  $("#favicon").href = "data:image/svg+xml," + encodeURIComponent(svg);
}

// ── Geometry: where is my stage on the physical screen? ───────────────────
const stage = $("#stage"), cv = $("#cv");
let originX = null, originY = null; // viewport (0,0) in screen coords; calibrated by mouse events
function viewportOrigin() {
  if (originX !== null) {
    // window may have moved since calibration — track screenX delta
    return [originX + (screenX - calScreenX), originY + (screenY - calScreenY)];
  }
  const bx = (outerWidth - innerWidth) / 2;
  return [screenX + bx, screenY + (outerHeight - innerHeight) - bx];
}
let calScreenX = 0, calScreenY = 0;
addEventListener("pointermove", (e) => {
  originX = e.screenX - e.clientX; originY = e.screenY - e.clientY;
  calScreenX = screenX; calScreenY = screenY;
}, { passive: true });

function stageRectScreen() {
  const r = stage.getBoundingClientRect(), [ox, oy] = viewportOrigin();
  return { x: ox + r.left, y: oy + r.top, w: r.width, h: r.height };
}
const toLocal = (sx, sy) => { const s = stageRectScreen(); return [sx - s.x, sy - s.y]; };

// ── Networking ─────────────────────────────────────────────────────────────
const ch = new BroadcastChannel("wait-tabs");
const peers = new Map(); // id → {name,hue,born,rect,cursor,last,hidden}
let sent = 0, recvd = 0;
const cursor = { x: null, y: null }; // screen coords

function send(msg) {
  msg.from = me.id; msg.name = me.name; msg.hue = me.hue; msg.born = me.born;
  ch.postMessage(msg); sent++;
  if (msg.t !== "hb" && msg.t !== "ball") logLine("→", msg, true);
  else if (msg.t === "hb" && $("#showHb").checked && Math.random() < 0.15) logLine("→", msg, true);
}

function heartbeat() {
  send({ t: "hb", rect: stageRectScreen(), cursor: cursor.x === null ? null : { ...cursor }, hidden: document.hidden });
}
setInterval(heartbeat, 50);
send({ t: "hello" });
addEventListener("pagehide", () => send({ t: "bye" }));
document.addEventListener("visibilitychange", heartbeat);

ch.onmessage = ({ data: m }) => {
  recvd++;
  let p = peers.get(m.from);
  const isNew = !p;
  if (!p) { p = { id: m.from }; peers.set(m.from, p); }
  Object.assign(p, { name: m.name, hue: m.hue, born: m.born, last: performance.now() });
  if (isNew && m.t !== "bye") { toast(`${m.name} joined`); renderRoster(); send({ t: "hb", rect: stageRectScreen(), hidden: document.hidden }); }

  switch (m.t) {
    case "hb": p.rect = m.rect; p.cursor = m.cursor; p.hidden = m.hidden; break;
    case "hello": logLine("←", m); break;
    case "bye": peers.delete(m.from); toast(`${m.name} left`); renderRoster(); logLine("←", m); break;
    case "chat": bubble(m.from, m.text); logLine("←", m); break;
    case "flash": flash(color(m.hue)); logLine("←", m); break;
    case "title": applyTitle(m.text); logLine("←", m); break;
    case "throw": if (isLeader()) throwBall(m.vx, m.vy); logLine("←", m); break;
    case "grab": if (isLeader()) grabBall(m); break;
    case "ball": ball = m.ball; ball.seen = performance.now(); break;
  }
  if (m.t === "hb" && $("#showHb").checked && Math.random() < 0.15) logLine("←", m);
};

// failure detector
setInterval(() => {
  const now = performance.now();
  let changed = false;
  for (const [id, p] of peers) {
    if (now - p.last > (p.hidden ? 6000 : 1600)) { peers.delete(id); toast(`${p.name} went silent`); changed = true; }
  }
  if (changed) renderRoster();
  renderRoster(true);
  $("#rate").textContent = `${sent + recvd} msg/s`; sent = recvd = 0;
}, 1000);

// leader = oldest visible tab
function leaderId() {
  let best = document.hidden ? null : { id: me.id, born: me.born };
  for (const p of peers.values()) {
    if (p.hidden) continue;
    if (!best || p.born < best.born || (p.born === best.born && p.id < best.id)) best = p;
  }
  return best?.id ?? me.id;
}
const isLeader = () => leaderId() === me.id;

// ── Roster & log ───────────────────────────────────────────────────────────
function renderRoster(soft) {
  const all = [{ ...me, rect: stageRectScreen(), self: true }, ...peers.values()].sort((a, b) => a.born - b.born);
  const lid = leaderId();
  $("#count").innerHTML = `<b>${all.length}</b><span>${all.length === 1 ? "tab online" : "tabs online"}</span>`;
  $("#rosterCount").textContent = all.length;
  $("#emptyHint").classList.toggle("gone", all.length > 1);
  const html = all.map((p) => {
    const r = p.rect, pos = r ? `${Math.round(r.x)}, ${Math.round(r.y)}<br>${Math.round(r.w)}×${Math.round(r.h)}` : "—";
    return `<div class="peer" data-id="${p.id}"><span class="dot" style="background:${color(p.hue)};box-shadow:0 0 10px ${color(p.hue)}"></span>
      <span class="nm">${p.name}${p.self ? "<small>you</small>" : ""}${p.id === lid ? '<span class="tag">leader</span>' : ""}${p.hidden ? "<small>hidden</small>" : ""}</span>
      <span class="pos">${pos}</span></div>`;
  }).join("");
  const el = $("#roster");
  if (soft && el.children.length === all.length) {
    // update in place (no pop animation)
    [...el.children].forEach((c, i) => { const tmp = document.createElement("div"); tmp.innerHTML = html; const n = tmp.children[i]; if (n) { c.querySelector(".nm").innerHTML = n.querySelector(".nm").innerHTML; c.querySelector(".pos").innerHTML = n.querySelector(".pos").innerHTML; } });
  } else el.innerHTML = html;
}

function logLine(dir, m, mine) {
  const el = document.createElement("div");
  const who = mine ? "me" : m.name;
  const body = { hello: "hello, anyone there?", bye: "goodbye 👋", chat: `"${m.text}"`, flash: "FLASH!", title: `title → "${m.text}"`, throw: "throw the ball", hb: m.rect ? `I'm at (${Math.round(m.rect.x)}, ${Math.round(m.rect.y)})` : "♥" }[m.t] || "";
  el.innerHTML = `<span>${dir}</span> <b><i style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color(m.hue)};border:1.5px solid #1E293B;margin-right:4px"></i>${who}</b> <span class="ty">${m.t}</span> ${escapeHtml(body)}`;
  const log = $("#log");
  log.prepend(el);
  while (log.children.length > 40) log.lastChild.remove();
}
function escapeHtml(s) { return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

// ── Shared actions ─────────────────────────────────────────────────────────
const bubbles = [];
function bubble(from, text) { bubbles.push({ from, text, t: performance.now() }); }
$("#chatForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = $("#chatIn").value.trim(); if (!text) return;
  send({ t: "chat", text }); bubble(me.id, text); $("#chatIn").value = "";
});

function flash(c) {
  document.body.style.setProperty("--flash", c);
  document.body.classList.remove("flash"); void document.body.offsetWidth; document.body.classList.add("flash");
}
const TITLES = ["👀 I can see you", "🗣️ psst… over here", "🍕 order pizza", "🐈 meow", "⚠️ we are sentient"];
let titleIdx = -1;
function applyTitle(text) { document.title = text || baseTitle; }

function spawn() {
  const w = 760, h = 560;
  const n = peers.size + 1;
  let left = screenX + outerWidth + 12, top = screenY + 30 * (n % 4);
  if (left + w > screen.availWidth) { left = Math.max(0, screenX - w - 12); }
  if (left < 0 || left + w > screen.availWidth) { left = 40 + (n * 60) % Math.max(1, screen.availWidth - w); top = 40 + (n * 50) % Math.max(1, screen.availHeight - h); }
  const win = window.open(location.href, "", `popup=yes,width=${w},height=${h},left=${Math.round(left)},top=${Math.round(top)}`);
  if (!win) toast("Popup blocked — allow popups for this site");
}

$("#spawnBtn").onclick = spawn; $("#spawnHero").onclick = spawn;
$("#flashBtn").onclick = () => { send({ t: "flash" }); flash(color(me.hue)); };
$("#titleBtn").onclick = () => {
  titleIdx = (titleIdx + 1) % (TITLES.length + 1);
  const text = titleIdx === TITLES.length ? "" : TITLES[titleIdx];
  send({ t: "title", text }); applyTitle(text);
};
$("#ballBtn").onclick = () => {
  const vx = (Math.random() < 0.5 ? -1 : 1) * (900 + Math.random() * 900), vy = -900 - Math.random() * 700;
  if (isLeader()) throwBall(vx, vy); else send({ t: "throw", vx, vy });
};
addEventListener("keydown", (e) => {
  if (e.target.matches("input[type=text], textarea")) return;
  const k = e.key.toLowerCase();
  if (k === "o") spawn(); else if (k === "b") $("#ballBtn").click(); else if (k === "l") $("#flashBtn").click(); else if (k === "t") $("#titleBtn").click();
});

// ── Ball physics (only the leader simulates; everyone renders) ────────────
let ball = null, simBall = null, lastSim = performance.now();
function worldBounds() {
  const rects = [stageRectScreen(), ...[...peers.values()].filter((p) => p.rect && !p.hidden).map((p) => p.rect)];
  const x0 = Math.min(...rects.map((r) => r.x)), y0 = Math.min(...rects.map((r) => r.y));
  const x1 = Math.max(...rects.map((r) => r.x + r.w)), y1 = Math.max(...rects.map((r) => r.y + r.h));
  return { x0, y0, x1, y1 };
}
function throwBall(vx, vy) {
  const s = stageRectScreen();
  if (!simBall) simBall = ball ? { ...ball } : { x: s.x + s.w / 2, y: s.y + s.h / 2, vx: 0, vy: 0, r: 22 };
  simBall.vx = vx; simBall.vy = vy;
}
function grabBall(m) {
  if (!simBall) simBall = { ...m, vx: 0, vy: 0, r: 22 };
  simBall.x = m.x; simBall.y = m.y; simBall.vx = m.vx; simBall.vy = m.vy; simBall.held = m.held;
}
function simulate(now) {
  const dt = Math.min(0.033, (now - lastSim) / 1000); lastSim = now;
  if (!isLeader()) { simBall = null; return; }
  if (!simBall && ball && performance.now() - ball.seen < 2000) simBall = { ...ball }; // inherit after failover
  if (!simBall) return;
  const b = simBall, W = worldBounds();
  if (!b.held) {
    b.vy += 2200 * dt; b.vx *= 0.999;
    b.x += b.vx * dt; b.y += b.vy * dt;
    if (b.x < W.x0 + b.r) { b.x = W.x0 + b.r; b.vx = Math.abs(b.vx) * 0.86; }
    if (b.x > W.x1 - b.r) { b.x = W.x1 - b.r; b.vx = -Math.abs(b.vx) * 0.86; }
    if (b.y < W.y0 + b.r) { b.y = W.y0 + b.r; b.vy = Math.abs(b.vy) * 0.86; }
    if (b.y > W.y1 - b.r) { b.y = W.y1 - b.r; b.vy = -Math.abs(b.vy) * 0.8; b.vx *= 0.98; }
  }
  ball = { x: b.x, y: b.y, r: b.r, vx: b.vx, vy: b.vy, owner: me.id, seen: now };
  send({ t: "ball", ball });
}

// drag the ball with the mouse (any tab)
let drag = null;
stage.addEventListener("pointerdown", (e) => {
  if (!ball || e.target.closest(".chatbar, .empty-hint, button")) return;
  const [lx, ly] = toLocal(ball.x, ball.y), r = stage.getBoundingClientRect();
  if (Math.hypot(e.clientX - r.left - lx, e.clientY - r.top - ly) < ball.r * 1.8) {
    drag = { hist: [] }; stage.setPointerCapture(e.pointerId);
  }
});
stage.addEventListener("pointermove", (e) => {
  cursor.x = e.screenX; cursor.y = e.screenY;
  if (!drag) return;
  drag.hist.push({ x: e.screenX, y: e.screenY, t: performance.now() });
  if (drag.hist.length > 6) drag.hist.shift();
  const m = { t: "grab", x: e.screenX, y: e.screenY, vx: 0, vy: 0, held: true };
  if (isLeader()) grabBall(m); else send(m);
});
stage.addEventListener("pointerup", () => {
  if (!drag) return;
  const h = drag.hist, a = h[0], b = h[h.length - 1];
  const dt = b && a && b.t > a.t ? (b.t - a.t) / 1000 : 1;
  const m = { t: "grab", x: b?.x ?? ball.x, y: b?.y ?? ball.y, vx: b ? (b.x - a.x) / dt : 0, vy: b ? (b.y - a.y) / dt : 0, held: false };
  if (isLeader()) grabBall(m); else send(m);
  drag = null;
});
stage.addEventListener("pointerleave", () => { cursor.x = cursor.y = null; });

// ── Rendering ──────────────────────────────────────────────────────────────
let ctx, dims, trail = [];
function resize() { dims = fitCanvas(cv); ctx = cv.getContext("2d"); }
addEventListener("resize", resize); resize();

function orbPos(rect) { return toLocal(rect.x + rect.w / 2, rect.y + rect.h / 2); }

function frame(now) {
  requestAnimationFrame(frame);
  simulate(now);
  const { w, h, dpr } = dims;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.lineJoin = ctx.lineCap = "round";

  // screen-anchored dot grid: one continuous sheet of paper across every window
  const s = stageRectScreen(), gap = 24;
  ctx.fillStyle = "rgba(30,41,59,.16)";
  for (let y = -((s.y % gap) + gap) % gap; y < h; y += gap)
    for (let x = -((s.x % gap) + gap) % gap; x < w; x += gap) { ctx.beginPath(); ctx.arc(x, y, 1.2, 0, 7); ctx.fill(); }

  const nodes = [{ id: me.id, hue: me.hue, name: me.name, pos: [w / 2, h / 2], self: true }];
  for (const p of peers.values()) if (p.rect) nodes.push({ id: p.id, hue: p.hue, name: p.name, pos: orbPos(p.rect), hidden: p.hidden });

  // dashed links between every pair, with coloured packets travelling along them
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    const a = nodes[i], b = nodes[j];
    const [ax, ay] = a.pos, [bx, by] = b.pos;
    const mx = (ax + bx) / 2, my = (ay + by) / 2, len = Math.hypot(bx - ax, by - ay);
    const wob = Math.sin(now / 900 + i + j) * Math.min(50, len * 0.07);
    const nx = -(by - ay) / (len || 1), ny = (bx - ax) / (len || 1);
    const cx = mx + nx * wob, cy = my + ny * wob;
    ctx.globalAlpha = a.hidden || b.hidden ? 0.3 : 1;
    ctx.strokeStyle = INK; ctx.lineWidth = 2.5; ctx.setLineDash([9, 9]); ctx.lineDashOffset = -now / 30;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.quadraticCurveTo(cx, cy, bx, by); ctx.stroke();
    ctx.setLineDash([]);
    for (let k = 0; k < 3; k++) {
      const t = ((now / 1600 + k / 3 + i * 0.13) % 1), fwd = k % 2 === 0;
      const tt = fwd ? t : 1 - t;
      const px = (1 - tt) * (1 - tt) * ax + 2 * (1 - tt) * tt * cx + tt * tt * bx, py = (1 - tt) * (1 - tt) * ay + 2 * (1 - tt) * tt * cy + tt * tt * by;
      ctx.fillStyle = color(fwd ? a.hue : b.hue); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(px, py, 6, 0, 7); ctx.fill(); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // orbs: flat stickers with a hard shadow
  for (const n of nodes) {
    const [x, y] = n.pos, R = (n.self ? 44 : 36) * (1 + 0.04 * Math.sin(now / 420 + n.hue));
    ctx.globalAlpha = n.hidden ? 0.4 : 1;
    ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(x + 5, y + 5, R, 0, 7); ctx.fill();
    ctx.fillStyle = color(n.hue); ctx.strokeStyle = INK; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(x, y, R, 0, 7); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(x - R * 0.32, y - R * 0.32, R * 0.16, 0, 7); ctx.fill();
    // name tag
    ctx.font = "700 14px 'Plus Jakarta Sans', sans-serif";
    const label = n.self ? `${n.name} (me)` : n.name, tw = ctx.measureText(label).width + 20;
    ctx.fillStyle = "#fff"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(x - tw / 2, y + R + 12, tw, 26, 13); ctx.fill(); ctx.stroke();
    ctx.fillStyle = INK; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(label, x, y + R + 25.5);
    ctx.textBaseline = "alphabetic"; ctx.globalAlpha = 1;
    if (!n.self && (x < 0 || y < 0 || x > w || y > h)) {
      const ex = Math.max(18, Math.min(w - 18, x)), ey = Math.max(18, Math.min(h - 18, y));
      ctx.fillStyle = color(n.hue); ctx.strokeStyle = INK; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(ex, ey, 8, 0, 7); ctx.fill(); ctx.stroke();
    }
  }

  // chat bubbles (speech-bubble radius: flat bottom-left corner)
  for (let i = bubbles.length - 1; i >= 0; i--) {
    const b = bubbles[i], age = (now - b.t) / 1000;
    if (age > 5) { bubbles.splice(i, 1); continue; }
    const n = nodes.find((x) => x.id === b.from); if (!n) continue;
    const [x, y] = n.pos, rise = 78 + age * 16, a = Math.min(1, (5 - age) / 0.8);
    const pop = Math.min(1, age * 5), sc = pop < 1 ? 0.6 + 0.4 * (1 + Math.sin(pop * Math.PI * 1.2) * 0.15) * pop : 1;
    ctx.font = "700 16px 'Plus Jakarta Sans', sans-serif";
    const tw = ctx.measureText(b.text).width + 32, bx = x + 8, by = y - rise - 22;
    ctx.save(); ctx.translate(bx, by + 40); ctx.scale(sc, sc); ctx.translate(-bx, -(by + 40));
    ctx.globalAlpha = a;
    ctx.fillStyle = INK; ctx.beginPath(); ctx.roundRect(bx + 4, by + 4, tw, 40, [16, 16, 16, 0]); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.strokeStyle = INK; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.roundRect(bx, by, tw, 40, [16, 16, 16, 0]); ctx.fill(); ctx.stroke();
    ctx.fillStyle = INK; ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillText(b.text, bx + 16, by + 21);
    ctx.textBaseline = "alphabetic"; ctx.restore(); ctx.globalAlpha = 1;
  }

  // remote cursors
  for (const p of peers.values()) {
    if (!p.cursor) continue;
    const [x, y] = toLocal(p.cursor.x, p.cursor.y);
    if (x < -20 || y < -20 || x > w + 20 || y > h + 20) continue;
    ctx.fillStyle = color(p.hue); ctx.strokeStyle = INK; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + 20); ctx.lineTo(x + 5.5, y + 15); ctx.lineTo(x + 14, y + 15); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.font = "700 12px 'Plus Jakarta Sans', sans-serif"; const tw = ctx.measureText(p.name).width + 16;
    ctx.beginPath(); ctx.roundRect(x + 12, y + 18, tw, 22, 11); ctx.fill(); ctx.stroke();
    ctx.fillStyle = INK; ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillText(p.name, x + 20, y + 29.5); ctx.textBaseline = "alphabetic";
  }

  // the ball
  if (ball && now - ball.seen < 2500) {
    const [x, y] = toLocal(ball.x, ball.y);
    trail.push([ball.x, ball.y]); if (trail.length > 14) trail.shift();
    trail.forEach(([tx, ty], i) => {
      const [lx, ly] = toLocal(tx, ty);
      ctx.fillStyle = `rgba(251,191,36,${(i / trail.length) * 0.35})`;
      ctx.beginPath(); ctx.arc(lx, ly, ball.r * (i / trail.length) * 0.8, 0, 7); ctx.fill();
    });
    ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(x + 4, y + 4, ball.r, 0, 7); ctx.fill();
    ctx.fillStyle = "#FBBF24"; ctx.strokeStyle = INK; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(x, y, ball.r, 0, 7); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y, ball.r * 0.6, -0.6, 1.2); ctx.stroke();
  } else trail = [];
}
renderRoster();
requestAnimationFrame(frame);

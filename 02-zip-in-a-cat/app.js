import { $, initShell, toast, dropZone, download, bytes as fmtBytes } from "../shared/ui.js";
initShell();

const enc = new TextEncoder(), dec = new TextDecoder();
const S = { cat: null, catName: "cat", secrets: [], out: null, zipStart: -1, outName: "cat.jpg", showingZip: false };

// ── A cartoon cat, drawn as SVG and saved as a real JPEG ────────────────────
const CAT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" width="1200" height="900">
  <defs><pattern id="d" width="26" height="26" patternUnits="userSpaceOnUse"><circle cx="3" cy="3" r="2.2" fill="#1E293B" opacity=".14"/></pattern></defs>
  <rect width="800" height="600" fill="#EDE9FE"/><rect width="800" height="600" fill="url(#d)"/>
  <circle cx="400" cy="330" r="230" fill="#FBBF24" stroke="#1E293B" stroke-width="6"/>
  <path d="M90 120 120 60 150 120z" fill="#F472B6" stroke="#1E293B" stroke-width="5" stroke-linejoin="round"/>
  <circle cx="690" cy="110" r="26" fill="#34D399" stroke="#1E293B" stroke-width="5"/>
  <path d="M640 500c14-18 28-18 42 0s28 18 42 0" fill="none" stroke="#8B5CF6" stroke-width="8" stroke-linecap="round"/>
  <!-- body -->
  <ellipse cx="410" cy="520" rx="170" ry="120" fill="#FB923C" stroke="#1E293B" stroke-width="7"/>
  <path d="M560 520c90-10 120-90 70-130" fill="none" stroke="#1E293B" stroke-width="30" stroke-linecap="round"/>
  <path d="M560 520c90-10 120-90 70-130" fill="none" stroke="#FB923C" stroke-width="18" stroke-linecap="round"/>
  <!-- ears -->
  <path d="M255 205 270 70 365 160z" fill="#FB923C" stroke="#1E293B" stroke-width="7" stroke-linejoin="round"/>
  <path d="M545 205 530 70 435 160z" fill="#FB923C" stroke="#1E293B" stroke-width="7" stroke-linejoin="round"/>
  <path d="M282 180 290 110 335 155z" fill="#F472B6"/><path d="M518 180 510 110 465 155z" fill="#F472B6"/>
  <!-- head -->
  <circle cx="400" cy="290" r="165" fill="#FB923C" stroke="#1E293B" stroke-width="7"/>
  <path d="M370 135q30 25 60 0M385 160q15 12 30 0" fill="none" stroke="#1E293B" stroke-width="6" stroke-linecap="round"/>
  <!-- eyes -->
  <circle cx="335" cy="280" r="40" fill="#fff" stroke="#1E293B" stroke-width="6"/><circle cx="465" cy="280" r="40" fill="#fff" stroke="#1E293B" stroke-width="6"/>
  <circle cx="345" cy="288" r="20" fill="#1E293B"/><circle cx="475" cy="288" r="20" fill="#1E293B"/>
  <circle cx="352" cy="280" r="7" fill="#fff"/><circle cx="482" cy="280" r="7" fill="#fff"/>
  <!-- nose + mouth -->
  <path d="M385 335h30l-15 18z" fill="#F472B6" stroke="#1E293B" stroke-width="5" stroke-linejoin="round"/>
  <path d="M400 353q-12 28-36 14M400 353q12 28 36 14" fill="none" stroke="#1E293B" stroke-width="6" stroke-linecap="round"/>
  <!-- cheeks + whiskers -->
  <circle cx="290" cy="345" r="18" fill="#F472B6" opacity=".7"/><circle cx="510" cy="345" r="18" fill="#F472B6" opacity=".7"/>
  <path d="M250 330h-90M255 352l-85 18M545 330h90M545 352l85 18" stroke="#1E293B" stroke-width="6" stroke-linecap="round"/>
  <!-- paws holding a zip -->
  <rect x="330" y="455" width="140" height="92" rx="14" fill="#8B5CF6" stroke="#1E293B" stroke-width="7"/>
  <path d="M400 455v92" stroke="#1E293B" stroke-width="5" stroke-dasharray="8 7"/>
  <rect x="384" y="490" width="32" height="26" rx="6" fill="#FBBF24" stroke="#1E293B" stroke-width="5"/>
  <ellipse cx="335" cy="470" rx="34" ry="24" fill="#FB923C" stroke="#1E293B" stroke-width="7"/>
  <ellipse cx="465" cy="470" rx="34" ry="24" fill="#FB923C" stroke="#1E293B" stroke-width="7"/>
</svg>`;

async function toJpeg(src, maxSide = 1400) {
  const img = new Image();
  img.src = src; await img.decode();
  const s = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const cv = document.createElement("canvas");
  cv.width = Math.round(img.naturalWidth * s); cv.height = Math.round(img.naturalHeight * s);
  const c = cv.getContext("2d"); c.fillStyle = "#fff"; c.fillRect(0, 0, cv.width, cv.height);
  c.drawImage(img, 0, 0, cv.width, cv.height);
  const blob = await new Promise((r) => cv.toBlob(r, "image/jpeg", 0.9));
  return new Uint8Array(await blob.arrayBuffer());
}
const defaultCat = () => toJpeg("data:image/svg+xml;charset=utf-8," + encodeURIComponent(CAT_SVG));

const DEFAULT_SECRETS = [
  ["secret-note.txt", "THE QUICK BROWN FOX JUMPS OVER THE LAZY DOG\n\nIf you can read this, you just unzipped a cat. 🐈\n\nWait! A computer can do that?"],
  ["hello.py", 'print("Wait! A computer can do that?")\n\nfor life in range(9):\n    print(f"cat life #{life + 1}: still a valid zip file")\n'],
  ["treasure-map.svg", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 140"><rect width="200" height="140" rx="12" fill="#FEF3C7" stroke="#1E293B" stroke-width="4"/><path d="M20 110C60 40 90 120 130 60s40 10 50-20" fill="none" stroke="#8B5CF6" stroke-width="4" stroke-dasharray="8 6" stroke-linecap="round"/><path d="M168 28l14 14m0-14-14 14" stroke="#F472B6" stroke-width="6" stroke-linecap="round"/><circle cx="20" cy="110" r="7" fill="#34D399" stroke="#1E293B" stroke-width="3"/></svg>`],
].map(([name, text]) => ({ name, bytes: enc.encode(text) }));

// ── ZIP writer (with offsets shifted past the picture) ──────────────────────
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC_T[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

async function deflate(b) {
  if (typeof CompressionStream === "undefined") return null;
  try {
    const out = await new Response(new Blob([b]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer();
    return new Uint8Array(out);
  } catch { return null; }
}
async function inflate(b) {
  return new Uint8Array(await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer());
}

function dosTime(d = new Date()) {
  return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
}

async function buildZip(files, base) {
  const parts = [], central = [];
  let off = 0;
  const { time, date } = dosTime();
  for (const f of files) {
    const name = enc.encode(f.name), crc = crc32(f.bytes);
    const z = await deflate(f.bytes);
    const useZ = z && z.length < f.bytes.length;
    const data = useZ ? z : f.bytes, method = useZ ? 8 : 0;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, method, true);
    lh.setUint16(10, time, true); lh.setUint16(12, date, true); lh.setUint32(14, crc, true);
    lh.setUint32(18, data.length, true); lh.setUint32(22, f.bytes.length, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, method, true);
    ch.setUint16(12, time, true); ch.setUint16(14, date, true); ch.setUint32(16, crc, true);
    ch.setUint32(20, data.length, true); ch.setUint32(24, f.bytes.length, true); ch.setUint16(28, name.length, true);
    ch.setUint32(42, base + off, true); // absolute offset: counts the picture bytes in front
    parts.push(new Uint8Array(lh.buffer), name, data);
    central.push(new Uint8Array(ch.buffer), name);
    off += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((a, b) => a + b.length, 0);
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true); eocd.setUint16(8, files.length, true); eocd.setUint16(10, files.length, true);
  eocd.setUint32(12, cdSize, true); eocd.setUint32(16, base + off, true);
  return concat([...parts, ...central, new Uint8Array(eocd.buffer)]);
}

function concat(arrs) {
  const out = new Uint8Array(arrs.reduce((a, b) => a + b.length, 0));
  let o = 0; for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}

// ── ZIP reader: start at the END, follow the table of contents backwards ───
function findZip(b) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) {
    if (dv.getUint32(i, true) !== 0x06054b50) continue;
    const n = dv.getUint16(i + 10, true), cdOff = dv.getUint32(i + 16, true);
    const entries = []; let p = cdOff;
    for (let k = 0; k < n; k++) {
      if (p + 46 > b.length || dv.getUint32(p, true) !== 0x02014b50) return null;
      const nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
      entries.push({
        method: dv.getUint16(p + 10, true), csize: dv.getUint32(p + 20, true), size: dv.getUint32(p + 24, true),
        name: dec.decode(b.subarray(p + 46, p + 46 + nl)), local: dv.getUint32(p + 42, true),
      });
      p += 46 + nl + xl + cl;
    }
    const start = entries.length ? Math.min(...entries.map((e) => e.local)) : cdOff;
    return { entries, start, eocd: i };
  }
  return null;
}
async function readEntry(b, e) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const nl = dv.getUint16(e.local + 26, true), xl = dv.getUint16(e.local + 28, true);
  const data = b.subarray(e.local + 30 + nl + xl, e.local + 30 + nl + xl + e.csize);
  return e.method === 8 ? inflate(data) : data;
}

// ── Build + render ──────────────────────────────────────────────────────────
async function glue() {
  if (!S.cat) return;
  if (!S.secrets.length) { S.out = S.cat; S.zipStart = -1; }
  else { S.out = concat([S.cat, await buildZip(S.secrets, S.cat.length)]); S.zipStart = S.cat.length; }
  S.outName = `${S.catName}.jpg`;
  render(true);
  $("#dlBtn").disabled = false;
}

let photoUrl;
function render(animate) {
  const b = S.out;
  if (photoUrl) URL.revokeObjectURL(photoUrl);
  photoUrl = URL.createObjectURL(new Blob([b], { type: "image/jpeg" }));
  $("#photo").src = photoUrl;
  $("#fname").textContent = S.outName;
  $("#fsize").textContent = fmtBytes(b.length);
  $("#byteTotal").textContent = `${b.length.toLocaleString()} bytes`;
  const z = S.zipStart >= 0 ? b.length - S.zipStart : 0, j = b.length - z;
  const bar = $("#bar");
  // keep the ZIP part visible even when it's tiny compared with the photo
  const zipShare = z ? Math.max(0.16, z / b.length) : 0;
  $("#segJpg").style.flexGrow = 1 - zipShare; $("#segZip").style.flexGrow = zipShare;
  $("#segJpg span").textContent = `JPEG picture · ${fmtBytes(j)}`;
  $("#segZip span").textContent = z ? `ZIP · ${fmtBytes(z)}` : "";
  bar.classList.toggle("glued", !!z);
  if (animate && z) { bar.classList.remove("glued"); void bar.offsetWidth; bar.classList.add("glued"); }
  renderHex();
  if (S.showingZip) showZip();
}

function hexSpan(b, from, to, cls, marks) {
  let s = "";
  for (let i = from; i < to; i++) {
    if (i < 0 || i >= b.length) continue;
    const m = marks.find(([a, len]) => i >= a && i < a + len);
    s += `<i class="${m ? m[2] : cls(i)}">${b[i].toString(16).padStart(2, "0").toUpperCase()}</i> `;
  }
  return s;
}

function renderHex() {
  const b = S.out, zs = S.zipStart, has = zs >= 0;
  const cls = (i) => (has && i >= zs ? "z" : "j");
  const eocd = has ? b.length - 22 : -1;
  const jEnd = has ? zs : b.length;
  const rows = [
    { k: "Start", at: "byte 0", html: hexSpan(b, 0, 10, cls, [[0, 2, "mark-j"]]), ex: "FF D8 → “I'm a JPEG”" },
    has
      ? { k: "The seam", at: `byte ${zs.toLocaleString()}`, html: hexSpan(b, zs - 4, zs + 6, cls, [[zs - 2, 2, "mark-j"], [zs, 4, "mark-z"]]), ex: "FF D9 picture ends · PK ZIP begins" }
      : { k: "The end", at: `byte ${(jEnd - 2).toLocaleString()}`, html: hexSpan(b, jEnd - 10, jEnd, cls, [[jEnd - 2, 2, "mark-j"]]), ex: "FF D9 → picture ends" },
    has
      ? { k: "End", at: `byte ${eocd.toLocaleString()}`, html: hexSpan(b, eocd, eocd + 10, cls, [[eocd, 4, "mark-z"]]), ex: "PK 05 06 → ZIP's table of contents" }
      : { k: "Hidden", at: "", html: '<span class="muted">nothing after the picture</span>', ex: "Just a normal photo" },
  ];
  $("#hexrows").innerHTML = rows.map((r) => `<div class="hex"><div class="hk"><span>${r.k}</span><span>${r.at}</span></div><code>${r.html}</code><div class="ex">${r.ex}</div></div>`).join("");
}

const ICONS = { txt: ["📝", "#FBBF24"], md: ["📝", "#FBBF24"], py: ["🐍", "#34D399"], js: ["📜", "#34D399"], svg: ["🗺️", "#F472B6"], png: ["🖼️", "#F472B6"], jpg: ["🖼️", "#F472B6"], jpeg: ["🖼️", "#F472B6"], gif: ["🖼️", "#F472B6"], pdf: ["📄", "#FB923C"], mp3: ["🎵", "#8B5CF6"], wav: ["🎵", "#8B5CF6"] };
const ext = (n) => (n.split(".").pop() || "").toLowerCase();

function showZip() {
  const z = findZip(S.out);
  $("#imgView").hidden = true; $("#zipView").hidden = false; S.showingZip = true;
  const list = $("#filelist"); $("#peek").hidden = true;
  if (!z || !z.entries.length) {
    $("#zipCount").textContent = "";
    list.innerHTML = `<div class="file" style="cursor:default"><span class="fi" style="background:var(--muted)">🤷</span><span><b>Not a ZIP</b><small>no table of contents at the end</small></span><span></span></div>`;
  } else {
    $("#zipCount").textContent = `${z.entries.length} file${z.entries.length > 1 ? "s" : ""}`;
    list.innerHTML = z.entries.map((e, i) => {
      const [ic, col] = ICONS[ext(e.name)] || ["📦", "#CBD5E1"];
      return `<button class="file" data-i="${i}" style="animation-delay:${i * 70}ms"><span class="fi" style="background:${col}">${ic}</span><span><b>${e.name}</b><small>${fmtBytes(e.size)}</small></span><span class="open">open</span></button>`;
    }).join("");
    list.querySelectorAll(".file").forEach((el) => el.addEventListener("click", () => peek(z.entries[+el.dataset.i])));
  }
  if (!$("#backBtn")) {
    const back = document.createElement("button");
    back.id = "backBtn"; back.className = "btn backbtn"; back.textContent = "Back to the picture";
    back.onclick = showPhoto; $("#zipView").appendChild(back);
  }
}
function showPhoto() { $("#imgView").hidden = false; $("#zipView").hidden = true; S.showingZip = false; }

async function peek(e) {
  const data = await readEntry(S.out, e), x = ext(e.name), p = $("#peek");
  p.hidden = false; p.innerHTML = "";
  const mime = { svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", mp3: "audio/mpeg", wav: "audio/wav", mp4: "video/mp4" }[x];
  if (mime) {
    const el = document.createElement(mime.startsWith("image") ? "img" : mime.startsWith("audio") ? "audio" : "video");
    el.src = URL.createObjectURL(new Blob([data], { type: mime })); if (el.tagName !== "IMG") el.controls = true;
    p.appendChild(el);
  } else if (["txt", "md", "py", "js", "json", "html", "css", "csv"].includes(x) || isText(data)) {
    p.textContent = dec.decode(data.subarray(0, 6000));
  } else {
    p.textContent = `${e.name}\n${fmtBytes(data.length)} of binary data — download the cat and unzip it to open.`;
  }
}
const isText = (b) => { const n = Math.min(b.length, 512); for (let i = 0; i < n; i++) if (b[i] === 0) return false; return true; };

// ── Inputs ──────────────────────────────────────────────────────────────────
function renderSecrets() {
  $("#secretCount").textContent = S.secrets.length ? `${S.secrets.length}` : "";
  $("#secrets").innerHTML = S.secrets.map((f, i) => `<div class="secret"><span>${f.name}</span><small>${fmtBytes(f.bytes.length)}</small><button data-i="${i}" aria-label="Remove">×</button></div>`).join("") || '<div class="hint">No files — the cat is just a cat.</div>';
  $("#secrets").querySelectorAll("button").forEach((b) => b.onclick = () => { S.secrets.splice(+b.dataset.i, 1); renderSecrets(); });
}

dropZone($("#catDrop"), async ([f]) => {
  if (!f.type.startsWith("image/")) return toast("Pick an image");
  S.cat = f.type === "image/jpeg" ? new Uint8Array(await f.arrayBuffer()) : await toJpeg(URL.createObjectURL(f));
  S.catName = f.name.replace(/\.[^.]+$/, "") || "cat";
  await glue(); showPhoto(); toast("New picture — files re-hidden");
}, "image/*");
$("#defaultCat").onclick = async () => { S.cat = await defaultCat(); S.catName = "cat"; await glue(); showPhoto(); };

dropZone($("#secretDrop"), async (files) => {
  for (const f of files) S.secrets.push({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
  renderSecrets(); toast(`${files.length} file${files.length > 1 ? "s" : ""} ready — press Hide`);
});

dropZone($("#inspectDrop"), async ([f]) => {
  const b = new Uint8Array(await f.arrayBuffer());
  const z = findZip(b);
  S.out = b; S.outName = f.name; S.zipStart = z ? z.start : -1;
  render(true); $("#dlBtn").disabled = true;
  const isJpeg = b[0] === 0xff && b[1] === 0xd8;
  toast(z && isJpeg ? `Caught one! ${z.entries.length} hidden file(s)` : z ? "It's a ZIP" : "Nothing hidden here");
  if (z) showZip(); else showPhoto();
});

$("#glueBtn").onclick = async () => { await glue(); showPhoto(); toast(S.secrets.length ? "Hidden! Still looks like a cat" : "Add some files first"); };
$("#dlBtn").onclick = () => download(new Blob([S.out], { type: "image/jpeg" }), S.outName);
$("#openZipBtn").onclick = showZip;
addEventListener("keydown", (e) => {
  if (e.target.matches("input, textarea")) return;
  if (e.key === "z" || e.key === "Z") S.showingZip ? showPhoto() : showZip();
  else if (e.key === "h" || e.key === "H") $("#glueBtn").click();
});

S.secrets = DEFAULT_SECRETS.slice();
renderSecrets();
S.cat = await defaultCat();
await glue();

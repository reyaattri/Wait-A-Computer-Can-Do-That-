// Shared UI helpers for every demo: notes drawer, toast, presentation mode, slider fill.
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export function toast(msg, ms = 1800) {
  let t = $(".toast");
  if (!t) { t = document.createElement("div"); t.className = "toast"; document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove("show"), ms);
}

export function paintRange(el) {
  const p = ((el.value - el.min) / (el.max - el.min)) * 100;
  el.style.setProperty("--p", p + "%");
}

export function initShell() {
  $$('input[type="range"]').forEach((r) => { paintRange(r); r.addEventListener("input", () => paintRange(r)); });
  const notes = $(".notes");
  const toggleNotes = () => notes && notes.classList.toggle("open");
  $$("[data-notes]").forEach((b) => b.addEventListener("click", toggleNotes));
  $$("[data-present]").forEach((b) => b.addEventListener("click", togglePresent));
  addEventListener("keydown", (e) => {
    if (e.target.matches("input[type=text], textarea")) return;
    if (e.key === "n" || e.key === "N") toggleNotes();
    else if (e.key === "p" || e.key === "P") togglePresent();
    else if (e.key === "f" || e.key === "F") {
      document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
    } else if (e.key === "Escape" && notes) notes.classList.remove("open");
  });
}

function togglePresent() {
  document.body.classList.toggle("present");
  dispatchEvent(new Event("resize"));
}

// Segmented control: <div class="seg" data-name="mode"><button data-v="a" class="on">…</button>…</div>
export function seg(el, onChange) {
  const btns = $$("button", el);
  btns.forEach((b) => b.addEventListener("click", () => {
    btns.forEach((x) => x.classList.toggle("on", x === b));
    onChange(b.dataset.v);
  }));
  return {
    set(v) { btns.forEach((x) => x.classList.toggle("on", x.dataset.v === v)); },
    get() { return btns.find((x) => x.classList.contains("on"))?.dataset.v; },
  };
}

export function fmt(n, d = 0) {
  return Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

export function bytes(n) {
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / 1024 / 1024).toFixed(2) + " MB";
}

export function dropZone(el, onFiles, accept) {
  const input = document.createElement("input");
  input.type = "file"; input.multiple = true; if (accept) input.accept = accept;
  input.style.display = "none"; el.appendChild(input);
  el.addEventListener("click", (e) => { if (e.target !== input) input.click(); });
  input.addEventListener("change", () => { if (input.files.length) onFiles([...input.files]); input.value = ""; });
  el.addEventListener("dragover", (e) => { e.preventDefault(); el.classList.add("over"); });
  el.addEventListener("dragleave", () => el.classList.remove("over"));
  el.addEventListener("drop", (e) => {
    e.preventDefault(); el.classList.remove("over");
    if (e.dataTransfer.files.length) onFiles([...e.dataTransfer.files]);
  });
}

export function download(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

// Fit a canvas to its parent at device pixel ratio. Returns {w,h,dpr} in CSS px.
export function fitCanvas(cv, parent = cv.parentElement) {
  const r = parent.getBoundingClientRect();
  const dpr = Math.min(devicePixelRatio || 1, 2);
  cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
  cv.style.width = r.width + "px"; cv.style.height = r.height + "px";
  return { w: r.width, h: r.height, dpr };
}

// Guest mode: people who arrive through a QR link only get the sessions that link opens.
// ?guest=04 opens just session 04; ?guest=01,04,05 opens those three (remembered on this device).
// ?unlock clears it. GitHub Pages is static, so this is a polite lock for visitors, not real security.
(() => {
  const KEY = "wait-guest";
  const HREF = {
    "01": "01-healing-pixels/", "02": "02-zip-in-a-cat/", "03": "03-talking-tabs/",
    "04": "04-picture-in-sound/", "05": "05-face-into-math/",
  };
  const params = new URLSearchParams(location.search);
  try {
    const g = params.get("guest") || "";
    if (params.has("unlock")) localStorage.removeItem(KEY);
    else if (/^0[1-5](,0[1-5])*$/.test(g)) localStorage.setItem(KEY, g);
  } catch {}
  let saved = null;
  try { saved = localStorage.getItem(KEY); } catch {}
  if (!saved) return;
  const open = saved.split(",").filter((n) => HREF[n]);
  if (!open.length) return;

  const root = location.pathname.replace(/\/0[1-5]-[^/]+\/.*$/, "/").replace(/[^/]*$/, "");
  const here = (location.pathname.match(/\/(0[1-5])-[^/]+\//) || [])[1] || null;
  document.documentElement.classList.add("guest");

  // A locked session page: cover it and point to what is open.
  if (here && !open.includes(here)) {
    document.documentElement.classList.add("guest-locked");
    addEventListener("DOMContentLoaded", () => {
      const go = open.length === 1
        ? `<a class="btn primary lg" href="${root}${HREF[open[0]]}">Go to Session ${open[0]}</a>`
        : `<a class="btn primary lg" href="${root}">See what's open</a>`;
      const el = document.createElement("div");
      el.className = "lock-screen";
      el.innerHTML = `<div class="lock-card">
          <div class="lock-badge"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg></div>
          <h2>This one's still locked</h2>
          <p>It'll open in a later session. For now, there's something waiting for you here:</p>
          ${go}
        </div>`;
      document.body.appendChild(el);
    });
  }

  // The hub: lock every card that isn't open.
  addEventListener("DOMContentLoaded", () => {
    const openHrefs = open.map((n) => HREF[n]);
    document.querySelectorAll("a.s[href]").forEach((a) => {
      if (openHrefs.includes(a.getAttribute("href"))) { a.classList.add("unlocked"); return; }
      a.classList.add("locked");
      a.setAttribute("aria-disabled", "true");
      a.removeAttribute("href");
      a.insertAdjacentHTML("beforeend", '<span class="lock-tag"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>Locked</span>');
    });
  });
})();

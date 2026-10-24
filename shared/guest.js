// Guest mode: people who arrive through a QR link only get one session.
// ?guest=04 locks everything except session 04 (remembered on this device); ?unlock clears it.
// GitHub Pages is static, so this is a polite lock for visitors, not real security.
(() => {
  const KEY = "wait-guest";
  const params = new URLSearchParams(location.search);
  try {
    if (params.has("unlock")) localStorage.removeItem(KEY);
    else if (/^0[1-5]$/.test(params.get("guest") || "")) localStorage.setItem(KEY, params.get("guest"));
  } catch {}
  let allowed = null;
  try { allowed = localStorage.getItem(KEY); } catch {}
  if (!allowed) return;

  const root = location.pathname.replace(/\/0[1-5]-[^/]+\/.*$/, "/").replace(/[^/]*$/, "");
  const here = (location.pathname.match(/\/(0[1-5])-[^/]+\//) || [])[1] || null;
  const allowedHref = {
    "01": "01-healing-pixels/", "02": "02-zip-in-a-cat/", "03": "03-talking-tabs/",
    "04": "04-picture-in-sound/", "05": "05-face-into-math/",
  }[allowed];
  document.documentElement.classList.add("guest");

  // A locked session page: cover it and point to the one that's open.
  if (here && here !== allowed) {
    document.documentElement.classList.add("guest-locked");
    addEventListener("DOMContentLoaded", () => {
      const el = document.createElement("div");
      el.className = "lock-screen";
      el.innerHTML = `<div class="lock-card">
          <div class="lock-badge"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg></div>
          <h2>This one's still locked</h2>
          <p>It'll open in a later session. For now, there's something waiting for you here:</p>
          <a class="btn primary lg" href="${root}${allowedHref}">Go to Session ${allowed}</a>
        </div>`;
      document.body.appendChild(el);
    });
  }

  // The hub: lock every card except the allowed one.
  addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("a.s[href]").forEach((a) => {
      if (a.getAttribute("href") === allowedHref) { a.classList.add("unlocked"); return; }
      a.classList.add("locked");
      a.setAttribute("aria-disabled", "true");
      a.removeAttribute("href");
      a.insertAdjacentHTML("beforeend", '<span class="lock-tag"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>Locked</span>');
    });
  });
})();

/* Wedding registry hub. Reads data/registry.json and renders stores, gifts and funds.
   Claims ("I bought this") go to the backend set in registry.json -> claims.backend:
     "local"      demo mode, saved only in this browser
     "firebase"   Firebase Realtime Database over REST (no SDK)
     "appsscript" Google Sheet via an Apps Script web app (backend/apps-script/Code.gs)
*/
(function () {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const slug = (s) => String(s).toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_]+/g, "-").replace(/-+/g, "-").slice(0, 80);
  const safeUrl = (u) => (/^https?:\/\//i.test(u || "") ? u : "");
  const money = (n) => (typeof n === "number" ? n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n % 1 ? 2 : 0 }) : "");

  const store = {
    get(k, fallback) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch { return fallback; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  };

  // ---------- Claim backends. Each returns { itemId: [{ key, name, at }] } ----------
  function makeBackend(cfg) {
    const kind = (cfg && cfg.backend) || "local";

    if (kind === "firebase") {
      const base = String(cfg.firebaseUrl || "").replace(/\/+$/, "");
      const toList = (obj) => {
        const out = {};
        for (const [id, entries] of Object.entries(obj || {})) {
          out[id] = Object.entries(entries || {}).map(([key, v]) => ({ key, name: v.name || "", at: v.at || 0 }));
        }
        return out;
      };
      return {
        kind,
        async list() {
          const r = await fetch(`${base}/claims.json`, { cache: "no-store" });
          if (!r.ok) throw new Error(`Firebase read failed (${r.status})`);
          return toList(await r.json());
        },
        async claim(id, name) {
          const r = await fetch(`${base}/claims/${encodeURIComponent(id)}.json`, {
            method: "POST",
            body: JSON.stringify({ name, at: Date.now() }),
          });
          if (!r.ok) throw new Error(`Firebase write failed (${r.status})`);
          return (await r.json()).name;
        },
        async unclaim(id, key) {
          const r = await fetch(`${base}/claims/${encodeURIComponent(id)}/${encodeURIComponent(key)}.json`, { method: "DELETE" });
          if (!r.ok) throw new Error(`Firebase delete failed (${r.status})`);
        },
      };
    }

    if (kind === "appsscript") {
      const url = cfg.appsScriptUrl;
      // text/plain avoids a CORS preflight, which Apps Script can't answer.
      const post = async (payload) => {
        const r = await fetch(url, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(payload) });
        const j = await r.json();
        if (!j.ok) throw new Error(j.error || "Apps Script error");
        return j;
      };
      return {
        kind,
        async list() {
          const r = await fetch(`${url}?action=list&t=${Date.now()}`);
          const j = await r.json();
          if (!j.ok) throw new Error(j.error || "Apps Script error");
          return j.claims || {};
        },
        async claim(id, name) { return (await post({ action: "claim", id, name })).key; },
        async unclaim(id, key) { await post({ action: "unclaim", id, key }); },
      };
    }

    // local demo
    const K = "registry.demoClaims";
    return {
      kind: "local",
      async list() { return store.get(K, {}); },
      async claim(id, name) {
        const all = store.get(K, {});
        const key = "k" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        (all[id] = all[id] || []).push({ key, name, at: Date.now() });
        store.set(K, all);
        return key;
      },
      async unclaim(id, key) {
        const all = store.get(K, {});
        all[id] = (all[id] || []).filter((c) => c.key !== key);
        store.set(K, all);
      },
    };
  }

  // ---------- State ----------
  const MINE = "registry.myClaims"; // { itemId: [key, ...] } claims made on this device
  let data, backend, storesById = {};
  let claims = {};
  let filterStore = "all";
  let pendingItem = null;

  const myKeys = (id) => (store.get(MINE, {})[id] || []);
  function rememberMine(id, key) { const m = store.get(MINE, {}); (m[id] = m[id] || []).push(key); store.set(MINE, m); }
  function forgetMine(id, key) { const m = store.get(MINE, {}); m[id] = (m[id] || []).filter((k) => k !== key); store.set(MINE, m); }

  const setStatus = (msg) => { $("#status").textContent = msg || ""; };

  // ---------- Rendering ----------
  function renderHeader() {
    document.title = `${data.couple || "Our Wedding"} · Registry`;
    $("#couple").textContent = data.couple || "Our Wedding";
    $("#date").textContent = data.date || "";
    $("#intro").textContent = data.intro || "";
  }

  function renderStores() {
    $("#stores").innerHTML = data.stores
      .filter((s) => safeUrl(s.url))
      .map((s) => `<a class="store-btn" href="${esc(safeUrl(s.url))}" target="_blank" rel="noopener">${esc(s.name)} registry <span class="arrow" aria-hidden="true">↗</span></a>`)
      .join("");

    const used = new Set(data.items.map((i) => i.store));
    const chips = [{ id: "all", name: "All" }, ...data.stores.filter((s) => used.has(s.id))];
    $("#store-filter").innerHTML = chips
      .map((s) => `<button class="chip" type="button" data-store="${esc(s.id)}" aria-pressed="${s.id === filterStore}">${esc(s.name)}</button>`)
      .join("");
  }

  function renderFunds() {
    const funds = (data.funds || []).filter((f) => safeUrl(f.venmo) || safeUrl(f.paypal) || safeUrl(f.url));
    $("#funds-section").hidden = funds.length === 0;
    $("#funds").innerHTML = funds.map((f) => {
      const links = [
        safeUrl(f.venmo) && `<a class="btn primary" href="${esc(f.venmo)}" target="_blank" rel="noopener">Venmo</a>`,
        safeUrl(f.paypal) && `<a class="btn ghost" href="${esc(f.paypal)}" target="_blank" rel="noopener">PayPal</a>`,
        safeUrl(f.url) && `<a class="btn ghost" href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.label || "Give")}</a>`,
      ].filter(Boolean).join("");
      return `<article class="fund"><h3>${esc(f.name)}</h3><p>${esc(f.note || "")}</p><div class="actions">${links}</div></article>`;
    }).join("");
  }

  function initials(name) {
    return String(name).split(/\s+/).filter((w) => /^[A-Za-z]/.test(w)).slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "♥";
  }

  function renderGrid() {
    const hideClaimed = $("#hide-claimed").checked;
    const sort = $("#sort").value;
    let items = data.items.map((it, idx) => {
      const n = (claims[it.id] || []).length;
      return { ...it, idx, claimed: n, left: Math.max(0, it.qty - n) };
    });
    if (filterStore !== "all") items = items.filter((i) => i.store === filterStore);
    if (hideClaimed) items = items.filter((i) => i.left > 0);
    if (sort === "price-asc") items.sort((a, b) => (a.price ?? 1e9) - (b.price ?? 1e9));
    if (sort === "price-desc") items.sort((a, b) => (b.price ?? -1) - (a.price ?? -1));
    // Gifts still needed first, gifted ones sink to the bottom.
    items.sort((a, b) => (a.left === 0) - (b.left === 0));

    if (!items.length) { $("#grid").innerHTML = `<p class="empty">Nothing to show here. Everything may already be gifted!</p>`; return; }

    $("#grid").innerHTML = items.map((it) => {
      const s = storesById[it.store];
      const done = it.left === 0;
      const mine = myKeys(it.id).filter((k) => (claims[it.id] || []).some((c) => c.key === k));
      const img = safeUrl(it.image) || (it.image && !/^[a-z]+:/i.test(it.image) ? it.image : "");
      const thumb = img
        ? `<img src="${esc(img)}" alt="" loading="lazy">`
        : `<span class="ph" aria-hidden="true">${esc(initials(it.name))}</span>`;
      const qtyLine = it.qty > 1 ? `<span class="qty">${done ? `All ${it.qty} gifted` : `${it.left} of ${it.qty} still needed`}</span>` : "";
      const buy = !done && safeUrl(it.url) ? `<a class="btn primary" href="${esc(it.url)}" target="_blank" rel="noopener">Buy${s && safeUrl(s.url) ? ` at ${esc(s.name)}` : ""}</a>` : "";
      const claimBtn = !done ? `<button class="btn ghost" type="button" data-claim="${esc(it.id)}">I bought this</button>` : "";
      const undo = mine.length ? `<button class="btn link" type="button" data-unclaim="${esc(it.id)}" data-key="${esc(mine[mine.length - 1])}">Undo my claim</button>` : "";
      return `<article class="card${done ? " done" : ""}">
        <div class="thumb">${thumb}${done ? `<span class="badge">Gifted ✓</span>` : ""}</div>
        <div class="body">
          ${s ? `<span class="store-tag">${esc(s.name)}</span>` : ""}
          <h3 class="name">${esc(it.name)}</h3>
          ${typeof it.price === "number" ? `<span class="price">${money(it.price)}</span>` : ""}
          ${qtyLine}
          ${it.note ? `<span class="qty">${esc(it.note)}</span>` : ""}
          <div class="actions">${buy}${claimBtn}${undo}</div>
        </div>
      </article>`;
    }).join("");
  }

  // ---------- Claims ----------
  async function refreshClaims({ quiet } = {}) {
    try {
      claims = await backend.list();
      if (!quiet) setStatus(backend.kind === "local" ? "Demo mode: claims are only saved in this browser until a backend is set up (see README)." : "");
    } catch (e) {
      console.error(e);
      setStatus("Couldn't load which gifts are taken. You can still shop, but double-check with us first.");
    }
    renderGrid();
  }

  function openClaim(id) {
    pendingItem = data.items.find((i) => i.id === id);
    if (!pendingItem) return;
    $("#claim-item").textContent = pendingItem.name;
    $("#claim-name").value = store.get("registry.guestName", "");
    const dlg = $("#claim-dialog");
    if (typeof dlg.showModal === "function") dlg.showModal();
    else if (confirm(`Mark "${pendingItem.name}" as bought?`)) submitClaim();
  }

  async function submitClaim() {
    const it = pendingItem;
    if (!it) return;
    const name = $("#claim-name").value.trim().slice(0, 80);
    store.set("registry.guestName", name);
    const btn = $("#claim-confirm");
    btn.disabled = true;
    try {
      await refreshClaims({ quiet: true });
      if ((claims[it.id] || []).length >= it.qty) {
        setStatus(`Someone just claimed "${it.name}". Thanks for checking!`);
      } else {
        const key = await backend.claim(it.id, name);
        rememberMine(it.id, key);
        setStatus(`Thank you${name ? ", " + name : ""}! "${it.name}" is marked as bought.`);
      }
    } catch (e) {
      console.error(e);
      setStatus("Sorry, that didn't save. Please try again in a moment.");
    } finally {
      btn.disabled = false;
      $("#claim-dialog").close?.();
      pendingItem = null;
      await refreshClaims({ quiet: true });
    }
  }

  async function unclaim(id, key) {
    const it = data.items.find((i) => i.id === id);
    try {
      await backend.unclaim(id, key);
      forgetMine(id, key);
      setStatus(`Undone. "${it ? it.name : id}" is available again.`);
    } catch (e) {
      console.error(e);
      setStatus("Couldn't undo that. Please try again.");
    }
    await refreshClaims({ quiet: true });
  }

  // ---------- Wiring ----------
  function wire() {
    $("#store-filter").addEventListener("click", (e) => {
      const b = e.target.closest("[data-store]");
      if (!b) return;
      filterStore = b.dataset.store;
      document.querySelectorAll("#store-filter .chip").forEach((c) => c.setAttribute("aria-pressed", String(c === b)));
      renderGrid();
    });
    $("#hide-claimed").addEventListener("change", renderGrid);
    $("#sort").addEventListener("change", renderGrid);
    $("#grid").addEventListener("click", (e) => {
      const c = e.target.closest("[data-claim]");
      if (c) return openClaim(c.dataset.claim);
      const u = e.target.closest("[data-unclaim]");
      if (u) unclaim(u.dataset.unclaim, u.dataset.key);
    });
    $("#claim-form").addEventListener("submit", (e) => { e.preventDefault(); submitClaim(); });
    $("#claim-cancel").addEventListener("click", () => { pendingItem = null; $("#claim-dialog").close(); });
    // Keep claims fresh while a guest is browsing.
    setInterval(() => document.visibilityState === "visible" && refreshClaims({ quiet: true }), 30000);
    document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && refreshClaims({ quiet: true }));
  }

  async function init() {
    try {
      const r = await fetch("data/registry.json", { cache: "no-store" });
      data = await r.json();
    } catch (e) {
      console.error(e);
      setStatus("Couldn't load the registry. If you just edited data/registry.json, check it for a missing comma or quote.");
      return;
    }
    data.stores = data.stores || [];
    data.items = (data.items || []).map((it) => ({
      ...it,
      id: it.id || slug(`${it.store || ""}-${it.name}`),
      qty: Math.max(1, parseInt(it.qty, 10) || 1),
    }));
    storesById = Object.fromEntries(data.stores.map((s) => [s.id, s]));
    backend = makeBackend(data.claims);

    renderHeader();
    renderStores();
    renderFunds();
    wire();
    renderGrid();
    refreshClaims();
  }

  init();
})();

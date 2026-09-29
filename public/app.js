/* X09 Docs — app */
(() => {
  "use strict";

  // ---------- X09 shared physics + account kit (public/x09/) ----------
  X09Space.start({ density: 0.8, opacity: 0.75, bodies: false });
  X09.init({ site: "docs" });

  // =====================================================================
  //  X09 DOCS
  // =====================================================================
  const R = window.X09Render;
  const { TYPES, esc, money, fmtDate } = R;
  const $ = (id) => document.getElementById(id);
  const body = document.body;
  const els = {
    input: $("input"), send: $("send"), form: $("composer"), toast: $("toast"),
    accountBtn: $("accountBtn"), accountMenu: $("accountMenu"),
    authModal: $("authModal"), authForm: $("authForm"), authEmail: $("authEmail"), authPassword: $("authPassword"),
    authError: $("authError"), authSubmit: $("authSubmit"), authTitle: $("authTitle"),
    plansModal: $("plansModal"), plansList: $("plansList"),
    bizModal: $("bizModal"), bizForm: $("bizForm"), sendModal: $("sendModal"),
    edForm: $("edForm"), preview: $("preview"), saveState: $("saveState"), working: $("working"),
  };
  const CURRENCIES = ["USD", "CAD", "EUR", "GBP", "AUD", "NZD", "MXN", "INR", "JPY", "ZAR", "CHF", "SEK", "NOK", "DKK", "BRL", "SGD", "AED", "PHP", "NGN"];
  const STATUS_LABEL = { draft: "Draft", sent: "Sent", viewed: "Viewed", accepted: "Accepted", declined: "Declined", paid: "Paid", void: "Void" };
  const STATUS_FOR = {
    invoice: ["draft", "sent", "viewed", "paid", "void"],
    estimate: ["draft", "sent", "viewed", "accepted", "declined", "void"],
    proposal: ["draft", "sent", "viewed", "accepted", "declined", "void"],
    contract: ["draft", "sent", "viewed", "accepted", "declined", "void"],
  };
  const EXAMPLES = {
    invoice: [
      ["Roof repair", "Invoice Mike Lee for a leak repair: 6 hrs labor at $85/hr, flashing kit $140, due in 7 days"],
      ["Web design", "Invoice Brightside Dental for a 5-page website, $2,400, plus 3 months hosting at $30/mo"],
      ["Cleaning", "Invoice Sarah for 4 weekly house cleanings at $140 each in October"],
      ["Consulting", "Invoice Acme Co for 12 hours of marketing consulting at $150/hr"],
    ],
    estimate: [
      ["Roof replacement", "Estimate for Ana Diaz: tear off and replace 24 squares architectural shingles, new underlayment, drip edge, dumpster and permit"],
      ["Bathroom remodel", "Estimate a small bathroom remodel: demo, new vanity, toilet, tile floor 45 sq ft, paint"],
      ["Lawn care", "Estimate weekly mowing, edging and blowing for a 1/4 acre lot, April through October"],
      ["HVAC", "Estimate replacing a 3-ton AC condenser and evaporator coil, with labor and haul-away"],
    ],
    proposal: [
      ["Social media", "Proposal for Bella's Bakery: 3 months of Instagram + TikTok management, 12 posts and 8 reels a month, $900/mo"],
      ["AI automation", "Proposal for a roofing company: missed-call text-back and review requests, $500 setup + $297/mo"],
      ["Event photography", "Quote for wedding photography: 8 hours, 2 photographers, online gallery, $3,200"],
      ["Commercial cleaning", "Proposal for nightly office cleaning of a 6,000 sq ft office, 5 nights a week"],
    ],
    contract: [
      ["Contractor agreement", "Service contract for a roof replacement for Ana Diaz, $14,500, 50% deposit, 3 day job, 10-year workmanship warranty"],
      ["Freelance design", "Freelance design contract: brand identity for Nova Fitness, $3,000 in 2 milestones, 2 rounds of revisions"],
      ["Monthly retainer", "Monthly retainer agreement for social media management, $900/mo, 30-day cancellation notice"],
      ["Cleaning service", "Recurring house cleaning agreement, biweekly, $160 per visit, 24-hour cancellation policy"],
    ],
  };
  const PLACEHOLDER = {
    invoice: "Who is it for, what did you do, and what does it cost? e.g. “Invoice Mike Lee for 6 hrs labor at $85/hr plus a $140 flashing kit”",
    estimate: "Describe the job and any prices you know — X09 fills in the line items.",
    proposal: "Who is the client, what are you offering, and what does it cost?",
    contract: "Who are the parties, what's the work, price, schedule and any special terms?",
  };

  // ---------- State ----------
  let user = null, plans = [], docs = [], biz = null;
  let current = null;             // full open document
  let docType = "invoice";
  let filter = "all";
  let authTab = "login";
  let saveTimer = null, dirty = false, saving = null;

  const hasPlan = () => !!(user && user.plan);
  const session = {
    get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch {} },
  };
  const todayISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };

  // ---------- API ----------
  async function api(path, opts = {}) {
    const res = await fetch(path, {
      method: opts.method || "GET",
      headers: opts.body ? { "content-type": "application/json" } : {},
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      credentials: "same-origin",
      keepalive: !!opts.keepalive,
    });
    let data = null;
    try { data = await res.json(); } catch {}
    if (!res.ok) {
      const err = new Error(data?.error || `Request failed (${res.status})`);
      err.status = res.status; err.code = data?.code;
      throw err;
    }
    return data;
  }
  function toast(msg, ms = 3200) {
    els.toast.textContent = msg;
    els.toast.classList.add("show");
    clearTimeout(toast.t);
    toast.t = setTimeout(() => els.toast.classList.remove("show"), ms);
  }
  function handleErr(err) {
    if (err.status === 401) { X09.setUser(null); showAuth("login"); return; }
    if (err.code === "plan_required") { refreshMe().then(showPlans); return; }
    toast(err.message, err.code === "limit_reached" ? 7000 : 4500);
  }

  // ---------- Modals ----------
  function openModal(m) { m.hidden = false; requestAnimationFrame(() => m.classList.add("open")); }
  function closeModal(m) { m.classList.remove("open"); setTimeout(() => (m.hidden = true), 200); }
  document.querySelectorAll(".modal").forEach((m) => {
    m.addEventListener("click", (e) => { if (e.target === m || e.target.closest("[data-close]")) closeModal(m); });
  });

  // ---------- Auth ----------
  function showAuth(tab = "login") {
    setAuthTab(tab);
    openModal(els.authModal);
    setTimeout(() => els.authEmail.focus(), 60);
  }
  function setAuthTab(tab) {
    authTab = tab;
    document.querySelectorAll(".tabs [data-tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));
    els.authTitle.textContent = tab === "login" ? "Sign in to X09 Docs" : "Create your account";
    els.authSubmit.textContent = tab === "login" ? "Sign in" : "Create account";
    els.authPassword.autocomplete = tab === "login" ? "current-password" : "new-password";
    els.authError.textContent = "";
  }
  document.querySelectorAll(".tabs [data-tab]").forEach((b) => b.addEventListener("click", () => setAuthTab(b.dataset.tab)));
  els.authForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = els.authEmail.value.trim(), password = els.authPassword.value;
    if (!email || !password) { els.authError.textContent = "Enter your email and password."; return; }
    if (authTab === "signup" && password.length < 8) { els.authError.textContent = "Password must be at least 8 characters."; return; }
    els.authSubmit.disabled = true; els.authError.textContent = "";
    try {
      const data = await api(authTab === "login" ? "/api/auth/login" : "/api/auth/signup", { method: "POST", body: { email, password } });
      X09.setUser(data.user); els.authPassword.value = "";
      closeModal(els.authModal);
      renderAccount();
      await loadAll();
      if (hasPlan()) toast("Welcome aboard.");
      else showPlans();
    } catch (err) { els.authError.textContent = err.message; }
    finally { els.authSubmit.disabled = false; }
  });

  // ---------- Plans ----------
  function renderPlans() {
    els.plansList.innerHTML = "";
    for (const p of plans) {
      const cur = user && user.plan === p.key;
      const card = document.createElement("div");
      card.className = "plan" + (p.featured ? " featured" : "") + (cur ? " current" : "");
      card.innerHTML = `
        ${p.featured ? '<span class="badge mono">Most popular</span>' : ""}
        <div class="plan-name mono">${esc(p.name)}</div>
        <div class="plan-price">${esc(p.price)}<span>/mo</span></div>
        <p class="plan-blurb">${esc(p.blurb)}</p>
        <ul>
          <li><b>${p.ai.toLocaleString()}</b> AI drafts / mo</li>
          <li><b>Unlimited</b> documents</li>
          <li>Client links, e-signatures &amp; PDF</li>
          <li>${p.whiteLabel ? "<b>No X09 branding</b> for clients" : "Invoices, estimates, proposals, contracts"}</li>
        </ul>
        <button class="${p.featured ? "btn-primary" : "btn-ghost"}" data-plan="${p.key}" ${cur ? "disabled" : ""}>${cur ? "Current plan" : "Choose " + esc(p.name)}</button>`;
      els.plansList.appendChild(card);
    }
  }
  async function showPlans() {
    if (!plans.length) { try { plans = (await api("/api/plans")).plans; } catch {} }
    renderPlans(); openModal(els.plansModal);
  }
  els.plansList.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-plan]"); if (!b) return;
    if (!user) { closeModal(els.plansModal); showAuth("signup"); return; }
    b.disabled = true; const label = b.textContent; b.textContent = "Opening secure checkout…";
    try {
      rememberComposer();
      const { url } = await api("/api/billing/checkout", { method: "POST", body: { plan: b.dataset.plan } });
      location.href = url;
    } catch (err) { toast(err.message, 5000); b.disabled = false; b.textContent = label; }
  });
  function rememberComposer() {
    session.set("x09docs.draft", els.input.value.trim() ? JSON.stringify({ type: docType, text: els.input.value }) : null);
  }

  // ---------- Account menu ----------
  const RAIL_ICON = $("railProfile").innerHTML;
  function initials() {
    if (!user) return "";
    const src = (user.name || "").trim();
    if (src) return src.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
    return user.email[0].toUpperCase();
  }
  function resetDate() { const n = new Date(); n.setUTCMonth(n.getUTCMonth() + 1, 1); return n.toLocaleDateString([], { month: "short", day: "numeric" }); }
  function renderAccount() {
    const rail = $("railProfile");
    if (user) { rail.classList.add("has-user"); X09.paintAvatar(rail, user); rail.dataset.tip = user.name || user.email; }
    else { rail.classList.remove("has-user", "has-photo"); rail.style.backgroundImage = ""; rail.innerHTML = RAIL_ICON; rail.dataset.tip = "Sign in"; }
    const btn = els.accountBtn;
    if (!user) { btn.textContent = "Sign in"; btn.classList.remove("signed-in", "has-photo"); btn.style.backgroundImage = ""; els.accountMenu.hidden = true; return; }
    btn.classList.add("signed-in"); X09.paintAvatar(btn, user); btn.title = user.email;
    $("amEmail").textContent = user.email;
    $("amPlan").textContent = hasPlan() ? `${user.planName} plan${user.subStatus === "past_due" ? " · payment issue" : ""}` : "No active plan";
    $("amUsage").hidden = !hasPlan();
    $("amPlans").textContent = hasPlan() ? "Change plan" : "Choose a plan";
    $("amBilling").hidden = !user.hasBilling;
    if (hasPlan()) {
      const u = user.usage;
      $("amAi").textContent = `${u.ai} / ${u.aiLimit}`;
      $("amAiBar").style.width = Math.min(100, (u.ai / u.aiLimit) * 100) + "%";
      $("amReset").textContent = `Resets ${resetDate()}`;
    }
  }
  function toggleMenu(show) {
    const open = show ?? els.accountMenu.hidden;
    els.accountMenu.hidden = !open;
    els.accountBtn.setAttribute("aria-expanded", String(open));
  }
  els.accountBtn.addEventListener("click", (e) => { e.stopPropagation(); if (!user) return showAuth("login"); toggleMenu(); });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".account")) toggleMenu(false);
    if (!e.target.closest(".more")) $("edMore").hidden = true;
  });
  $("amPlans").addEventListener("click", () => { toggleMenu(false); if (hasPlan() && user.hasBilling) return openPortal(); showPlans(); });
  $("amBilling").addEventListener("click", () => { toggleMenu(false); openPortal(); });
  $("amBiz").addEventListener("click", () => { toggleMenu(false); openBiz(); });
  $("amLogout").addEventListener("click", async () => {
    toggleMenu(false);
    await flushSave();
    X09.logout();
  });
  async function openPortal() {
    try { const { url } = await api("/api/billing/portal", { method: "POST" }); location.href = url; }
    catch (err) { toast(err.message, 5000); }
  }

  // ---------- Profile: the shared X09 account panel (same on every X09 site) ----------
  function openProfile() {
    if (!user) return showAuth("login");
    toggleMenu(false);
    X09.openAccount();
  }
  $("railProfile").addEventListener("click", openProfile);
  $("amProfile").addEventListener("click", openProfile);
  X09.onUser((u) => {
    const wasSignedIn = !!user;
    user = u;
    if (!u && wasSignedIn) { docs = []; biz = null; current = null; location.hash = "#/"; renderLists(); }
    renderAccount();
  });
  async function refreshMe() {
    try { X09.setUser((await api("/api/me")).user); } catch {}
    return user;
  }
  async function loadAll() {
    if (!user) return;
    try { const [b, d] = await Promise.all([api("/api/business"), api("/api/docs")]); biz = b.business; docs = d.docs; }
    catch (err) { handleErr(err); }
    renderLists();
  }

  // ---------- Gate ----------
  function gate() {
    if (!user) { rememberComposer(); showAuth("signup"); return false; }
    if (!hasPlan()) { showPlans(); return false; }
    return true;
  }

  // =====================================================================
  //  Router
  // =====================================================================
  async function route() {
    const h = location.hash.replace(/^#/, "") || "/";
    const m = h.match(/^\/doc\/([a-f0-9]{8,40})/);
    if (!m && current) { await flushSave(); current = null; }
    if (m) return openDoc(m[1]);
    show(h.startsWith("/docs") ? "docs" : "home");
  }
  function show(view) {
    body.dataset.view = view;
    document.querySelectorAll("[data-nav]").forEach((a) => a.classList.toggle("active", a.dataset.nav === view));
    $("topTitle").textContent = view === "docs" ? "Documents" : "";
    els.saveState.textContent = "";
    if (view !== "editor") renderLists();
    if (view === "home" && matchMedia("(min-width: 821px)").matches) setTimeout(() => els.input.focus(), 30);
  }
  addEventListener("hashchange", route);

  // =====================================================================
  //  Home
  // =====================================================================
  function setType(t) {
    docType = t;
    document.querySelectorAll("#typePick [data-type]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.type === t)));
    els.input.placeholder = PLACEHOLDER[t];
    $("suggestions").innerHTML = EXAMPLES[t].map(([k], i) => `<button type="button" data-ex="${i}"><b>${esc(k)}</b></button>`).join("");
  }
  $("typePick").addEventListener("click", (e) => { const b = e.target.closest("[data-type]"); if (b) setType(b.dataset.type); });
  $("suggestions").addEventListener("click", (e) => {
    const b = e.target.closest("[data-ex]"); if (!b) return;
    els.input.value = EXAMPLES[docType][+b.dataset.ex][1]; autosize(); els.input.focus();
  });
  function autosize() {
    els.input.style.height = "auto";
    els.input.style.height = Math.min(els.input.scrollHeight, 260) + "px";
    els.send.disabled = !els.input.value.trim();
  }
  els.input.addEventListener("input", autosize);
  els.input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); els.form.requestSubmit(); }
  });
  els.form.addEventListener("submit", (e) => { e.preventDefault(); draftWithAI(); });
  $("blankBtn").addEventListener("click", () => newDoc(docType, {}));

  function working(on, text) {
    els.working.hidden = !on;
    if (text) $("workingText").textContent = text;
  }

  async function draftWithAI() {
    const prompt = els.input.value.trim();
    if (!prompt) return;
    if (!gate()) return;
    const label = TYPES[docType].label.toLowerCase();
    working(true, `Writing your ${label}…`);
    try {
      const { draft } = await api("/api/ai/draft", { method: "POST", body: { type: docType, prompt } });
      const data = { client: draft.client, items: draft.items, sections: draft.sections, notes: draft.notes, terms: draft.terms };
      if (draft.taxRate) data.taxRate = draft.taxRate;
      const { doc } = await api("/api/docs", { method: "POST", body: { type: docType, title: draft.title, data } });
      docs.unshift(summary(doc));
      els.input.value = ""; autosize();
      current = doc;
      location.hash = `#/doc/${doc.id}`;
      toast(docType === "contract" ? "Draft ready — review every clause before sending." : "Draft ready — check the prices before sending.", 5000);
      refreshMe();
    } catch (err) {
      handleErr(err);
    } finally { working(false); }
  }

  async function newDoc(type, data, title) {
    if (!gate()) return;
    try {
      const { doc } = await api("/api/docs", { method: "POST", body: { type, data, title } });
      docs.unshift(summary(doc));
      current = doc;
      location.hash = `#/doc/${doc.id}`;
    } catch (err) { handleErr(err); }
  }

  // =====================================================================
  //  Lists + stats
  // =====================================================================
  const summary = (d) => ({ ...d, dueDate: d.data?.dueDate || d.dueDate || "", issueDate: d.data?.issueDate || d.issueDate || "" });
  const isOverdue = (d) => d.type === "invoice" && (d.status === "sent" || d.status === "viewed") && d.dueDate && d.dueDate < todayISO();

  function statsHtml() {
    const cur = biz?.currency || "USD";
    const same = (d) => d.currency === cur;
    const open = docs.filter((d) => d.type === "invoice" && (d.status === "sent" || d.status === "viewed") && same(d));
    const overdue = open.filter(isOverdue);
    const since = Date.now() - 30 * 864e5;
    const paid = docs.filter((d) => d.type === "invoice" && d.status === "paid" && d.paidAt >= since && same(d));
    const waiting = docs.filter((d) => TYPES[d.type].signable && (d.status === "sent" || d.status === "viewed"));
    const sum = (a) => a.reduce((s, d) => s + d.total, 0);
    return `
      <div class="stat"><div class="k">Outstanding</div><div class="v">${money(sum(open), cur)}</div><div class="s">${open.length} unpaid invoice${open.length === 1 ? "" : "s"}${overdue.length ? ` · ${overdue.length} overdue` : ""}</div></div>
      <div class="stat"><div class="k">Paid · 30 days</div><div class="v">${money(sum(paid), cur)}</div><div class="s">${paid.length} invoice${paid.length === 1 ? "" : "s"}</div></div>
      <div class="stat"><div class="k">Awaiting signature</div><div class="v">${waiting.length}</div><div class="s">estimates, proposals &amp; contracts</div></div>`;
  }
  function rowHtml(d) {
    const st = isOverdue(d) ? "overdue" : d.status;
    const stLabel = isOverdue(d) ? "Overdue" : STATUS_LABEL[d.status];
    const date = d.type === "invoice" && d.dueDate && d.status !== "paid" ? `Due ${fmtDate(d.dueDate)}` : fmtDate(d.issueDate);
    return `<a class="doc-row" href="#/doc/${d.id}">
      <span class="doc-type"><b>${TYPES[d.type].label}</b>${esc(d.number)}</span>
      <span class="doc-main"><div class="doc-title">${esc(d.title)}</div><div class="doc-client">${esc(d.clientName || "No client yet")}</div></span>
      <span class="doc-date">${esc(date)}</span>
      <span class="pill ${st}">${stLabel}</span>
      <span class="doc-amt">${TYPES[d.type].items || d.total ? money(d.total, d.currency) : "—"}</span>
    </a>`;
  }
  function renderLists() {
    const signedIn = !!user;
    $("homeRecent").hidden = !signedIn || !docs.length;
    if (signedIn && docs.length) {
      $("stats").innerHTML = statsHtml();
      $("recentList").innerHTML = docs.slice(0, 5).map(rowHtml).join("");
    }
    if (body.dataset.view !== "docs") return;
    $("statsAll").innerHTML = signedIn ? statsHtml() : "";
    $("statsAll").hidden = !signedIn;
    const q = $("search").value.trim().toLowerCase();
    const list = docs.filter((d) => (filter === "all" || d.type === filter) &&
      (!q || [d.title, d.clientName, d.number, d.clientEmail].some((s) => (s || "").toLowerCase().includes(q))));
    if (!signedIn) $("docList").innerHTML = `<div class="no-docs"><b>Sign in to see your documents</b>Everything you create is saved to your account.</div>`;
    else if (!list.length) $("docList").innerHTML = `<div class="no-docs"><b>${q || filter !== "all" ? "No matches" : "No documents yet"}</b>${q || filter !== "all" ? "Try another filter." : '<a href="#/" class="link-btn">Draft your first one →</a>'}</div>`;
    else $("docList").innerHTML = list.map(rowHtml).join("");
  }
  $("typeFilter").addEventListener("click", (e) => {
    const b = e.target.closest("[data-f]"); if (!b) return;
    filter = b.dataset.f;
    $("typeFilter").querySelectorAll("button").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
    renderLists();
  });
  $("search").addEventListener("input", renderLists);

  // =====================================================================
  //  Editor
  // =====================================================================
  async function openDoc(id) {
    if (!user) { await refreshMe(); if (!user) { location.hash = "#/"; showAuth("login"); return; } }
    if (!current || current.id !== id) {
      await flushSave();
      try { current = (await api(`/api/docs/${id}`)).doc; }
      catch (err) { handleErr(err); location.hash = "#/docs"; return; }
    }
    if (!biz) { try { biz = (await api("/api/business")).business; } catch {} }
    body.dataset.view = "editor";
    document.querySelectorAll("[data-nav]").forEach((a) => a.classList.remove("active"));
    $("topTitle").textContent = current.title;
    setEdTab("form");
    buildForm();
    renderPreview();
    els.saveState.textContent = "Saved";
    if (biz && !biz.name && !session.get("x09docs.bizPrompted")) {
      session.set("x09docs.bizPrompted", "1");
      setTimeout(() => { toast("Add your business name, logo and payment details — they appear on every document.", 6000); openBiz(); }, 500);
    }
  }

  const locked = () => !!current?.signedAt;
  const canEdit = () => hasPlan() && !locked();

  function field(label, key, value, opts = {}) {
    const tag = opts.area ? "textarea" : "input";
    const attrs = [`data-k="${key}"`, opts.type ? `type="${opts.type}"` : "", opts.max ? `maxlength="${opts.max}"` : "", opts.rows ? `rows="${opts.rows}"` : "",
      opts.step ? `step="${opts.step}"` : "", opts.min != null ? `min="${opts.min}"` : "", opts.ph ? `placeholder="${esc(opts.ph)}"` : ""].filter(Boolean).join(" ");
    const v = esc(value ?? "");
    return `<label class="f${opts.full ? " full" : ""}">${label}${opts.area ? `<textarea ${attrs}>${v}</textarea>` : `<${tag} ${attrs} value="${v}">`}</label>`;
  }

  function buildForm() {
    const d = current.data, T = TYPES[current.type], t = current.type;
    let h = "";
    if (locked()) {
      h += `<div class="lock-banner">Signed by <b>${esc(current.signerName)}</b> on ${esc(new Date(current.signedAt).toLocaleString())}. Its contents are locked.<br>
        <button type="button" class="btn-ghost sm" data-act="duplicate">Duplicate to edit</button>${t !== "invoice" && t !== "contract" ? ` <button type="button" class="btn-primary sm" data-act="convert-invoice">Convert to invoice</button>` : ""}</div>`;
    } else if (!hasPlan()) {
      h += `<div class="lock-banner">Your plan is inactive — documents are read-only. <button type="button" class="btn-primary sm" data-act="plans">Choose a plan</button></div>`;
    }
    h += `<fieldset class="fs"><div class="fs-head"><span class="label">Document</span></div><div class="fgrid">
      ${field("Title", "title", current.title, { full: true, max: 160 })}
      ${field("Date", "issueDate", d.issueDate, { type: "date" })}
      ${field(T.date2, "dueDate", d.dueDate, { type: "date" })}
      ${t === "invoice" ? field("Ref / PO #", "poNumber", d.poNumber, { max: 60 }) : ""}
      <label class="f${t === "invoice" ? "" : " full"}">Currency<select data-k="currency">${CURRENCIES.map((c) => `<option ${c === d.currency ? "selected" : ""}>${c}</option>`).join("")}</select></label>
    </div></fieldset>`;

    h += `<fieldset class="fs"><div class="fs-head"><span class="label">${T.to}</span></div><div class="fgrid">
      ${field("Name", "client.name", d.client.name, { max: 120 })}
      ${field("Company", "client.company", d.client.company, { max: 120 })}
      ${field("Email", "client.email", d.client.email, { type: "email", max: 200 })}
      ${field("Phone", "client.phone", d.client.phone, { max: 60 })}
      ${field("Address", "client.address", d.client.address, { area: true, rows: 2, full: true, max: 400 })}
    </div></fieldset>`;

    if (T.sections || d.sections.length) {
      h += `<fieldset class="fs"><div class="fs-head"><span class="label">${t === "contract" ? "Clauses" : "Sections"}</span></div><div id="secList"></div>
        <button type="button" class="add-btn" data-act="add-sec">+ Add ${t === "contract" ? "clause" : "section"}</button></fieldset>`;
    }
    if (T.items || d.items.length) {
      h += `<fieldset class="fs"><div class="fs-head"><span class="label">${t === "contract" ? "Fees" : "Line items"}</span></div><div id="itemList"></div>
        <button type="button" class="add-btn" data-act="add-item">+ Add line</button>
        <div class="fgrid" style="margin-top:12px">
          ${field("Tax %", "taxRate", d.taxRate || "", { type: "number", step: "0.01", min: 0, ph: "0" })}
          ${field("Discount (amount)", "discount", d.discount || "", { type: "number", step: "0.01", min: 0, ph: "0" })}
          ${t === "estimate" || t === "proposal" ? field("Deposit %", "depositPct", d.depositPct || "", { type: "number", step: "1", min: 0, ph: "0" }) : ""}
        </div>
        <div class="sum-box" id="sumBox"></div></fieldset>`;
    } else if (t === "contract") {
      h += `<fieldset class="fs"><button type="button" class="add-btn" data-act="add-item">+ Add a fee table</button></fieldset>`;
    }

    h += `<fieldset class="fs"><div class="fs-head"><span class="label">Details</span></div><div class="fgrid">
      ${t === "invoice" ? field("How to pay", "payment", d.payment, { area: true, rows: 3, full: true, max: 2000, ph: "Bank transfer, Zelle, or a payment link" }) : ""}
      ${t !== "contract" ? field("Notes", "notes", d.notes, { area: true, rows: 3, full: true, max: 4000 }) + `<div class="ai-row full"><button type="button" class="tool ai" data-ai="notes">✦ Improve</button></div>` : ""}
      ${field("Terms", "terms", d.terms, { area: true, rows: 4, full: true, max: 8000 })}
      <div class="ai-row full"><button type="button" class="tool ai" data-ai="terms">✦ ${d.terms ? "Improve" : "Write"}</button></div>
    </div></fieldset>`;

    els.edForm.innerHTML = h;
    renderItems(); renderSections(); renderSums(); renderBar();
    if (!canEdit()) els.edForm.querySelectorAll("input, textarea, select, .add-btn, .x-btn, .tool").forEach((x) => (x.disabled = true));
    els.edForm.querySelectorAll("[data-act]").forEach((x) => (x.disabled = false));
  }

  function renderItems() {
    const box = $("itemList"); if (!box) return;
    const cur = current.data.currency;
    box.innerHTML = current.data.items.map((it, i) => `
      <div class="item" data-i="${i}">
        <textarea data-item="description" rows="1" placeholder="Description" maxlength="1000">${esc(it.description)}</textarea>
        <div class="item-row">
          <label>Qty<input data-item="qty" type="number" step="any" min="0" value="${esc(it.qty)}"></label>
          <label>Rate<input data-item="rate" type="number" step="0.01" value="${esc(it.rate)}"></label>
          <div class="item-amt">${money((+it.qty || 0) * (+it.rate || 0), cur)}</div>
          <button type="button" class="x-btn" data-act="del-item" aria-label="Remove line"><svg viewBox="0 0 24 24" width="15" height="15"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>
        </div>
      </div>`).join("");
    box.querySelectorAll("textarea").forEach(fitArea);
  }
  function renderSections() {
    const box = $("secList"); if (!box) return;
    const n = current.data.sections.length;
    box.innerHTML = current.data.sections.map((s, i) => `
      <div class="sec" data-i="${i}">
        <input data-sec="heading" placeholder="Heading" maxlength="160" value="${esc(s.heading)}">
        <textarea data-sec="body" placeholder="Write this ${current.type === "contract" ? "clause" : "section"}… (use “- ” for bullet points)" maxlength="8000">${esc(s.body)}</textarea>
        <div class="sec-tools">
          <button type="button" class="tool ai" data-ai="sec">✦ ${s.body.trim() ? "Improve" : "Write"}</button>
          <span class="sp"></span>
          <button type="button" class="tool" data-act="up" ${i === 0 ? "disabled" : ""} aria-label="Move up">↑</button>
          <button type="button" class="tool" data-act="down" ${i === n - 1 ? "disabled" : ""} aria-label="Move down">↓</button>
          <button type="button" class="tool" data-act="del-sec" aria-label="Remove">✕</button>
        </div>
      </div>`).join("");
  }
  function renderSums() {
    const box = $("sumBox"); if (!box) return;
    const d = current.data, t = R.totals(d), cur = d.currency;
    box.innerHTML = `<div><span>Subtotal</span><span>${money(t.subtotal, cur)}</span></div>
      ${t.discount ? `<div><span>Discount</span><span>−${money(t.discount, cur)}</span></div>` : ""}
      ${+d.taxRate ? `<div><span>Tax (${+d.taxRate}%)</span><span>${money(t.tax, cur)}</span></div>` : ""}
      <div class="grand"><span>Total</span><span>${money(t.total, cur)}</span></div>
      ${t.deposit ? `<div><span>Deposit (${+d.depositPct}%)</span><span>${money(t.deposit, cur)}</span></div>` : ""}`;
  }
  function renderBar() {
    $("edNum").innerHTML = `<span class="ed-kind">${TYPES[current.type].label} </span>${esc(current.number)}`;
    const pill = $("edStatusPill");
    pill.className = "pill " + current.status; pill.textContent = STATUS_LABEL[current.status];
    const sel = $("edStatus");
    const opts = STATUS_FOR[current.type].includes(current.status) ? STATUS_FOR[current.type] : [current.status, ...STATUS_FOR[current.type]];
    sel.innerHTML = opts.map((s) => `<option value="${s}" ${s === current.status ? "selected" : ""}>${STATUS_LABEL[s]}</option>`).join("");
    sel.disabled = !hasPlan();
    $("edSend").disabled = false;
    const more = $("edMore");
    more.querySelector('[data-more="convert-invoice"]').hidden = !(current.type === "estimate" || current.type === "proposal");
    more.querySelector('[data-more="void"]').hidden = current.status === "void";
    $("topTitle").textContent = current.title;
  }
  let previewRaf = 0;
  function renderPreview() {
    cancelAnimationFrame(previewRaf);
    previewRaf = requestAnimationFrame(() => {
      if (!current) return;
      els.preview.innerHTML = R.renderPaper(current, biz || {}, { branding: !user?.whiteLabel });
    });
  }
  function fitArea(t) { t.style.height = "auto"; t.style.height = t.scrollHeight + 2 + "px"; }

  // Field edits
  function setPath(k, v) {
    if (k === "title") { current.title = v; return; }
    if (k.startsWith("client.")) { current.data.client[k.slice(7)] = v; return; }
    if (["taxRate", "discount", "depositPct"].includes(k)) { current.data[k] = v === "" ? 0 : Math.max(0, +v || 0); return; }
    current.data[k] = v;
  }
  els.edForm.addEventListener("input", (e) => {
    if (!current || !canEdit()) return;
    const t = e.target;
    if (t.dataset.k) {
      setPath(t.dataset.k, t.value);
      if (["taxRate", "discount", "depositPct", "currency"].includes(t.dataset.k)) { renderSums(); if (t.dataset.k === "currency") renderItems(); }
      if (t.dataset.k === "title") $("topTitle").textContent = t.value;
    } else if (t.dataset.item) {
      const box = t.closest(".item"), it = current.data.items[+box.dataset.i];
      it[t.dataset.item] = t.dataset.item === "description" ? t.value : (t.value === "" ? 0 : +t.value);
      if (t.tagName === "TEXTAREA") fitArea(t);
      box.querySelector(".item-amt").textContent = money((+it.qty || 0) * (+it.rate || 0), current.data.currency);
      renderSums();
    } else if (t.dataset.sec) {
      const box = t.closest(".sec");
      current.data.sections[+box.dataset.i][t.dataset.sec] = t.value;
    } else return;
    renderPreview(); scheduleSave();
  });
  els.edForm.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-act], [data-ai]"); if (!b || !current) return;
    const act = b.dataset.act;
    if (act === "plans") return showPlans();
    if (act === "duplicate" || act === "convert-invoice") return moreAction(act);
    if (b.dataset.ai) return aiAssist(b);
    if (!canEdit()) return;
    const d = current.data;
    if (act === "add-item") {
      d.items.push({ description: "", qty: 1, rate: 0 });
      if (!$("itemList")) { buildForm(); } else renderItems();
      const last = [...els.edForm.querySelectorAll(".item textarea")].pop(); last?.focus();
    } else if (act === "del-item") { d.items.splice(+b.closest(".item").dataset.i, 1); renderItems(); }
    else if (act === "add-sec") {
      d.sections.push({ heading: "", body: "" }); renderSections();
      [...els.edForm.querySelectorAll(".sec input")].pop()?.focus();
    } else if (act === "del-sec") {
      const i = +b.closest(".sec").dataset.i;
      if (d.sections[i].body.trim() && !confirm("Remove this section?")) return;
      d.sections.splice(i, 1); renderSections();
    } else if (act === "up" || act === "down") {
      const i = +b.closest(".sec").dataset.i, j = act === "up" ? i - 1 : i + 1;
      [d.sections[i], d.sections[j]] = [d.sections[j], d.sections[i]]; renderSections();
    } else return;
    renderSums(); renderPreview(); scheduleSave();
  });

  async function aiAssist(b) {
    if (!gate() || !canEdit()) return;
    const kind = b.dataset.ai;
    let ta, context, text, instruction;
    const who = current.data.client.company || current.data.client.name;
    const about = `${TYPES[current.type].label} "${current.title}"${who ? " for " + who : ""}`;
    if (kind === "sec") {
      const box = b.closest(".sec"), s = current.data.sections[+box.dataset.i];
      ta = box.querySelector("textarea"); context = s.heading;
      if (!s.body.trim()) {
        if (!s.heading.trim()) { toast("Give the section a heading first."); return; }
        text = s.heading;
        instruction = `Write the "${s.heading}" ${current.type === "contract" ? "clause" : "section"} for this ${about}. Other sections: ${current.data.sections.map((x) => x.heading).filter(Boolean).join(", ")}. Use [BRACKETS] for unknown details.`;
      } else { text = s.body; instruction = "Make it clearer, more professional and more complete, without inventing prices or dates."; }
    } else {
      ta = els.edForm.querySelector(`[data-k="${kind}"]`); context = kind;
      text = ta.value.trim();
      if (!text) { text = kind; instruction = `Write short, fair ${kind === "terms" ? "terms and conditions" : "closing notes"} for this ${about}. 3–6 short lines.`; }
      else instruction = "Make it clearer and more professional.";
    }
    const label = b.textContent; b.disabled = true; b.textContent = "✦ Writing…";
    try {
      const r = await api("/api/ai/rewrite", { method: "POST", body: { text, instruction, context } });
      ta.value = r.text; ta.dispatchEvent(new Event("input", { bubbles: true }));
      b.textContent = "✦ Improve";
      refreshMe();
    } catch (err) { handleErr(err); b.textContent = label; }
    finally { b.disabled = false; }
  }

  // Saving
  function scheduleSave() {
    dirty = true; els.saveState.textContent = "Editing…";
    clearTimeout(saveTimer); saveTimer = setTimeout(save, 700);
  }
  async function save(keepalive = false) {
    clearTimeout(saveTimer);
    if (!dirty || !current || !canEdit()) return;
    dirty = false;
    const doc = current;
    els.saveState.textContent = "Saving…";
    const p = api(`/api/docs/${doc.id}`, { method: "PUT", body: { title: doc.title, data: doc.data }, keepalive })
      .then(({ doc: fresh }) => {
        const i = docs.findIndex((x) => x.id === fresh.id);
        if (i > -1) docs[i] = summary(fresh); else docs.unshift(summary(fresh));
        docs.sort((a, b) => b.updatedAt - a.updatedAt);
        if (current && current.id === fresh.id) { current.total = fresh.total; current.updatedAt = fresh.updatedAt; }
        if (!dirty) els.saveState.textContent = "Saved";
      })
      .catch((err) => { dirty = true; els.saveState.textContent = "Not saved"; handleErr(err); });
    saving = p; await p; if (saving === p) saving = null;
  }
  async function flushSave() { if (dirty) await save(); else if (saving) await saving; }
  addEventListener("beforeunload", (e) => { if (dirty) { save(true); e.preventDefault(); } });
  addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden" && dirty) save(true); });

  async function setStatus(status) {
    await flushSave();
    try {
      const { doc } = await api(`/api/docs/${current.id}`, { method: "PUT", body: { status } });
      current.status = doc.status; current.paidAt = doc.paidAt;
      const i = docs.findIndex((x) => x.id === doc.id); if (i > -1) docs[i] = summary(doc);
      renderBar(); renderPreview();
    } catch (err) { handleErr(err); renderBar(); }
  }
  $("edStatus").addEventListener("change", (e) => setStatus(e.target.value));

  // PDF
  $("edPdf").addEventListener("click", async () => {
    await flushSave();
    $("printRoot").innerHTML = R.renderPaper(current, biz || {}, { branding: false });
    const old = document.title;
    const who = current.data.client.company || current.data.client.name;
    document.title = `${current.number}${who ? " - " + who : ""}`.replace(/[\\/:*?"<>|]/g, "");
    const done = () => { document.title = old; removeEventListener("afterprint", done); };
    addEventListener("afterprint", done);
    // Let the logo/fonts load before the print dialog snapshots the page
    const imgs = [...$("printRoot").querySelectorAll("img")];
    await Promise.race([Promise.all(imgs.map((i) => (i.complete ? 1 : new Promise((r) => (i.onload = i.onerror = r))))), new Promise((r) => setTimeout(r, 1500))]);
    try { await document.fonts?.ready; } catch {}
    window.print();
    setTimeout(done, 1000);
  });

  // Send
  const shareUrl = () => `${location.origin}/d/${current.shareId}`;
  $("edSend").addEventListener("click", async () => {
    await flushSave();
    if (!hasPlan()) return showPlans();
    const d = current.data, T = TYPES[current.type];
    const url = shareUrl();
    $("shareUrl").value = url;
    $("sendSignNote").hidden = !T.signable || !!current.signedAt;
    const from = biz?.name || "us";
    const who = d.client.name ? d.client.name.split(" ")[0] : "there";
    const amount = T.items || current.total ? ` (${money(R.totals(d).total, d.currency)})` : "";
    const subject = `${T.label} ${current.number} from ${from}`;
    const action = current.type === "invoice" ? "view and pay" : T.signable ? "review and sign" : "view";
    const bodyText = `Hi ${who},\n\nHere is your ${T.label.toLowerCase()}${amount}. You can ${action} it here:\n${url}\n\nThank you,\n${biz?.signature || from}`;
    $("sendEmail").href = `mailto:${encodeURIComponent(d.client.email || "")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyText)}`;
    $("sendSms").href = `sms:${encodeURIComponent(d.client.phone || "")}${/iPhone|iPad|Mac/.test(navigator.userAgent) ? "&" : "?"}body=${encodeURIComponent(`${subject}: ${url}`)}`;
    $("sendShare").hidden = !navigator.share;
    $("sendShare").onclick = () => navigator.share({ title: subject, text: bodyText.replace(url, "").trim(), url }).then(markSent).catch(() => {});
    openModal(els.sendModal);
    setTimeout(() => { $("shareUrl").select(); }, 80);
  });
  function markSent() { if (current && current.status === "draft") setStatus("sent"); }
  $("copyLink").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText($("shareUrl").value); } catch { $("shareUrl").select(); document.execCommand?.("copy"); }
    $("copyLink").textContent = "Copied"; setTimeout(() => ($("copyLink").textContent = "Copy"), 1500);
    markSent();
  });
  $("sendEmail").addEventListener("click", markSent);
  $("sendSms").addEventListener("click", markSent);

  // More menu
  $("edMoreBtn").addEventListener("click", (e) => { e.stopPropagation(); $("edMore").hidden = !$("edMore").hidden; });
  $("edMore").addEventListener("click", (e) => { const b = e.target.closest("[data-more]"); if (!b) return; $("edMore").hidden = true; moreAction(b.dataset.more); });
  async function moreAction(a) {
    await flushSave();
    if (a === "open-link") return window.open(shareUrl(), "_blank", "noopener");
    if (a === "void") { if (confirm("Mark this document as void? Your client's link will stop working.")) setStatus("void"); return; }
    if (a === "delete") {
      if (!confirm(`Delete ${current.number}? Your client's link will stop working. This can't be undone.`)) return;
      try { await api(`/api/docs/${current.id}`, { method: "DELETE" }); } catch (err) { return handleErr(err); }
      docs = docs.filter((x) => x.id !== current.id); current = null;
      location.hash = "#/docs"; toast("Document deleted."); return;
    }
    if (a === "duplicate" || a === "convert-invoice") {
      if (!gate()) return;
      try {
        const { doc } = await api(`/api/docs/${current.id}/duplicate`, { method: "POST", body: a === "convert-invoice" ? { type: "invoice" } : {} });
        docs.unshift(summary(doc)); current = doc;
        location.hash = `#/doc/${doc.id}`;
        toast(a === "convert-invoice" ? `Invoice ${doc.number} created — review it, then send.` : "Copy created.");
      } catch (err) { handleErr(err); }
    }
  }

  // Mobile edit/preview tabs
  function setEdTab(tab) {
    document.querySelector(".ed-body").dataset.edtab = tab;
    document.querySelectorAll("[data-edtab][role=tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.edtab === tab)));
  }
  document.querySelectorAll(".ed-tabs [data-edtab]").forEach((b) => b.addEventListener("click", () => setEdTab(b.dataset.edtab)));

  // =====================================================================
  //  Business settings
  // =====================================================================
  let pendingLogo;   // undefined = unchanged, null = removed, string = new
  $("bizCurrency").innerHTML = CURRENCIES.map((c) => `<option>${c}</option>`).join("");
  function logoPreview(src) { $("logoBox").innerHTML = src ? `<img src="${esc(src)}" alt="Logo">` : "<span>Logo</span>"; }
  async function openBiz() {
    if (!user) return showAuth("login");
    if (!biz) { try { biz = (await api("/api/business")).business; } catch (err) { return handleErr(err); } }
    const f = els.bizForm;
    for (const el of f.elements) if (el.name && biz[el.name] !== undefined) el.value = biz[el.name];
    pendingLogo = undefined; logoPreview(biz.logo);
    $("bizError").textContent = "";
    openModal(els.bizModal);
  }
  $("railBiz").addEventListener("click", openBiz);
  $("logoRemove").addEventListener("click", () => { pendingLogo = null; logoPreview(null); });
  $("logoFile").addEventListener("change", async (e) => {
    const file = e.target.files[0]; e.target.value = "";
    if (!file) return;
    try { pendingLogo = await shrinkLogo(file); logoPreview(pendingLogo); }
    catch (err) { $("bizError").textContent = err.message; }
  });
  function readUrl(file) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error("Couldn't read that file.")); r.readAsDataURL(file); }); }
  async function shrinkLogo(file) {
    if (file.size > 8e6) throw new Error("That image is too large (max 8 MB).");
    const url = await readUrl(file);
    if (file.type === "image/svg+xml") { if (url.length > 290000) throw new Error("That SVG is too large — try a PNG."); return url; }
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("That file isn't an image we can read.")); i.src = url; });
    const scale = Math.min(1, 520 / img.width, 220 / img.height);
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.width * scale)); c.height = Math.max(1, Math.round(img.height * scale));
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    let out = c.toDataURL("image/png");
    if (out.length > 290000) out = c.toDataURL("image/jpeg", 0.86);
    if (out.length > 290000) throw new Error("Couldn't shrink that logo enough — try a simpler image.");
    return out;
  }
  els.bizForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = {};
    for (const el of els.bizForm.elements) if (el.name) data[el.name] = el.value;
    data.logo = pendingLogo === undefined ? biz.logo : pendingLogo;
    const btn = els.bizForm.querySelector("[type=submit]"); btn.disabled = true;
    try {
      biz = (await api("/api/business", { method: "PUT", body: data })).business;
      closeModal(els.bizModal); toast("Business settings saved.");
      if (current) renderPreview();
      renderLists();
    } catch (err) { $("bizError").textContent = err.message; }
    finally { btn.disabled = false; }
  });

  addEventListener("keydown", (e) => {
    if (e.key === "Escape") { document.querySelectorAll(".modal.open").forEach(closeModal); toggleMenu(false); $("edMore").hidden = true; }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s" && current) { e.preventDefault(); save(); }
  });

  // =====================================================================
  //  Boot
  // =====================================================================
  (async function boot() {
    const params = new URLSearchParams(location.search);
    const checkout = params.get("checkout");
    if (params.has("checkout") || params.has("portal")) history.replaceState(null, "", "/" + location.hash);
    setType("invoice");
    try {
      const saved = JSON.parse(session.get("x09docs.draft") || "null");
      if (saved) { setType(TYPES[saved.type] ? saved.type : "invoice"); els.input.value = saved.text; session.set("x09docs.draft", null); }
    } catch {}
    autosize();
    renderAccount();
    api("/api/plans").then((d) => (plans = d.plans)).catch(() => {});
    await refreshMe();
    if (checkout === "success") {
      toast("Payment received — activating your plan…", 6000);
      for (let i = 0; i < 12 && !hasPlan(); i++) { await new Promise((r) => setTimeout(r, 1500)); await refreshMe(); }
      toast(hasPlan() ? `Welcome aboard. ${user.planName} plan active.` : "Payment received. Your plan will activate shortly — refresh in a moment.", 6000);
    } else if (checkout === "cancel") toast("Checkout canceled — no charge was made.");
    await loadAll();
    await route();
    if (user && !hasPlan() && checkout !== "success") showPlans();
  })();
})();

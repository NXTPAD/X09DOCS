/* X09 Docs — shared document renderer (used by the app preview, print/PDF and the client page) */
(function (global) {
  "use strict";

  const TYPES = {
    invoice:  { label: "Invoice",  to: "Bill to",      date2: "Due date",    items: true,  sections: false, signable: false },
    estimate: { label: "Estimate", to: "Prepared for", date2: "Valid until", items: true,  sections: false, signable: true },
    proposal: { label: "Proposal", to: "Prepared for", date2: "Valid until", items: true,  sections: true,  signable: true },
    contract: { label: "Contract", to: "Client",       date2: "Start date",  items: false, sections: true,  signable: true },
  };

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const round2 = (n) => Math.round(n * 100) / 100;

  function money(n, currency = "USD") {
    try { return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(n || 0); }
    catch { return `${currency} ${(n || 0).toFixed(2)}`; }
  }
  function fmtDate(iso) {
    if (!iso) return "";
    const d = new Date(iso.length === 10 ? iso + "T12:00:00" : iso);
    return isNaN(d) ? "" : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }
  function totals(data) {
    const subtotal = round2((data.items || []).reduce((a, it) => a + round2((+it.qty || 0) * (+it.rate || 0)), 0));
    const discount = Math.min(Math.max(0, +data.discount || 0), Math.max(0, subtotal));
    const taxable = round2(subtotal - discount);
    const tax = round2(taxable * (+data.taxRate || 0) / 100);
    const total = round2(taxable + tax);
    const deposit = +data.depositPct ? round2(total * data.depositPct / 100) : 0;
    return { subtotal, discount, tax, total, deposit };
  }

  // Tiny, safe text formatting: paragraphs, "- " bullets, "1. " lists, **bold**
  function rich(src) {
    const lines = esc(src || "").split("\n");
    let html = "", list = null, para = [];
    const inline = (s) => s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    const fp = () => { if (para.length) { html += `<p>${inline(para.join("<br>"))}</p>`; para = []; } };
    const fl = () => { if (list) { html += `<${list.t}>${list.i.map((x) => `<li>${inline(x)}</li>`).join("")}</${list.t}>`; list = null; } };
    for (const l of lines) {
      let m;
      if ((m = l.match(/^\s*[-*•]\s+(.*)/))) { fp(); if (!list || list.t !== "ul") { fl(); list = { t: "ul", i: [] }; } list.i.push(m[1]); }
      else if ((m = l.match(/^\s*\d+[.)]\s+(.*)/))) { fp(); if (!list || list.t !== "ol") { fl(); list = { t: "ol", i: [] }; } list.i.push(m[1]); }
      else if (!l.trim()) { fp(); fl(); }
      else { fl(); para.push(l); }
    }
    fp(); fl();
    return html;
  }
  const lines = (s) => esc(s || "").split("\n").filter((x) => x.trim()).join("<br>");

  const STAMPS = { paid: "Paid", accepted: "Accepted", declined: "Declined", void: "Void" };

  /**
   * doc: { type, number, title, status, data, signerName, signedAt, paidAt }
   * biz: business profile (+ logo)
   * opts: { branding: bool }
   */
  function renderPaper(doc, biz = {}, opts = {}) {
    const T = TYPES[doc.type] || TYPES.invoice;
    const d = doc.data || {};
    const c = d.client || {};
    const cur = d.currency || "USD";
    const t = totals(d);
    const accent = /^#[0-9a-f]{6}$/i.test(biz.color || "") ? biz.color : "#111111";
    const items = (d.items || []).filter((it) => it.description || +it.rate);
    const showItems = T.items || items.length > 0;
    const stamp = STAMPS[doc.status];

    const bizLines = [biz.address && lines(biz.address), [biz.email, biz.phone].filter(Boolean).map(esc).join(" · "), biz.website && esc(biz.website), biz.taxId && "Tax ID " + esc(biz.taxId)].filter(Boolean);
    const clientLines = [c.company && c.name ? esc(c.name) : "", c.address && lines(c.address), [c.email, c.phone].filter(Boolean).map(esc).join(" · ")].filter(Boolean);

    let h = `<article class="paper" style="--accent:${accent}">`;
    h += `<header class="pp-head">
      <div class="pp-from">
        ${biz.logo ? `<img class="pp-logo" src="${esc(biz.logo)}" alt="">` : ""}
        <div class="pp-biz">${esc(biz.name || "Your business name")}</div>
        ${bizLines.map((l) => `<div class="pp-sm">${l}</div>`).join("")}
      </div>
      <div class="pp-meta">
        <div class="pp-type">${T.label}</div>
        <table class="pp-kv">
          <tr><th>No.</th><td>${esc(doc.number || "—")}</td></tr>
          <tr><th>Date</th><td>${esc(fmtDate(d.issueDate))}</td></tr>
          ${d.dueDate ? `<tr><th>${T.date2}</th><td>${esc(fmtDate(d.dueDate))}</td></tr>` : ""}
          ${d.poNumber ? `<tr><th>Ref / PO</th><td>${esc(d.poNumber)}</td></tr>` : ""}
        </table>
        ${stamp ? `<div class="pp-stamp pp-stamp-${doc.status}">${stamp}</div>` : ""}
      </div>
    </header>`;

    h += `<section class="pp-parties">
      <div><div class="pp-label">${T.to}</div>
        <div class="pp-client">${esc(c.company || c.name || "Client name")}</div>
        ${clientLines.map((l) => `<div class="pp-sm">${l}</div>`).join("")}
      </div>
      ${doc.type === "invoice" ? `<div class="pp-due"><div class="pp-label">Amount due</div><div class="pp-big">${money(doc.status === "paid" ? 0 : t.total, cur)}</div>${d.dueDate && doc.status !== "paid" ? `<div class="pp-sm">by ${esc(fmtDate(d.dueDate))}</div>` : ""}</div>`
        : showItems && t.total ? `<div class="pp-due"><div class="pp-label">Total</div><div class="pp-big">${money(t.total, cur)}</div></div>` : ""}
    </section>`;

    if (doc.title) h += `<h1 class="pp-title">${esc(doc.title)}</h1>`;

    if (T.sections || (d.sections || []).length) {
      (d.sections || []).forEach((s, i) => {
        h += `<section class="pp-section">${s.heading ? `<h2>${doc.type === "contract" ? `${i + 1}. ` : ""}${esc(s.heading)}</h2>` : ""}<div class="pp-rich">${rich(s.body)}</div></section>`;
      });
    }

    if (showItems) {
      h += `<table class="pp-items"><thead><tr><th>Description</th><th class="n">Qty</th><th class="n">Rate</th><th class="n">Amount</th></tr></thead><tbody>`;
      if (!items.length) h += `<tr><td colspan="4" class="pp-empty">No line items yet</td></tr>`;
      for (const it of items) {
        h += `<tr><td>${lines(it.description)}</td><td class="n">${esc(+it.qty || 0)}</td><td class="n">${money(+it.rate || 0, cur)}</td><td class="n">${money(round2((+it.qty || 0) * (+it.rate || 0)), cur)}</td></tr>`;
      }
      h += `</tbody></table><table class="pp-totals">
        <tr><th>Subtotal</th><td>${money(t.subtotal, cur)}</td></tr>
        ${t.discount ? `<tr><th>Discount</th><td>−${money(t.discount, cur)}</td></tr>` : ""}
        ${+d.taxRate ? `<tr><th>Tax (${esc(+d.taxRate)}%)</th><td>${money(t.tax, cur)}</td></tr>` : ""}
        <tr class="pp-grand"><th>Total</th><td>${money(t.total, cur)}</td></tr>
        ${t.deposit ? `<tr><th>Deposit due (${esc(+d.depositPct)}%)</th><td>${money(t.deposit, cur)}</td></tr>` : ""}
        ${doc.status === "paid" ? `<tr><th>Paid${doc.paidAt ? " " + esc(fmtDate(new Date(doc.paidAt).toISOString())) : ""}</th><td>−${money(t.total, cur)}</td></tr><tr class="pp-grand"><th>Balance</th><td>${money(0, cur)}</td></tr>` : ""}
      </table>`;
    }

    if (d.notes) h += `<section class="pp-block"><div class="pp-label">Notes</div><div class="pp-rich">${rich(d.notes)}</div></section>`;
    if (d.payment && doc.type === "invoice") h += `<section class="pp-block"><div class="pp-label">How to pay</div><div class="pp-rich">${rich(d.payment)}</div></section>`;
    if (d.terms) h += `<section class="pp-block"><div class="pp-label">Terms</div><div class="pp-rich">${rich(d.terms)}</div></section>`;

    if (T.signable) {
      const signed = doc.signerName && doc.signedAt;
      h += `<section class="pp-sign">
        <div class="pp-sig">
          <div class="pp-sig-line">${biz.signature ? `<span class="pp-script">${esc(biz.signature)}</span>` : ""}</div>
          <div class="pp-sm">${esc(biz.name || "Provider")}${biz.signature ? " · " + esc(biz.signature) : ""}</div>
        </div>
        <div class="pp-sig">
          <div class="pp-sig-line">${signed ? `<span class="pp-script">${esc(doc.signerName)}</span>` : ""}</div>
          <div class="pp-sm">${signed ? `Signed electronically by ${esc(doc.signerName)} · ${esc(new Date(doc.signedAt).toLocaleString())}` : `${esc(c.name || c.company || "Client")} — signature &amp; date`}</div>
        </div>
      </section>`;
    }

    if (opts.branding) h += `<footer class="pp-foot">Made with X09 Docs</footer>`;
    h += `</article>`;
    return h;
  }

  global.X09Render = { TYPES, renderPaper, totals, money, fmtDate, esc };
})(window);

/* X09 Docs — client document page (/d/:shareId) */
(() => {
  "use strict";
  const R = window.X09Render;
  const { esc, money, TYPES } = R;
  const $ = (id) => document.getElementById(id);
  const sid = location.pathname.split("/").filter(Boolean)[1] || "";
  let doc, biz, branding, isOwner;

  async function api(path, body) {
    const res = await fetch(path, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {});
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Something went wrong.");
    return data;
  }

  function render() {
    const T = TYPES[doc.type];
    const t = R.totals(doc.data);
    document.title = `${T.label} ${doc.number}${biz.name ? " · " + biz.name : ""}`;
    const canSign = doc.signable && !doc.signedAt && doc.status !== "declined";
    let banner = "";
    if (doc.signedAt) banner = `<div class="banner"><span class="dot"></span><div><b>Signed by ${esc(doc.signerName)}</b> on ${esc(new Date(doc.signedAt).toLocaleString())}. A copy is below — download it for your records.</div></div>`;
    else if (doc.status === "declined") banner = `<div class="banner"><div><b>Declined.</b> Contact ${esc(biz.name || "the sender")} if you'd like a new version.</div></div>`;
    else if (doc.status === "paid") banner = `<div class="banner"><span class="dot"></span><div><b>Paid</b> — thank you!</div></div>`;
    else if (doc.type === "invoice") banner = `<div class="banner"><div><b>${money(t.total, doc.data.currency)}</b> due${doc.data.dueDate ? " by " + esc(R.fmtDate(doc.data.dueDate)) : ""}. ${doc.data.payment ? "Payment details are at the bottom of the invoice." : ""}</div></div>`;
    if (isOwner) banner = `<div class="banner"><div>You're viewing your own client link. Your client sees exactly this page.</div></div>` + banner;

    $("app").innerHTML = `
      <header class="bar">
        <div class="who">
          ${biz.logo ? `<img src="${esc(biz.logo)}" alt="">` : ""}
          <div style="min-width:0"><div class="who-name">${esc(biz.name || "Document")}</div><div class="who-sub">${T.label} ${esc(doc.number)}</div></div>
        </div>
        <button class="btn btn-o" id="pdfBtn" title="Download PDF"><svg viewBox="0 0 24 24" width="16" height="16"><path d="M12 4v11M7 10l5 5 5-5M5 20h14" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg><span>Download PDF</span></button>
      </header>
      <main class="wrap">
        ${banner}
        ${R.renderPaper(doc, biz, { branding: false })}
        ${branding ? `<div class="foot">Sent with <a href="https://docs.x09hub.com" target="_blank" rel="noopener">X09 Docs</a></div>` : ""}
      </main>
      <div class="actions" ${canSign ? "" : "hidden"}>
        <button class="btn btn-o" id="declineBtn">Decline</button>
        <button class="btn btn-w" id="signOpen">Accept &amp; sign</button>
      </div>`;
    $("pdfBtn").onclick = download;
    if (canSign) {
      $("signOpen").onclick = openSign;
      $("declineBtn").onclick = decline;
    }
  }

  async function download() {
    $("printRoot").innerHTML = R.renderPaper(doc, biz, { branding: false });
    const imgs = [...$("printRoot").querySelectorAll("img")];
    await Promise.race([Promise.all(imgs.map((i) => (i.complete ? 1 : new Promise((r) => (i.onload = i.onerror = r))))), new Promise((r) => setTimeout(r, 1500))]);
    try { await document.fonts?.ready; } catch {}
    window.print();
  }

  function openSign() {
    const T = TYPES[doc.type];
    $("signSub").textContent = `${T.label} ${doc.number} from ${biz.name || "the sender"}${doc.total ? " · " + money(doc.total, doc.data.currency) : ""}`;
    $("agreeText").textContent = `I agree to the terms of this ${T.label.toLowerCase()} and that typing my name above is my electronic signature.`;
    $("signErr").textContent = "";
    if (!$("signName").value) $("signName").value = doc.data.client?.name || "";
    $("sigPreview").textContent = $("signName").value;
    $("signModal").hidden = false;
    setTimeout(() => $("signName").focus(), 50);
  }
  $("signName").addEventListener("input", () => ($("sigPreview").textContent = $("signName").value));
  $("signModal").addEventListener("click", (e) => { if (e.target.id === "signModal" || e.target.closest("[data-close]")) $("signModal").hidden = true; });
  $("signForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("signName").value.trim();
    if (name.length < 2) { $("signErr").textContent = "Type your full name to sign."; return; }
    if (!$("signAgree").checked) { $("signErr").textContent = "Tick the box to confirm."; return; }
    $("signBtn").disabled = true;
    try {
      doc = (await api(`/api/share/${sid}/accept`, { name, agree: true })).doc;
      $("signModal").hidden = true;
      render();
      scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) { $("signErr").textContent = err.message; }
    finally { $("signBtn").disabled = false; }
  });

  async function decline() {
    if (!confirm(`Decline this ${TYPES[doc.type].label.toLowerCase()}? ${biz.name || "The sender"} will see that you declined.`)) return;
    try { doc = (await api(`/api/share/${sid}/decline`, {})).doc; render(); }
    catch (err) { alert(err.message); }
  }

  (async () => {
    try {
      const d = await api(`/api/share/${sid}`);
      doc = d.doc; biz = d.business; branding = d.branding; isOwner = d.isOwner;
      render();
    } catch (err) {
      $("app").innerHTML = `<div class="state"><h1>Not available</h1><p>${esc(err.message)}</p></div>`;
    }
  })();
})();

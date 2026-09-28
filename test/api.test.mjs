// End-to-end API test against the local harness.
//   node --experimental-sqlite test/api.test.mjs
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { server, env, stripeCalls } from "./dev-server.mjs";

const PORT = 8798;
await new Promise((r) => server.listen(PORT, r));
const BASE = `http://localhost:${PORT}`;
let cookie = "";

async function api(path, { method = "GET", body, headers = {}, raw = false } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", cookie, origin: BASE, ...headers },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
  const sc = res.headers.getSetCookie();
  if (sc.length) cookie = sc[0].split(";")[0];
  if (raw) return res;
  return { status: res.status, data: await res.json().catch(() => null), res };
}
function signed(payload) {
  const t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac("sha256", env.STRIPE_WEBHOOK_SECRET).update(`${t}.${payload}`).digest("hex");
  return { "stripe-signature": `t=${t},v1=${sig}` };
}
let pass = 0;
const ok = (name) => { pass++; console.log("  ✓", name); };

try {
  let r = await api("/api/plans");
  assert.equal(r.data.plans.length, 3); assert.deepEqual(r.data.plans.map((p) => p.key), ["solo", "pro", "business"]); ok("lists 3 paid plans");

  r = await api("/api/me"); assert.equal(r.data.user, null); ok("signed-out /api/me");
  r = await api("/api/docs", { method: "POST", body: { type: "invoice" } }); assert.equal(r.status, 401); ok("creating docs requires sign-in");

  r = await api("/api/auth/signup", { method: "POST", body: { email: "Roofer@Example.com", password: "shingle-2026" } });
  assert.equal(r.status, 201); assert.ok(cookie.startsWith("x09_sid="));
  const userId = r.data.user.id; ok("signup creates account + session");

  r = await api("/api/docs", { method: "POST", body: { type: "invoice" } });
  assert.equal(r.status, 402); assert.equal(r.data.code, "plan_required"); ok("paywall: no plan, no documents");
  r = await api("/api/ai/draft", { method: "POST", body: { type: "invoice", prompt: "roof repair $400" } });
  assert.equal(r.status, 402); ok("paywall: no plan, no AI");

  r = await api("/api/auth/logout", { method: "POST", headers: { origin: "https://evil.example" } });
  assert.equal(r.status, 403); ok("cross-origin POST blocked");

  // Checkout
  r = await api("/api/billing/checkout", { method: "POST", body: { plan: "pro" } });
  assert.equal(r.status, 200);
  const cs = stripeCalls.find((c) => c.path === "/checkout/sessions");
  assert.equal(cs.params["line_items[0][price]"], "price_pro");
  assert.equal(cs.params["subscription_data[metadata][app]"], "x09-docs"); ok("checkout finds 'X09 Docs Pro' price by product name, tags app");

  // An X09 AI subscription lands on the same shared account, but doesn't unlock X09 Docs
  const foreign = { id: "sub_ai", customer: "cus_ai", status: "active", metadata: { user_id: userId, app: "x09-ai" }, items: { data: [{ price: { id: "price_pilot" } }] } };
  let evt = JSON.stringify({ type: "customer.subscription.updated", data: { object: foreign } });
  await api("/api/stripe/webhook", { method: "POST", body: evt, headers: signed(evt) });
  let mine = (await api("/api/me")).data.user;
  assert.equal(mine.plan, null); assert.equal(mine.products.ai.plan, "pilot");
  ok("X09 AI plan is recorded on the shared account but doesn't unlock Docs");

  const sub = { id: "sub_1", customer: "cus_x", status: "active", metadata: { user_id: userId, app: "x09-docs" },
    items: { data: [{ price: { id: "price_pro" }, current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400 }] } };
  globalThis.__mockSubs = { sub_1: sub };
  evt = JSON.stringify({ type: "checkout.session.completed", data: { object: { mode: "subscription", subscription: "sub_1", client_reference_id: userId } } });
  r = await api("/api/stripe/webhook", { method: "POST", body: evt, headers: { "stripe-signature": "t=1,v1=bad" } });
  assert.equal(r.status, 400); ok("webhook rejects bad signature");
  await api("/api/stripe/webhook", { method: "POST", body: evt, headers: signed(evt) });
  let u = (await api("/api/me")).data.user;
  assert.equal(u.plan, "pro"); assert.equal(u.usage.aiLimit, 200); ok("signed webhook activates Pro plan");

  // Business profile
  r = await api("/api/business", { method: "PUT", body: { name: "Summit Roofing", email: "hi@summit.co", currency: "USD", taxRate: 8.25, dueDays: 7, payment: "Zelle: pay@summit.co", terms: "Due on receipt.", logo: "data:image/png;base64,iVBORw0KGgo=" } });
  assert.equal(r.status, 200); assert.equal(r.data.business.taxRate, 8.25); ok("business profile saved");
  r = await api("/api/business", { method: "PUT", body: { name: "x", logo: "javascript:alert(1)" } });
  assert.equal(r.status, 400); ok("rejects non-image logo");

  // AI draft
  r = await api("/api/ai/draft", { method: "POST", body: { type: "estimate", prompt: "Tear off and replace 24 squares at $350 per square, dumpster $450" } });
  assert.equal(r.status, 200); assert.ok(r.data.draft.items.length >= 1); ok("AI draft returns structured line items");
  u = (await api("/api/me")).data.user; assert.equal(u.usage.ai, 1); ok("AI usage counted");

  // Create from draft; business defaults applied
  r = await api("/api/docs", { method: "POST", body: { type: "invoice", data: { client: { name: "Mike Lee", email: "mike@example.com" }, items: [{ description: "Roof repair", qty: 2, rate: 150 }, { description: "", rate: 0 }], discount: 20 } } });
  assert.equal(r.status, 201);
  const inv = r.data.doc;
  assert.equal(inv.number, "INV-0001"); assert.equal(inv.data.items.length, 1); assert.equal(inv.data.taxRate, 8.25);
  assert.equal(inv.data.payment, "Zelle: pay@summit.co");
  // (300 - 20) * 1.0825 = 303.10
  assert.equal(inv.total, 303.1); ok("invoice numbered, cleaned, defaults applied, total = 303.10");
  const due = new Date(inv.data.issueDate); due.setUTCDate(due.getUTCDate() + 7);
  assert.equal(inv.data.dueDate, due.toISOString().slice(0, 10)); ok("due date from business payment terms");

  r = await api("/api/docs", { method: "POST", body: { type: "invoice" } });
  assert.equal(r.data.doc.number, "INV-0002"); ok("numbers increment per type");
  r = await api("/api/docs", { method: "POST", body: { type: "nonsense" } }); assert.equal(r.status, 400); ok("unknown type rejected");

  // Update
  r = await api(`/api/docs/${inv.id}`, { method: "PUT", body: { title: "Leak repair", data: { ...inv.data, items: [{ description: "Leak repair", qty: 1, rate: 1000 }], taxRate: 0, discount: 0 } } });
  assert.equal(r.data.doc.total, 1000); assert.equal(r.data.doc.title, "Leak repair"); ok("update recalculates total");
  r = await api(`/api/docs/${inv.id}`, { method: "PUT", body: { status: "sent" } }); assert.equal(r.data.doc.status, "sent"); ok("status → sent");

  // Client view (no account)
  const saved = cookie; cookie = "";
  let page = await api(`/d/${inv.shareId}`, { raw: true });
  assert.equal(page.status, 200); assert.match(await page.text(), /<html/i); ok("client link serves the view page");
  r = await api(`/api/share/${inv.shareId}`);
  assert.equal(r.status, 200); assert.equal(r.data.business.name, "Summit Roofing"); assert.equal(r.data.doc.total, 1000); assert.equal(r.data.branding, true);
  assert.equal(r.data.doc.status, "viewed"); ok("client can view without an account; marks viewed");
  r = await api(`/api/share/${inv.shareId}/accept`, { method: "POST", body: { name: "Mike Lee", agree: true } });
  assert.equal(r.status, 400); ok("invoices can't be 'signed'");
  r = await api(`/api/share/${"0".repeat(32)}`); assert.equal(r.status, 404); ok("unknown link 404s");
  cookie = saved;

  // Estimate → sign → locked → convert to invoice
  r = await api("/api/docs", { method: "POST", body: { type: "estimate", data: { client: { name: "Ana" }, items: [{ description: "New roof", qty: 24, rate: 350 }] } } });
  const est = r.data.doc; assert.equal(est.number, "EST-0001");
  cookie = "";
  r = await api(`/api/share/${est.shareId}/accept`, { method: "POST", body: { name: "A", agree: true } }); assert.equal(r.status, 400); ok("signature needs a full name");
  r = await api(`/api/share/${est.shareId}/accept`, { method: "POST", body: { name: "Ana Diaz", agree: false } }); assert.equal(r.status, 400); ok("signature needs agreement");
  r = await api(`/api/share/${est.shareId}/accept`, { method: "POST", body: { name: "Ana Diaz", agree: true } });
  assert.equal(r.status, 200); assert.equal(r.data.doc.status, "accepted"); assert.equal(r.data.doc.signerName, "Ana Diaz"); ok("client accepts & e-signs estimate");
  r = await api(`/api/share/${est.shareId}/accept`, { method: "POST", body: { name: "Ana Diaz", agree: true } }); assert.equal(r.status, 409); ok("can't sign twice");
  cookie = saved;
  r = await api(`/api/docs/${est.id}`, { method: "PUT", body: { data: { items: [] } } });
  assert.equal(r.status, 409); assert.equal(r.data.code, "locked"); ok("signed document content is locked");
  r = await api(`/api/docs/${est.id}/duplicate`, { method: "POST", body: { type: "invoice" } });
  assert.equal(r.status, 201); assert.equal(r.data.doc.type, "invoice"); assert.equal(r.data.doc.number, "INV-0003");
  assert.equal(r.data.doc.data.items[0].rate, 350); assert.equal(r.data.doc.status, "draft"); ok("accepted estimate converts to invoice");

  // Paid
  r = await api(`/api/docs/${inv.id}`, { method: "PUT", body: { status: "paid" } }); assert.ok(r.data.doc.paidAt); ok("mark paid records date");

  // AI rewrite + limits
  r = await api("/api/ai/rewrite", { method: "POST", body: { text: "we fix roof good", instruction: "More professional" } });
  assert.equal(r.status, 200); assert.ok(r.data.text); ok("AI rewrite works");
  await env.DB.prepare("UPDATE usage SET docs = 200 WHERE user_id = ?").bind(userId).run();
  r = await api("/api/ai/draft", { method: "POST", body: { type: "invoice", prompt: "another one please" } });
  assert.equal(r.status, 402); assert.equal(r.data.code, "limit_reached"); ok("monthly AI limit enforced");
  r = await api("/api/docs", { method: "POST", body: { type: "contract" } }); assert.equal(r.status, 201); ok("manual docs still work after AI limit");

  r = await api("/api/docs"); assert.equal(r.data.docs.length, 5); assert.ok(!r.data.docs[0].data); ok("list returns summaries");

  // Privacy
  cookie = "";
  await api("/api/auth/signup", { method: "POST", body: { email: "other@example.com", password: "another-pass" } });
  r = await api(`/api/docs/${inv.id}`); assert.equal(r.status, 404); ok("documents are private to their owner");
  cookie = saved;

  // Checkout while subscribed → portal
  r = await api("/api/billing/checkout", { method: "POST", body: { plan: "business" } }); assert.match(r.data.url, /portal=1/); ok("subscribers switch plans in the portal");
  const cfg = stripeCalls.find((c) => c.path === "/billing_portal/configurations");
  assert.ok(cfg && Object.values(cfg.params).includes("price_business") && Object.values(cfg.params).includes("price_pilot"));
  assert.equal(stripeCalls.filter((c) => c.path === "/billing_portal/sessions").pop().params.configuration, "bpc_x09");
  ok("one billing portal manages every X09 plan");

  // Cancel → read-only
  const del = JSON.stringify({ type: "customer.subscription.deleted", data: { object: { ...sub, status: "canceled" } } });
  await api("/api/stripe/webhook", { method: "POST", body: del, headers: signed(del) });
  assert.equal((await api("/api/me")).data.user.plan, null);
  r = await api("/api/docs"); assert.equal(r.status, 200); assert.equal(r.data.docs.length, 5);
  r = await api("/api/docs", { method: "POST", body: { type: "invoice" } }); assert.equal(r.status, 402);
  ok("canceled plan: documents stay readable, editing blocked");

  // Delete doc + account
  r = await api(`/api/docs/${inv.id}`, { method: "DELETE" }); assert.equal(r.status, 200);
  r = await api("/api/auth/delete", { method: "POST", body: { password: "shingle-2026" } }); assert.equal(r.status, 200);
  const left = await env.DB.prepare("SELECT COUNT(*) AS n FROM docs WHERE user_id = ?").bind(userId).first();
  assert.equal(left.n, 0); ok("deleting the account deletes its documents");

  console.log(`\nAll ${pass} checks passed.`);
} catch (e) {
  console.error("\nFAILED after", pass, "checks:", e);
  process.exitCode = 1;
} finally {
  server.close();
}

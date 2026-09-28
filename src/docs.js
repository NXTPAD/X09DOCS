// Documents: invoices, estimates, proposals/quotes, contracts — stored per account in D1
import { json, now, randomId, readJson, HttpError } from "./core/util.js";
import { requireUser, hasAccess } from "./core/auth.js";

export const TYPES = {
  invoice:  { label: "Invoice",  prefix: "INV", items: true,  sections: false, signable: false },
  estimate: { label: "Estimate", prefix: "EST", items: true,  sections: false, signable: true },
  proposal: { label: "Proposal", prefix: "PRO", items: true,  sections: true,  signable: true },
  contract: { label: "Contract", prefix: "CON", items: false, sections: true,  signable: true },
};
const STATUSES = new Set(["draft", "sent", "viewed", "accepted", "declined", "paid", "void"]);
const CURRENCIES = new Set(["USD", "CAD", "EUR", "GBP", "AUD", "NZD", "MXN", "INR", "JPY", "ZAR", "CHF", "SEK", "NOK", "DKK", "BRL", "SGD", "AED", "PHP", "NGN"]);

// ---------- helpers ----------
const str = (v, max = 500) => String(v ?? "").slice(0, max);
const line = (v, max = 200) => str(v, max).replace(/[\r\n]+/g, " ").trim();
const num = (v, min = -1e9, max = 1e9) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : 0;
};
const round2 = (n) => Math.round(n * 100) / 100;
const isDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
export const today = () => new Date().toISOString().slice(0, 10);
export const addDays = (d, n) => { const x = new Date(d + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

export function cleanItems(items) {
  if (!Array.isArray(items)) return [];
  return items.slice(0, 100).map((it) => ({
    description: str(it?.description, 1000).trim(),
    qty: round2(num(it?.qty ?? 1, 0, 1e7)),
    rate: round2(num(it?.rate, -1e8, 1e8)),
  })).filter((it) => it.description || it.rate);
}

export function cleanSections(sections) {
  if (!Array.isArray(sections)) return [];
  return sections.slice(0, 40).map((s) => ({
    heading: line(s?.heading, 160),
    body: str(s?.body, 8000).trim(),
  })).filter((s) => s.heading || s.body);
}

export function totals(data) {
  const subtotal = round2((data.items || []).reduce((a, it) => a + round2(it.qty * it.rate), 0));
  const discount = Math.min(Math.max(0, data.discount || 0), Math.max(0, subtotal));
  const taxable = round2(subtotal - discount);
  const tax = round2(taxable * (data.taxRate || 0) / 100);
  const total = round2(taxable + tax);
  const deposit = data.depositPct ? round2(total * data.depositPct / 100) : 0;
  return { subtotal, discount, tax, total, deposit };
}

// Normalize everything the browser sends into a safe document body
export function cleanData(type, d = {}) {
  const c = d.client || {};
  const data = {
    client: {
      name: line(c.name, 120), company: line(c.company, 120), email: line(c.email, 200),
      phone: line(c.phone, 60), address: str(c.address, 400).trim(),
    },
    issueDate: isDate(d.issueDate) ? d.issueDate : today(),
    dueDate: isDate(d.dueDate) ? d.dueDate : "",
    currency: CURRENCIES.has(d.currency) ? d.currency : "USD",
    items: TYPES[type].items ? cleanItems(d.items) : cleanItems(d.items).slice(0, 30),
    sections: cleanSections(d.sections),
    taxRate: round2(num(d.taxRate, 0, 100)),
    discount: round2(num(d.discount, 0, 1e9)),
    depositPct: round2(num(d.depositPct, 0, 100)),
    notes: str(d.notes, 4000).trim(),
    terms: str(d.terms, 8000).trim(),
    payment: str(d.payment, 2000).trim(),
    poNumber: line(d.poNumber, 60),
  };
  return data;
}

function rowToDoc(r, full = true) {
  const out = {
    id: r.id, type: r.type, number: r.number, title: r.title, status: r.status,
    clientName: r.client_name || "", clientEmail: r.client_email || "",
    total: r.total, currency: r.currency, shareId: r.share_id,
    signerName: r.signer_name || null, signedAt: r.signed_at || null, viewedAt: r.viewed_at || null, paidAt: r.paid_at || null,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
  const data = JSON.parse(r.data || "{}");
  if (full) out.data = data;
  else { out.dueDate = data.dueDate || ""; out.issueDate = data.issueDate || ""; }
  return out;
}

async function ownDoc(env, userId, id) {
  const r = await env.DB.prepare("SELECT * FROM docs WHERE id = ? AND user_id = ?").bind(id, userId).first();
  if (!r) throw new HttpError(404, "Document not found.");
  return r;
}

function requirePlan(user) {
  if (!hasAccess(user)) throw new HttpError(402, "Choose a plan to create and edit documents.", { code: "plan_required" });
}

async function nextNumber(env, userId, type) {
  await env.DB.prepare("INSERT INTO counters (user_id, type, next) VALUES (?, ?, 1) ON CONFLICT(user_id, type) DO NOTHING").bind(userId, type).run();
  const r = await env.DB.prepare("UPDATE counters SET next = next + 1 WHERE user_id = ? AND type = ? RETURNING next - 1 AS n").bind(userId, type).first();
  return `${TYPES[type].prefix}-${String(r?.n ?? 1).padStart(4, "0")}`;
}

// ---------- Business profile ----------
export const BUSINESS_DEFAULTS = {
  name: "", email: "", phone: "", address: "", website: "", taxId: "",
  currency: "USD", taxRate: 0, payment: "", terms: "", dueDays: 14, color: "#111111", signature: "",
};

export function cleanBusiness(b = {}) {
  return {
    name: line(b.name, 120), email: line(b.email, 200), phone: line(b.phone, 60),
    address: str(b.address, 400).trim(), website: line(b.website, 200), taxId: line(b.taxId, 60),
    currency: CURRENCIES.has(b.currency) ? b.currency : "USD",
    taxRate: round2(num(b.taxRate, 0, 100)),
    payment: str(b.payment, 2000).trim(), terms: str(b.terms, 8000).trim(),
    dueDays: Math.round(num(b.dueDays ?? 14, 0, 365)),
    color: /^#[0-9a-fA-F]{6}$/.test(b.color || "") ? b.color : "#111111",
    signature: line(b.signature, 120),
  };
}

export async function loadBusiness(env, userId) {
  const r = await env.DB.prepare("SELECT data, logo FROM business WHERE user_id = ?").bind(userId).first();
  return { ...BUSINESS_DEFAULTS, ...(r ? JSON.parse(r.data) : {}), logo: r?.logo || null };
}

export async function getBusiness(request, env) {
  const user = await requireUser(request, env);
  return json({ business: await loadBusiness(env, user.id) });
}

// PUT /api/business  { ...fields, logo?: dataURL | null }
export async function saveBusiness(request, env) {
  const user = await requireUser(request, env);
  const body = await readJson(request);
  if (!body) return json({ error: "Invalid JSON" }, 400);
  const data = cleanBusiness(body);
  let logo = body.logo ?? null;
  if (logo !== null) {
    logo = String(logo);
    if (!/^data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(logo)) return json({ error: "Logo must be a PNG, JPG, WebP or SVG image." }, 400);
    if (logo.length > 300000) return json({ error: "Logo is too large — please use an image under 200 KB." }, 400);
  }
  await env.DB.prepare(
    "INSERT INTO business (user_id, data, logo, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, logo = excluded.logo, updated_at = excluded.updated_at"
  ).bind(user.id, JSON.stringify(data), logo, now()).run();
  return json({ business: { ...data, logo } });
}

// ---------- Documents ----------
export async function listDocs(request, env) {
  const user = await requireUser(request, env);
  const { results } = await env.DB.prepare(
    "SELECT * FROM docs WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1000"
  ).bind(user.id).all();
  return json({ docs: results.map((r) => rowToDoc(r, false)) });
}

export async function getDoc(request, env, id) {
  const user = await requireUser(request, env);
  return json({ doc: rowToDoc(await ownDoc(env, user.id, id)) });
}

function defaultTitle(type, data) {
  const who = data.client.company || data.client.name;
  return `${TYPES[type].label}${who ? " for " + who : ""}`;
}

export async function insertDoc(env, user, type, data, title) {
  const id = randomId(10);
  const number = await nextNumber(env, user.id, type);
  const t = totals(data);
  const finalTitle = line(title, 160) || defaultTitle(type, data);
  await env.DB.prepare(
    `INSERT INTO docs (id, user_id, type, number, title, status, client_name, client_email, total, currency, data, share_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, user.id, type, number, finalTitle, data.client.company || data.client.name, data.client.email, t.total, data.currency,
    JSON.stringify(data), randomId(16), now(), now()).run();
  return rowToDoc(await env.DB.prepare("SELECT * FROM docs WHERE id = ?").bind(id).first());
}

// Fill blanks from the business profile (currency, tax, terms, payment, due date)
export function withDefaults(type, raw, biz) {
  const d = { ...raw };
  if (!d.currency) d.currency = biz.currency;
  if (d.taxRate == null || d.taxRate === "") d.taxRate = TYPES[type].items ? biz.taxRate : 0;
  if (!d.terms && type !== "contract") d.terms = biz.terms;
  if (!d.payment && type === "invoice") d.payment = biz.payment;
  if (!d.issueDate) d.issueDate = today();
  if (!d.dueDate) d.dueDate = type === "invoice" ? addDays(d.issueDate, biz.dueDays ?? 14) : type === "contract" ? "" : addDays(d.issueDate, 30);
  return d;
}

// POST /api/docs  { type, title?, data? }
export async function createDoc(request, env) {
  const user = await requireUser(request, env);
  requirePlan(user);
  const body = await readJson(request);
  const type = body?.type;
  if (!TYPES[type]) return json({ error: "Unknown document type." }, 400);
  const biz = await loadBusiness(env, user.id);
  const data = cleanData(type, withDefaults(type, body.data || {}, biz));
  return json({ doc: await insertDoc(env, user, type, data, body.title) }, 201);
}

// PUT /api/docs/:id  { title?, status?, data? }
export async function updateDoc(request, env, id) {
  const user = await requireUser(request, env);
  requirePlan(user);
  const r = await ownDoc(env, user.id, id);
  const body = await readJson(request);
  if (!body) return json({ error: "Invalid JSON" }, 400);

  let status = r.status, paidAt = r.paid_at;
  if (body.status !== undefined) {
    if (!STATUSES.has(body.status)) return json({ error: "Unknown status." }, 400);
    status = body.status;
    if (status === "paid" && !paidAt) paidAt = now();
    if (status !== "paid") paidAt = null;
  }

  let data = JSON.parse(r.data);
  let title = r.title;
  if (body.data !== undefined || body.title !== undefined) {
    if (r.signed_at && body.data !== undefined) {
      throw new HttpError(409, "This document has been signed by your client, so its contents are locked. Duplicate it to make a new version.", { code: "locked" });
    }
    if (body.data !== undefined) data = cleanData(r.type, body.data);
    if (body.title !== undefined) title = line(body.title, 160) || defaultTitle(r.type, data);
  }
  const t = totals(data);
  await env.DB.prepare(
    "UPDATE docs SET title = ?, status = ?, paid_at = ?, client_name = ?, client_email = ?, total = ?, currency = ?, data = ?, updated_at = ? WHERE id = ?"
  ).bind(title, status, paidAt, data.client.company || data.client.name, data.client.email, t.total, data.currency, JSON.stringify(data), now(), id).run();
  return json({ doc: rowToDoc(await env.DB.prepare("SELECT * FROM docs WHERE id = ?").bind(id).first()) });
}

// POST /api/docs/:id/duplicate  { type? }  — also converts (e.g. estimate → invoice)
export async function duplicateDoc(request, env, id) {
  const user = await requireUser(request, env);
  requirePlan(user);
  const r = await ownDoc(env, user.id, id);
  const body = (await readJson(request)) || {};
  const type = TYPES[body.type] ? body.type : r.type;
  const biz = await loadBusiness(env, user.id);
  const src = JSON.parse(r.data);
  const raw = { ...src, issueDate: "", dueDate: "" };
  if (type !== r.type) {
    if (type === "invoice") { raw.payment = src.payment || ""; raw.sections = []; raw.depositPct = 0; }
    if (!TYPES[type].sections) raw.sections = [];
  }
  const data = cleanData(type, withDefaults(type, raw, biz));
  const title = type === r.type ? `${r.title} (copy)` : r.title.replace(new RegExp("^" + TYPES[r.type].label), TYPES[type].label);
  return json({ doc: await insertDoc(env, user, type, data, title) }, 201);
}

export async function deleteDoc(request, env, id) {
  const user = await requireUser(request, env);
  await ownDoc(env, user.id, id);
  await env.DB.prepare("DELETE FROM docs WHERE id = ?").bind(id).run();
  return json({ ok: true });
}

// Client-facing share links: /d/:shareId — view, accept & e-sign, or decline. No account needed.
import { json, now, readJson, HttpError } from "./core/util.js";
import { getUser } from "./core/auth.js";
import { PRODUCTS, ACTIVE_STATUSES } from "./core/catalog.js";
import { TYPES, loadBusiness } from "./docs.js";

async function byShare(env, sid) {
  const r = await env.DB.prepare(
    "SELECT d.*, s.plan AS owner_plan, s.status AS owner_status FROM docs d LEFT JOIN subscriptions s ON s.user_id = d.user_id AND s.product = 'docs' WHERE d.share_id = ?"
  ).bind(sid).first();
  if (!r || r.status === "void") throw new HttpError(404, "This document isn't available. Ask the sender for a new link.");
  return r;
}

function publicDoc(r) {
  return {
    type: r.type, typeLabel: TYPES[r.type].label, number: r.number, title: r.title, status: r.status,
    total: r.total, currency: r.currency, data: JSON.parse(r.data),
    signerName: r.signer_name || null, signedAt: r.signed_at || null, paidAt: r.paid_at || null,
    signable: TYPES[r.type].signable, createdAt: r.created_at,
  };
}

// GET /api/share/:sid
export async function viewShared(request, env, sid) {
  const r = await byShare(env, sid);
  const viewer = await getUser(request, env);
  const isOwner = viewer && viewer.id === r.user_id;
  if (!isOwner && r.status === "sent") {
    await env.DB.prepare("UPDATE docs SET status = 'viewed', viewed_at = ? WHERE id = ? AND status = 'sent'").bind(now(), r.id).run();
    r.status = "viewed";
  } else if (!isOwner && !r.viewed_at) {
    await env.DB.prepare("UPDATE docs SET viewed_at = ? WHERE id = ?").bind(now(), r.id).run();
  }
  const biz = await loadBusiness(env, r.user_id);
  const plan = PRODUCTS.docs.plans[r.owner_plan];
  const whiteLabel = !!(plan && plan.whiteLabel && ACTIVE_STATUSES.has(r.owner_status));
  return json({ doc: publicDoc(r), business: biz, branding: !whiteLabel, isOwner: !!isOwner });
}

// POST /api/share/:sid/accept  { name, agree: true }
export async function acceptShared(request, env, sid) {
  const r = await byShare(env, sid);
  if (!TYPES[r.type].signable) return json({ error: "This document doesn't need a signature." }, 400);
  if (r.signed_at) return json({ error: "This document has already been signed." }, 409);
  if (r.status === "declined") return json({ error: "This document was declined. Ask the sender for a new version." }, 409);
  const body = await readJson(request);
  const name = String(body?.name || "").replace(/\s+/g, " ").trim().slice(0, 120);
  if (name.length < 2) return json({ error: "Type your full name to sign." }, 400);
  if (body?.agree !== true) return json({ error: "Please tick the box to confirm you agree." }, 400);
  const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "";
  await env.DB.prepare(
    "UPDATE docs SET status = 'accepted', signer_name = ?, signed_at = ?, sign_ip = ?, updated_at = ? WHERE id = ? AND signed_at IS NULL"
  ).bind(name, now(), ip.slice(0, 64), now(), r.id).run();
  return json({ doc: publicDoc(await byShare(env, sid)) });
}

// POST /api/share/:sid/decline
export async function declineShared(request, env, sid) {
  const r = await byShare(env, sid);
  if (!TYPES[r.type].signable) return json({ error: "Nothing to decline here." }, 400);
  if (r.signed_at) return json({ error: "This document has already been signed." }, 409);
  await env.DB.prepare("UPDATE docs SET status = 'declined', updated_at = ? WHERE id = ?").bind(now(), r.id).run();
  return json({ doc: publicDoc(await byShare(env, sid)) });
}

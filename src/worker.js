/**
 * X09 Docs — Cloudflare Worker (router)
 *
 *  Accounts   POST /api/auth/signup | login | logout | delete | password     POST /api/profile     GET /api/me
 *  Plans      GET  /api/plans
 *  Billing    POST /api/billing/checkout | /api/billing/portal               POST /api/stripe/webhook
 *  Business   GET/PUT /api/business
 *  Docs       GET/POST /api/docs     GET/PUT/DELETE /api/docs/:id     POST /api/docs/:id/duplicate
 *  AI         POST /api/ai/draft | /api/ai/rewrite
 *  Clients    GET /api/share/:sid     POST /api/share/:sid/accept | /decline     page: /d/:sid
 *  Everything else → the app in /public
 */
import { json, HttpError } from "./util.js";
import { signup, login, logout, me, deleteAccount, updateProfile, changePassword } from "./auth.js";
import { checkout, portal, webhook } from "./stripe.js";
import { publicPlans } from "./plans.js";
import { listDocs, getDoc, createDoc, updateDoc, duplicateDoc, deleteDoc, getBusiness, saveBusiness } from "./docs.js";
import { aiDraft, aiRewrite } from "./ai.js";
import { viewShared, acceptShared, declineShared } from "./share.js";

// Block cross-site form posts: state-changing requests must come from our own origin
function sameOrigin(request) {
  const o = request.headers.get("origin");
  return !o || o === new URL(request.url).origin;
}

async function route(request, env) {
  const url = new URL(request.url);
  const p = url.pathname;
  const m = request.method;

  // Client-facing document page
  if (/^\/d\/[a-f0-9]{16,64}\/?$/.test(p) && (m === "GET" || m === "HEAD")) {
    const page = await env.ASSETS.fetch(new Request(new URL("/view", url), request));
    const res = new Response(page.body, page);
    res.headers.set("x-robots-tag", "noindex");
    res.headers.set("referrer-policy", "no-referrer");
    return res;
  }

  if (p === "/api/stripe/webhook" && m === "POST") return webhook(request, env);
  if (m !== "GET" && m !== "HEAD" && !sameOrigin(request)) return json({ error: "Forbidden" }, 403);

  if (p === "/api/health") return json({ ok: true, service: "x09-docs", time: new Date().toISOString() });
  if (p === "/api/plans" && m === "GET") return json({ plans: publicPlans() });

  if (p === "/api/auth/signup" && m === "POST") return signup(request, env);
  if (p === "/api/auth/login" && m === "POST") return login(request, env);
  if (p === "/api/auth/logout" && m === "POST") return logout(request, env);
  if (p === "/api/auth/delete" && m === "POST") return deleteAccount(request, env);
  if (p === "/api/auth/password" && m === "POST") return changePassword(request, env);
  if (p === "/api/profile" && m === "POST") return updateProfile(request, env);
  if (p === "/api/me" && m === "GET") return me(request, env);

  if (p === "/api/billing/checkout" && m === "POST") return checkout(request, env);
  if (p === "/api/billing/portal" && m === "POST") return portal(request, env);

  if (p === "/api/business" && m === "GET") return getBusiness(request, env);
  if (p === "/api/business" && m === "PUT") return saveBusiness(request, env);

  if (p === "/api/docs" && m === "GET") return listDocs(request, env);
  if (p === "/api/docs" && m === "POST") return createDoc(request, env);
  const d = p.match(/^\/api\/docs\/([a-f0-9]{8,40})(\/duplicate)?$/);
  if (d && !d[2] && m === "GET") return getDoc(request, env, d[1]);
  if (d && !d[2] && m === "PUT") return updateDoc(request, env, d[1]);
  if (d && !d[2] && m === "DELETE") return deleteDoc(request, env, d[1]);
  if (d && d[2] && m === "POST") return duplicateDoc(request, env, d[1]);

  if (p === "/api/ai/draft" && m === "POST") return aiDraft(request, env);
  if (p === "/api/ai/rewrite" && m === "POST") return aiRewrite(request, env);

  const s = p.match(/^\/api\/share\/([a-f0-9]{16,64})(\/accept|\/decline)?$/);
  if (s && !s[2] && m === "GET") return viewShared(request, env, s[1]);
  if (s && s[2] === "/accept" && m === "POST") return acceptShared(request, env, s[1]);
  if (s && s[2] === "/decline" && m === "POST") return declineShared(request, env, s[1]);

  if (p.startsWith("/api/")) return json({ error: "Not found" }, 404);
  return env.ASSETS.fetch(request);
}

export default {
  async fetch(request, env, ctx) {
    try {
      return await route(request, env, ctx);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message, ...err.extra }, err.status);
      console.error(err);
      return json({ error: "Something went wrong on our side. Please try again." }, 500);
    }
  },
};

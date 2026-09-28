/**
 * X09 Docs — Cloudflare Worker (router)
 *
 *  Shared X09 routes (src/core/router.js): accounts, profile, plans, billing, Stripe webhook
 *  Business   GET/PUT /api/business
 *  Docs       GET/POST /api/docs     GET/PUT/DELETE /api/docs/:id     POST /api/docs/:id/duplicate
 *  AI         POST /api/ai/draft | /api/ai/rewrite   (Claude)
 *  Clients    GET /api/share/:sid     POST /api/share/:sid/accept | /decline     page: /d/:sid
 *  Everything else → the app in /public
 */
import { json, HttpError } from "./core/util.js";
import { coreRoute } from "./core/router.js";
import { listDocs, getDoc, createDoc, updateDoc, duplicateDoc, deleteDoc, getBusiness, saveBusiness } from "./docs.js";
import { aiDraft, aiRewrite } from "./ai.js";
import { viewShared, acceptShared, declineShared } from "./share.js";

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

  const core = await coreRoute(request, env);
  if (core) return core;

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

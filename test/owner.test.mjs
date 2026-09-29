// Owner accounts: emails in X09_OWNER_EMAILS get the top plan of every product, free.
//   node --experimental-sqlite test/owner.test.mjs
import assert from "node:assert/strict";
import { server, env, stripeCalls } from "./dev-server.mjs";
import { PRODUCTS, PRODUCT_ORDER } from "../src/core/catalog.js";

const PORT = 8799;
await new Promise((r) => server.listen(PORT, r));
const BASE = `http://localhost:${PORT}`;
env.X09_OWNER_EMAILS = " Boss@Example.com , second@example.com";

function client() {
  let cookie = "";
  return async (path, { method = "GET", body, raw = false } = {}) => {
    const res = await fetch(BASE + path, { method, headers: { "content-type": "application/json", cookie, origin: BASE }, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = res.headers.getSetCookie(); if (sc.length) cookie = sc[0].split(";")[0];
    if (raw) return res;
    return { status: res.status, data: await res.json().catch(() => null) };
  };
}
let pass = 0; const ok = (n) => { pass++; console.log("  ✓", n); };
try {
  const owner = client();
  let r = await owner("/api/auth/signup", { method: "POST", body: { email: "boss@example.com", password: "owner-pass-2026" } });
  assert.ok(r.status < 300, JSON.stringify(r.data));
  r = await owner("/api/me");
  const u = r.data.user;
  assert.equal(u.owner, true);
  for (const p of PRODUCT_ORDER) { const top = PRODUCTS[p].order.at(-1); assert.equal(u.products[p].plan, top, p); }
  ok(`owner email gets the top plan of every product (${PRODUCT_ORDER.map((p) => u.products[p].planName).join(", ")})`);
  const before = stripeCalls.length;
  r = await owner("/api/billing/checkout", { method: "POST", body: { product: PRODUCT_ORDER[0], plan: PRODUCTS[PRODUCT_ORDER[0]].order[0] } });
  assert.equal(r.status, 400); assert.match(r.data.error, /owner/i); assert.equal(stripeCalls.length, before);
  ok("owner is never sent to Stripe checkout");
  if (PRODUCT_ORDER.includes("defense")) {
    const html = await (await owner("/defense/", { raw: true })).text();
    assert.match(html, /<script id="core">/); ok("owner opens the X09 Defense toolkit");
  }
  const other = client();
  await other("/api/auth/signup", { method: "POST", body: { email: "someone@example.com", password: "regular-pass-2026" } });
  r = await other("/api/me");
  assert.equal(r.data.user.owner, false);
  for (const p of PRODUCT_ORDER) assert.equal(r.data.user.products[p].plan, null);
  ok("everyone else still needs a paid plan");
  env.X09_OWNER_EMAILS = "";
  r = await owner("/api/me"); assert.equal(r.data.user.owner, false); assert.equal(r.data.user.products[PRODUCT_ORDER[0]].plan, null);
  ok("removing the email from the secret removes owner access");
  console.log(`\nAll ${pass} owner checks passed.`);
} catch (e) { console.error(e); process.exitCode = 1; } finally { server.close(); }

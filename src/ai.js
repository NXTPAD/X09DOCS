// AI drafting (Claude via the Anthropic API): turn a plain-English job description into a structured
// document (Claude Sonnet 5), and rewrite individual sections (Claude Haiku 4.5).
// Each call uses 1 AI credit from the monthly plan allowance.
import { json, readJson, HttpError } from "./core/util.js";
import { requireUser, hasAccess, activePlan, consume as consumeMeter } from "./core/auth.js";
import { PRODUCTS } from "./core/catalog.js";
import { claude, textOf } from "./core/anthropic.js";
import { TYPES, loadBusiness, cleanItems, cleanSections, today } from "./docs.js";

const MAX_PROMPT = 4000;

// ---------- Usage ----------
function consume(env, user) {
  const plan = PRODUCTS.docs.plans[activePlan(user, "docs")];
  const limit = plan.limits.docs;
  return consumeMeter(env, user.id, "docs", limit,
    `You've used all ${limit} AI drafts in your ${plan.name} plan this month. You can still create and edit documents by hand — or upgrade for more.`);
}

function gate(user) {
  if (!hasAccess(user, "docs")) throw new HttpError(402, "Choose a plan to use AI drafting.", { code: "plan_required" });
}

// ---------- Prompts ----------
const GUIDE = {
  invoice:
    "Write an INVOICE. Put every billable thing in `items` (description, qty, rate = unit price). " +
    "Use the exact prices and quantities the user gives. If they give a lump sum, use qty 1. `sections` must be []. " +
    "`notes` = a short thank-you line. Leave `terms` empty unless the user mentions payment terms.",
  estimate:
    "Write a contractor-style ESTIMATE. Break the work into clear line `items` (labor, materials, disposal, permits, etc.). " +
    "Use the user's prices when given; when a price isn't given, use a realistic typical US market rate and keep it round. " +
    "`sections` must be []. `notes` = scope assumptions and exclusions in 2–4 short sentences. " +
    "`terms` = short estimate terms (validity, change orders, payment schedule).",
  proposal:
    "Write a persuasive but plain-spoken PROPOSAL / QUOTE. `sections` should include, in order: Overview, Scope of work, " +
    "Deliverables, Timeline, Why us — each body 2–6 sentences or a short '- ' bulleted list. Put the pricing in `items`. " +
    "Use the user's prices when given; otherwise realistic typical rates. `terms` = acceptance, payment schedule and validity.",
  contract:
    "Write a clear, plain-English SERVICE CONTRACT. `items` must be [] unless the user lists fees. `sections` should cover: " +
    "Parties & purpose, Scope of services, Payment, Timeline, Changes, Warranties, Insurance & liability (if relevant), " +
    "Termination, Governing law (leave the state as [STATE] if unknown), and Entire agreement. Each body is complete " +
    "contract language, 2–6 sentences, using 'Provider' for the business and 'Client' for the customer. `notes` = ''. " +
    "Do not invent names, addresses or dates the user didn't give — use [BRACKETED PLACEHOLDERS] instead.",
};

const SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    client: {
      type: "object",
      properties: { name: { type: "string" }, company: { type: "string" }, email: { type: "string" }, address: { type: "string" } },
    },
    items: {
      type: "array",
      items: { type: "object", properties: { description: { type: "string" }, qty: { type: "number" }, rate: { type: "number" } }, required: ["description", "qty", "rate"] },
    },
    sections: {
      type: "array",
      items: { type: "object", properties: { heading: { type: "string" }, body: { type: "string" } }, required: ["heading", "body"] },
    },
    notes: { type: "string" },
    terms: { type: "string" },
    taxRate: { type: "number" },
  },
  required: ["title", "items", "sections", "notes", "terms"],
};

function draftSystem(type, biz) {
  return [
    `You are X09 Docs, an assistant that drafts business documents for small businesses and contractors. Today is ${today()}.`,
    biz.name ? `The business sending this document is "${biz.name}".` : "",
    GUIDE[type],
    "Only fill `client` with details the user actually gave (leave fields as empty strings otherwise).",
    "`title` is a short document title like 'Roof replacement — 24 Oak St' (max 70 characters), without the word Invoice/Estimate/etc.",
    "Only set `taxRate` (a percent) if the user states one; otherwise 0.",
    "Return the document by calling the write_document tool.",
  ].filter(Boolean).join("\n");
}

// ---------- Model calls ----------
function extractJson(text) {
  if (text && typeof text === "object") return text;
  const s = String(text || "");
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
}

// Claude fills in the document through a forced tool call, so the result is always valid JSON
async function runJson(env, system, user) {
  const msg = await claude(env, {
    kind: "deep",
    system,
    messages: [{ role: "user", content: user }],
    max_tokens: 4096,
    temperature: 0.4,
    tools: [{ name: "write_document", description: "Return the drafted document.", input_schema: SCHEMA }],
    tool_choice: { type: "tool", name: "write_document" },
  });
  const call = (msg.content || []).find((b) => b.type === "tool_use");
  if (call?.input && typeof call.input === "object") return call.input;
  const j = extractJson(textOf(msg));
  if (!j) throw new Error("Model did not return JSON");
  return j;
}

function mockDraft(type, prompt) {
  const nums = [...prompt.matchAll(/\$?\b(\d+(?:\.\d+)?)\b/g)].map((m) => Number(m[1]));
  return {
    title: prompt.replace(/\s+/g, " ").slice(0, 50),
    client: { name: "Test Client", company: "", email: "", address: "" },
    items: TYPES[type].items ? [{ description: "Labor (test mode)", qty: 1, rate: nums[0] || 500 }, { description: "Materials (test mode)", qty: 2, rate: nums[1] || 120 }] : [],
    sections: TYPES[type].sections ? [{ heading: "Scope of work", body: "Test mode — the real AI isn't connected here. Once deployed, X09 writes this section from your description." }] : [],
    notes: "Thank you for your business!",
    terms: type === "invoice" ? "" : "Valid for 30 days.",
    taxRate: 0,
  };
}

// POST /api/ai/draft  { type, prompt }
export async function aiDraft(request, env) {
  const user = await requireUser(request, env);
  gate(user);
  const body = await readJson(request);
  const type = body?.type;
  if (!TYPES[type]) return json({ error: "Unknown document type." }, 400);
  const prompt = String(body.prompt || "").trim();
  if (prompt.length < 4) return json({ error: "Describe the job in a sentence or two first." }, 400);
  if (prompt.length > MAX_PROMPT) return json({ error: `Descriptions are limited to ${MAX_PROMPT} characters.` }, 400);

  const refund = await consume(env, user);
  let raw;
  try {
    if (env.MOCK_AI === "1") raw = mockDraft(type, prompt);
    else raw = await runJson(env, draftSystem(type, await loadBusiness(env, user.id)), prompt);
  } catch (err) {
    await refund();
    if (err instanceof HttpError) throw err;
    console.error(err);
    throw new HttpError(502, "The AI couldn't draft that one. Try again, or add a little more detail.");
  }

  const c = raw.client || {};
  const draft = {
    title: String(raw.title || "").replace(/^(invoice|estimate|proposal|quote|contract)\s*[:—-]\s*/i, "").slice(0, 120),
    client: { name: String(c.name || "").slice(0, 120), company: String(c.company || "").slice(0, 120), email: String(c.email || "").slice(0, 200), address: String(c.address || "").slice(0, 400) },
    items: cleanItems(raw.items),
    sections: TYPES[type].sections ? cleanSections(raw.sections) : [],
    notes: String(raw.notes || "").slice(0, 4000),
    terms: String(raw.terms || "").slice(0, 8000),
    taxRate: Number.isFinite(Number(raw.taxRate)) ? Math.min(100, Math.max(0, Number(raw.taxRate))) : 0,
  };
  return json({ draft });
}

// POST /api/ai/rewrite  { text, instruction?, context? }
export async function aiRewrite(request, env) {
  const user = await requireUser(request, env);
  gate(user);
  const body = await readJson(request);
  const text = String(body?.text || "").trim();
  const instruction = String(body?.instruction || "Make it clearer and more professional.").slice(0, 300);
  const context = String(body?.context || "").slice(0, 200);
  if (!text) return json({ error: "Nothing to rewrite yet." }, 400);
  if (text.length > 8000) return json({ error: "That section is too long to rewrite in one go." }, 400);

  const refund = await consume(env, user);
  try {
    let out;
    if (env.MOCK_AI === "1") out = `${text} (rewritten in test mode)`;
    else {
      const r = await claude(env, {
        kind: "fast",
        system: "You edit text for business documents (invoices, estimates, proposals, contracts). Follow the instruction, keep every fact, name, number and price unchanged, and keep [BRACKETED PLACEHOLDERS]. Reply with ONLY the rewritten text — no preamble, no quotes, no markdown headings. Plain '- ' bullets are fine.",
        messages: [{ role: "user", content: `${context ? `Section: ${context}\n` : ""}Instruction: ${instruction}\n\nText:\n${text}` }],
        max_tokens: 1800,
        temperature: 0.4,
      });
      out = textOf(r).trim().replace(/^["“]|["”]$/g, "");
      if (!out) throw new Error("empty");
    }
    return json({ text: out.slice(0, 8000) });
  } catch (err) {
    await refund();
    if (err instanceof HttpError) throw err;
    console.error(err);
    throw new HttpError(502, "The AI couldn't rewrite that. Please try again.");
  }
}

# X09 Docs

AI invoices, estimates, proposals/quotes and contracts, in the X09 black-and-white space style, on **Cloudflare Workers**, drafted by **Claude (Anthropic API)**.
It uses the shared **X09 account** and the `x09-db` database: one sign-in, profile and bill across X09 Hub, X09 AI and X09 Docs. **Read `X09-SHARED.md` first.**
Describe the job in plain English → X09 drafts the document → edit it with a live preview → send your client a link
where they can view, download a PDF and **e-sign**. Paid plans only (Stripe), no free tier. Lives at **docs.x09hub.com**.

```
public/index.html, app.js    the app (home composer, documents, editor, settings)
public/view.html, view.js    the client page at /d/<link> (view, PDF, accept & sign, decline)
public/render.js, paper.css  the document layout, shared by preview, PDF and client page
src/worker.js                router
src/core/                    shared X09 core: accounts, Stripe, Claude client, plans catalog
src/docs.js                  documents, numbering, totals, business profile
src/ai.js                    AI drafting (Claude Sonnet 5) + rewrite (Claude Haiku 4.5)
src/share.js                 client links: view / accept / decline
migrations/                  D1 database schema
test/                        local test server + 41 end-to-end API checks (npm test)
scripts/setup-db.mjs         Cloudflare build step: finds/creates the D1 database
```

## Plans (edit `src/core/catalog.js`)

| Plan | Price | AI drafts / mo | Documents | Extras |
|---|---|---|---|---|
| Solo | $9 | 40 | Unlimited | |
| Pro | $19 | 200 | Unlimited | |
| Business | $39 | 600 | Unlimited | No "Sent with X09 Docs" on client pages |

An AI draft costs roughly $0.02 with Claude Sonnet 5 (a rewrite ≈ $0.004 with Haiku), so a Business customer who uses every draft costs ≈ $12 of $39.
Documents stay readable if someone cancels; creating, editing and AI are blocked until they subscribe again.

## Features
- **4 document types**: invoice, estimate, proposal/quote, contract — auto-numbered (INV-0001, EST-0001, PRO-0001, CON-0001).
- **AI drafting** from a sentence ("Invoice Mike for 6 hrs at $85/hr plus a $140 flashing kit"), plus ✦ Write/Improve on any section, notes or terms.
- **Editor** with line items, tax %, discount, deposit %, sections/clauses, live paper preview, autosave.
- **Business settings**: logo, brand color, contact info, default tax, payment instructions, default terms, invoice due days, typed signature.
- **Send**: client link + Email / Text / Share buttons. Status tracks Draft → Sent → Viewed → Accepted / Paid.
- **E-signature**: client types their name + agrees; name, time and IP are recorded and the document locks. Duplicate to make a new version.
- **Convert** an accepted estimate or proposal into an invoice in one click.
- **PDF**: browser "Save as PDF" of a clean print layout (app and client page).
- **Dashboard**: outstanding, paid in the last 30 days, overdue, awaiting signature.

---

## One-time setup

### 1. GitHub
Create a new repository (e.g. `NXTPAD/x09-docs`) and upload everything in this folder.

### 2. Cloudflare
Nothing to create by hand. The build finds the shared `x09-db` database (the same one X09 AI and the Hub use) and hooks up **docs.x09hub.com**
(the `routes` entry in `wrangler.toml`; x09hub.com must be in the same Cloudflare account, like ai.x09hub.com).

### 3. Stripe (the same Stripe account as X09 AI)
Create the products named in `X09-SHARED.md` (**X09 Docs Solo** $9, **X09 Docs Pro** $19, **X09 Docs Business** $39, each a
recurring monthly price). The app finds their prices automatically. One webhook endpoint for all X09 sites is enough (see
`X09-SHARED.md`), and the existing `https://docs.x09hub.com/api/stripe/webhook` endpoint keeps working too. The Customer Portal
configuration is created automatically and covers every X09 plan.

### 4. Cloudflare → connect the repo (Workers Builds)
Workers & Pages → Create → Import a repository → pick the repo, then set:

| Setting | Value |
|---|---|
| Build command | `npm run build` |
| Deploy command | `npm run deploy` |

The build step finds the shared `x09-db` database automatically; the deploy step applies database
migrations and deploys. Then in the Worker → **Settings → Variables and Secrets**, add three **secrets**:
`ANTHROPIC_API_KEY` (`sk-ant-...`), `STRIPE_SECRET_KEY` (`sk_...`) and `STRIPE_WEBHOOK_SECRET` (the `whsec_...` from step 3). Every push to `main` redeploys.

### 5. Test a payment
With `sk_test_` keys, subscribe with card `4242 4242 4242 4242`, any future date, any CVC.

---

## Local testing
`npm test` — 41 end-to-end checks (paywall, checkout, webhooks incl. ignoring X09 AI events, AI drafts + limits,
numbering, totals, client links, e-signing, locking, converting, privacy, cancellation, account deletion) with an in-memory
database, mock AI and mock Stripe. `npm run test:server` runs the same mock setup at http://localhost:8787.

## Good next steps
- "Pay now" button on invoices (Stripe Connect so clients pay you directly by card).
- Emailing documents from the app (needs an email provider such as Resend), plus automatic overdue reminders.
- Saved clients and saved line items / price book.
- Password reset emails, Cloudflare Turnstile on signup, Terms & Privacy pages.

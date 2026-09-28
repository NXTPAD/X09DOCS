// ============================================================
//  X09 Docs plans — edit prices/limits here.
//  `price` is only the label shown in the app. What customers are actually
//  charged is the monthly Price on the Stripe product named `product`.
// ============================================================
export const PLANS = {
  solo: {
    name: "Solo",
    product: "X09 Docs Solo",       // exact Stripe product name
    price: "$9",
    interval: "month",
    ai: 40,                          // AI drafts + rewrites per calendar month
    priceEnv: "STRIPE_PRICE_SOLO",
    blurb: "For freelancers and one-person crews.",
    whiteLabel: false,
  },
  pro: {
    name: "Pro",
    product: "X09 Docs Pro",
    price: "$19",
    interval: "month",
    ai: 200,
    priceEnv: "STRIPE_PRICE_PRO",
    blurb: "For busy contractors and small shops.",
    featured: true,
    whiteLabel: false,
  },
  business: {
    name: "Business",
    product: "X09 Docs Business",
    price: "$39",
    interval: "month",
    ai: 600,
    priceEnv: "STRIPE_PRICE_BUSINESS",
    blurb: "High volume, no X09 branding on client pages.",
    whiteLabel: true,
  },
};

export const PLAN_ORDER = ["solo", "pro", "business"];

// Subscription states that keep access on (past_due = Stripe is retrying the card)
export const ACTIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

export function publicPlans() {
  return PLAN_ORDER.map((key) => {
    const p = PLANS[key];
    return { key, name: p.name, price: p.price, interval: p.interval, ai: p.ai, blurb: p.blurb, featured: !!p.featured, whiteLabel: p.whiteLabel };
  });
}

import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const EXPERIMENT = "av-meta-nov26-v1", WINDOW = 7 * 86400;
const ARMS = ["reel-a", "species", "photo"];
const integer = (n) => Number.isSafeInteger(n) && n >= 0;
const ratio = (a, b) => b ? a / b : null;
function rows(value) {
  if (Array.isArray(value)) return value.flatMap((row) => Array.isArray(row.results) ? row.results : [row]);
  if (Array.isArray(value?.results)) return rows(value.results);
  throw new Error("Arrivals must be an array or D1 results export.");
}
function lineItems(value) {
  if (Array.isArray(value)) return value;
  return String(value || "").split(";").filter(Boolean).map((line) => {
    const [id, build, qty] = line.split("|"); return { id, build, qty: Number(qty) };
  });
}
const frames = (payment) => lineItems(payment.items).filter((item) => item.id === "avian-visitors" && /^assembled-(continuous|batch-\d+)$/.test(item.build) && integer(item.qty) && item.qty > 0);
const paidAt = (payment) => Number(payment.productionPaidAt || 0);
function summarizeOrders(payments) {
  const result = { orders: payments.length, buyers: new Set(payments.map((p) => p.anon)).size,
    frameUnits: payments.reduce((sum, p) => sum + frames(p).reduce((n, item) => n + item.qty, 0), 0),
    grossMerchandiseCents: 0, merchandiseKnownOrders: 0, refundedCents: 0, refundKnownOrders: 0, refundedOrders: 0,
    contributionBeforeAdsCents: 0, contributionKnownOrders: 0 };
  for (const payment of payments) {
    const breakdown = typeof payment.breakdown === "string" ? payment.breakdown.split("|").map(Number) : null;
    if (breakdown?.length === 4 && breakdown.every(integer) && integer(payment.discount ?? 0) && breakdown[0] >= (payment.discount ?? 0)) {
      result.grossMerchandiseCents += breakdown[0] - (payment.discount ?? 0); result.merchandiseKnownOrders++;
    }
    if (integer(payment.refundedAmount)) {
      result.refundedCents += payment.refundedAmount; result.refundKnownOrders++;
      if (payment.refundedAmount) result.refundedOrders++;
    }
    if (Number.isSafeInteger(payment.contributionCents)) {
      result.contributionBeforeAdsCents += payment.contributionCents; result.contributionKnownOrders++;
    }
  }
  if (result.merchandiseKnownOrders !== payments.length) result.grossMerchandiseCents = null;
  if (result.refundKnownOrders !== payments.length) result.refundedCents = null;
  if (result.contributionKnownOrders !== payments.length) result.contributionBeforeAdsCents = null;
  return result;
}
export function buildPaidCampaignReport({ arrivals, stripe, start, end, asOf, spend = {} }) {
  if (![start, end, asOf].every(integer) || end <= start || asOf < start) throw new Error("Use Unix seconds and an increasing delivery interval.");
  if (stripe?.complete !== true || !Array.isArray(stripe.payments)) throw new Error("A complete sanitized Stripe export is required.");
  const capturedAt = Math.floor(Date.parse(stripe.capturedAt) / 1000);
  if (!integer(capturedAt) || capturedAt < asOf) throw new Error("Stripe snapshot does not cover asOf.");
  const coverage = { arrivalRows: 0, validArrivalRows: 0, duplicateArrivalRows: 0, priorExperimentVisitors: 0,
    paidFrameOrders: 0, missingAnonOrders: 0, missingVerifiedPaidTimeOrders: 0, unmatchedOrders: 0,
    outsideSevenDayOrders: 0, futureOrders: 0, historicalOrders: 0, delayedArrivalRows: 0, ambiguousFirstVisitors: 0 };
  const seen = new Set(), byVisitor = new Map();
  for (const row of rows(arrivals)) {
    coverage.arrivalRows++;
    if (row.experiment !== EXPERIMENT || !ARMS.includes(row.arm) || typeof row.anon !== "string" || !row.anon ||
        typeof row.touch_id !== "string" || !row.touch_id || !integer(row.received_at) || row.received_at > asOf) continue;
    const key = row.anon + "\0" + row.touch_id;
    if (seen.has(key)) { coverage.duplicateArrivalRows++; continue; } seen.add(key);
    coverage.validArrivalRows++;
    if (integer(row.client_at) && row.received_at - row.client_at > 300) coverage.delayedArrivalRows++;
    if (!byVisitor.has(row.anon)) byVisitor.set(row.anon, []);
    byVisitor.get(row.anon).push(row);
  }
  const cohort = new Map();
  for (const [anon, touches] of byVisitor) {
    touches.sort((a, b) => a.received_at - b.received_at || (a.arrival_index || 0) - (b.arrival_index || 0));
    const tied = touches.filter((touch) => touch.received_at === touches[0].received_at);
    if (new Set(tied.map((touch) => touch.arm)).size > 1 && tied.some((touch) => !integer(touch.arrival_index) || !touch.arrival_index)) {
      coverage.ambiguousFirstVisitors++; continue;
    }
    const first = touches[0];
    if (first.received_at < start) { coverage.priorExperimentVisitors++; continue; }
    if (first.received_at >= end) continue;
    const deadline = first.received_at + WINDOW;
    cohort.set(anon, { ...first, deadline, mature: deadline <= asOf,
      crossover: touches.some((touch) => touch.arm !== first.arm && touch.received_at <= deadline), orders: [] });
  }
  const orders = new Map(stripe.payments.map((payment) => [payment.id, payment]));
  for (const payment of orders.values()) {
    if (!payment.id || payment.status !== "succeeded" || !frames(payment).length || payment.currency !== "usd" || !integer(payment.amount_received) || payment.amount_received <= 0) continue;
    coverage.paidFrameOrders++;
    const time = paidAt(payment);
    if (!integer(time) || time < 1) { coverage.missingVerifiedPaidTimeOrders++; continue; }
    if (time > asOf) { coverage.futureOrders++; continue; }
    if (time < start) { coverage.historicalOrders++; continue; }
    if (!payment.anon) { coverage.missingAnonOrders++; continue; }
    const visitor = cohort.get(payment.anon);
    if (!visitor) { coverage.unmatchedOrders++; continue; }
    if (time < visitor.received_at || time > visitor.deadline) { coverage.outsideSevenDayOrders++; continue; }
    visitor.orders.push(payment);
  }
  const arms = ARMS.map((arm) => {
    const visitors = [...cohort.values()].filter((visitor) => visitor.arm === arm);
    const mature = visitors.filter((visitor) => visitor.mature), allOrders = visitors.flatMap((visitor) => visitor.orders);
    const observed = summarizeOrders(allOrders), matureOutcomes = summarizeOrders(mature.flatMap((visitor) => visitor.orders));
    const cents = integer(spend[arm]) ? spend[arm] : null;
    return { arm, arrivals: visitors.length, matureArrivals: mature.length, pendingArrivals: visitors.length - mature.length,
      crossoverVisitors: visitors.filter((visitor) => visitor.crossover).length,
      actualSpendCents: cents, observed, mature7d: { ...matureOutcomes, buyerConversion: ratio(matureOutcomes.buyers, mature.length) },
      observedCostPerFrameOrderCents: cents === null ? null : ratio(cents, observed.orders),
      contributionAfterAdsCents: cents === null || observed.contributionBeforeAdsCents === null ? null : observed.contributionBeforeAdsCents - cents };
  });
  return { experiment: EXPERIMENT, deliveryStart: start, deliveryEndExclusive: end, asOf,
    outcomeWindowSeconds: WINDOW, completeFollowup: asOf >= end + WINDOW, coverage, arms,
    notes: [
      "Arm is the browser's first server-observed arrival for this experiment; later arms are crossovers, not reassignment. Supply the full experiment arrival history, including before delivery start.",
      "Buyers are distinct anonymous browsers, not verified people or necessarily new customers. Orders are distinct succeeded frame-containing PaymentIntents; accessory-only purchases are excluded.",
      "Primary mature7d rates use only visitors with a full seven-day follow-up. Observed orders and CPA include pending visitors and remain provisional until completeFollowup.",
      "productionPaidAt is required. Charge creation or PaymentIntent creation cannot substitute for verified payment success.",
      "Gross merchandise is whole-basket subtotal less voucher, excluding shipping and tax, before refunds. Refund cents are whole-order amounts and cannot be allocated to frame merchandise without line evidence.",
      "Optional contributionCents must be whole-order retained contribution before ads from the ops cost model, including current refunds and estimated or actual shipping. Missing coverage stays null; no implied zero costs.",
      "Spend is actual delivered spend in USD cents per arm, never configured budgets. This report measures attributed outcomes, not causal incremental sales or a statistically proven winner."
    ] };
}
function csv(report) {
  const header = ["arm", "arrivals", "mature_arrivals", "pending_arrivals", "crossovers", "actual_spend_cents", "observed_frame_orders", "observed_buyers", "observed_frame_units", "mature_frame_orders", "mature_buyers", "mature_buyer_conversion", "observed_cpa_cents", "refund_known_orders", "refunded_cents", "contribution_known_orders", "contribution_after_ads_cents"];
  const lines = report.arms.map((arm) => [arm.arm, arm.arrivals, arm.matureArrivals, arm.pendingArrivals, arm.crossoverVisitors, arm.actualSpendCents, arm.observed.orders, arm.observed.buyers, arm.observed.frameUnits, arm.mature7d.orders, arm.mature7d.buyers, arm.mature7d.buyerConversion, arm.observedCostPerFrameOrderCents, arm.observed.refundKnownOrders, arm.observed.refundedCents, arm.observed.contributionKnownOrders, arm.contributionAfterAdsCents]);
  return [header, ...lines].map((row) => row.map((value) => value ?? "").join(",")).join("\n") + "\n";
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) throw new Error("Usage: node tools/report-paid-campaign.mjs input.json output-prefix");
  const report = buildPaidCampaignReport(JSON.parse(readFileSync(input, "utf8")));
  writeFileSync(output + ".json", JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
  writeFileSync(output + ".csv", csv(report), { mode: 0o600 });
  console.log(JSON.stringify({ json: output + ".json", csv: output + ".csv", completeFollowup: report.completeFollowup }));
}

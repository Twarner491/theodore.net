import assert from "node:assert/strict";
import test from "node:test";
import { buildPaidCampaignReport } from "../tools/report-paid-campaign.mjs";
const DAY = 86400, start = 1794355200, end = start + 7 * DAY;
const arrival = (anon, arm, at, id = anon + "_touch") => ({ anon, arm, received_at: at, client_at: at, experiment: "av-meta-nov26-v1", touch_id: id });
const payment = (id, anon, at, extra = {}) => ({ id, anon, productionPaidAt: at, status: "succeeded", currency: "usd", amount_received: 71400,
  items: "avian-visitors|assembled-continuous|1", breakdown: "69900|1500|0|71400", discount: 0, refundedAmount: 0, ...extra });
function report(arrivals, payments, extra = {}) { const asOf = extra.asOf || end + 7 * DAY;
  return buildPaidCampaignReport({ arrivals, stripe: { complete: true, capturedAt: new Date(asOf * 1000).toISOString(), payments }, start, end, asOf, spend: { "reel-a": 30000, species: 30000, photo: 30000 }, ...extra }); }

test("distinct paid frame orders join first server arrival, preserve crossovers, and exclude accessory sales", () => {
  const p = payment("pi_one", "visitor_a", start + DAY, { items: "avian-visitors|assembled-continuous|2;avian-mic|electronics-printed|1" });
  const result = report([arrival("visitor_a", "reel-a", start), arrival("visitor_a", "photo", start + 100, "second"), arrival("visitor_b", "species", start)],
    [p, p, payment("pi_accessory", "visitor_b", start + DAY, { items: "avian-mic|electronics-printed|1" })]);
  assert.equal(result.arms[0].observed.orders, 1); assert.equal(result.arms[0].observed.frameUnits, 2);
  assert.equal(result.arms[0].crossoverVisitors, 1); assert.equal(result.arms[2].observed.orders, 0);
  assert.equal(result.arms[1].observed.orders, 0); assert.equal(result.arms[0].observedCostPerFrameOrderCents, 30000);
});
test("mature rates never treat pending browsers as nonbuyers; delayed last-day purchases mature seven days later", () => {
  const result = report([arrival("a", "photo", start), arrival("b", "photo", end - 1)], [payment("pi_b", "b", end + DAY)], { asOf: end + DAY });
  const photo = result.arms[2];
  assert.equal(photo.arrivals, 2); assert.equal(photo.matureArrivals, 1); assert.equal(photo.pendingArrivals, 1);
  assert.equal(photo.observed.orders, 1); assert.equal(photo.mature7d.orders, 0); assert.equal(photo.mature7d.buyerConversion, 0);
  assert.equal(result.completeFollowup, false);
});
test("first enrollment predating delivery cannot be reset, and out-of-window payments stay excluded", () => {
  const result = report([arrival("old", "photo", start - 100), arrival("old", "species", start + 10, "new"), arrival("a", "reel-a", start)],
    [payment("pi_old", "old", start + DAY), payment("pi_early", "a", start - 1), payment("pi_late", "a", start + 7 * DAY + 1)]);
  assert.equal(result.coverage.priorExperimentVisitors, 1); assert.equal(result.arms[1].arrivals, 0);
  assert.equal(result.coverage.outsideSevenDayOrders, 1); assert.equal(result.coverage.historicalOrders, 1); assert.equal(result.coverage.unmatchedOrders, 1);
});
test("missing verified success time is not replaced by creation time; refund and contribution gaps stay explicit", () => {
  const result = report([arrival("a", "photo", start)], [payment("pi_missing_time", "a", 0, { chargeCreated: start + DAY }),
    payment("pi_refund", "a", start + DAY, { refundedAmount: 71400, contributionCents: -2000 }), payment("pi_unknown", "a", start + DAY, { refundedAmount: null })]);
  assert.equal(result.coverage.missingVerifiedPaidTimeOrders, 1);
  assert.equal(result.arms[2].observed.orders, 2); assert.equal(result.arms[2].observed.refundKnownOrders, 1);
  assert.equal(result.arms[2].observed.refundedCents, null); assert.equal(result.arms[2].observed.contributionKnownOrders, 1);
  assert.equal(result.arms[2].contributionAfterAdsCents, null);
});
test("incomplete or stale Stripe snapshots cannot produce a finished report", () => {
  assert.throws(() => buildPaidCampaignReport({ arrivals: [], stripe: { complete: false, payments: [] }, start, end, asOf: end }), /complete/);
  assert.throws(() => buildPaidCampaignReport({ arrivals: [], stripe: { complete: true, capturedAt: new Date(start * 1000).toISOString(), payments: [] }, start, end, asOf: end }), /cover/);
});

test("same-second cross-arm ties use database insertion order or remain explicitly unassigned", () => {
  const a = arrival("a", "photo", start, "photo_touch"), b = arrival("a", "species", start, "species_touch");
  const ambiguous = report([a, b], []);
  assert.equal(ambiguous.coverage.ambiguousFirstVisitors, 1); assert.equal(ambiguous.arms[2].arrivals, 0);
  const ordered = report([{ ...a, arrival_index: 2 }, { ...b, arrival_index: 1 }], []);
  assert.equal(ordered.arms[1].arrivals, 1); assert.equal(ordered.arms[1].crossoverVisitors, 1);
});

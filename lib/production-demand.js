// Read genuine paid history without copying old orders into the new ledger.
// Calendar sales are observable here; historical stock exposure is not.
const PRODUCT = "avian-visitors";
const SKUS = ["avian-gen3-batch-01", "avian-gen3-batch-02"];
const DAY = 86400;
const WINDOWS = [3, 7, 14, 28];
const VALID_FINITE = `r.status='sold' AND r.provider_outcome='succeeded'
  AND r.provider_event_id GLOB 'evt_*'
  AND typeof(r.provider_event_created_at)='integer'
  AND r.provider_event_created_at BETWEEN r.created_at AND r.sold_at
  AND r.sold_at=r.updated_at AND r.sold_at<=?
  AND l.committed_quantity>0 AND l.committed_quantity=l.held_quantity
  AND l.committed_quantity=l.target_quantity`;

async function rows(db, sql, bindings = []) {
  const result = await db.prepare(sql).bind(...bindings).all();
  if (!result || result.success !== true || !Array.isArray(result.results)) throw new Error("Demand history read failed");
  return result.results;
}
const integer = value => Number.isSafeInteger(value) && value >= 0;

// Same calendar-boundary method as the ops reporting-time helper. Shifting a
// date label is distinct from adding 86400 elapsed seconds across a DST change.
function calendar(timeZone) {
  const dateFormatter = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  const clockFormatter = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  const parts = (formatter, sec) => Object.fromEntries(formatter.formatToParts(new Date(sec * 1000)).map(part => [part.type, part.value]));
  return {
    date(sec) { const p = parts(dateFormatter, sec); return p.year + "-" + p.month + "-" + p.day; },
    shift(date, days) { return new Date(Date.parse(date + "T00:00:00Z") + days * DAY * 1000).toISOString().slice(0, 10); },
    start(date) {
      const target = Date.parse(date + "T00:00:00Z") / 1000;
      let sec = target;
      for (let i = 0; i < 3; i++) {
        const p = parts(clockFormatter, sec);
        const correction = target - Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) / 1000;
        sec += correction;
        if (!correction) break;
      }
      return sec;
    },
  };
}

export async function readProductionDemandHistory(env, { now = Math.floor(Date.now() / 1000), incoming = null, timeZone = "America/Los_Angeles" } = {}) {
  if (!integer(now)) throw new TypeError("Demand history requires an integer current timestamp");
  if (!["UTC", "America/Los_Angeles"].includes(timeZone)) throw new TypeError("Unsupported demand-history time zone");
  if (incoming && (incoming.productId !== PRODUCT || !["stripe", "tiktok"].includes(incoming.provider) ||
      typeof incoming.orderId !== "string" || !/^[A-Za-z0-9._:-]{1,255}$/.test(incoming.orderId) ||
      !Number.isSafeInteger(incoming.quantity) || incoming.quantity < 1 || incoming.quantity > 99 ||
      !integer(incoming.paidAt) || incoming.paidAt > now)) throw new TypeError("Invalid incoming verified production payment");
  const dates = calendar(timeZone), today = dates.date(now), windowEnd = dates.start(today);
  const result = {
    available: false, reason: "storage_unavailable", timeZone, asOf: now,
    windowEnd, exposureKnown: false, legacyCoverage: [], earliestPaidAt: null,
    latestPaidAt: null, totalOrders: null, totalUnits: null, firstPartialDay: null,
    daily: [], windows: {},
  };
  try {
    if (!env || !env.STORE_INVENTORY || typeof env.STORE_INVENTORY.withSession !== "function") return result;
    const db = env.STORE_INVENTORY.withSession("first-primary");
    const coverage = await rows(db, `SELECT b.sku,b.sold_quantity AS sold_units,
      COALESCE(SUM(CASE WHEN r.status='sold' THEN l.committed_quantity ELSE 0 END),0) AS committed_units,
      COALESCE(SUM(CASE WHEN ${VALID_FINITE} THEN l.committed_quantity ELSE 0 END),0) AS dated_units,
      COALESCE(SUM(CASE WHEN r.status='sold' THEN CASE WHEN ${VALID_FINITE} THEN 0 ELSE 1 END ELSE 0 END),0) AS invalid_sold_rows
      FROM store_inventory_batches b
      LEFT JOIN store_inventory_reservation_lines l ON l.sku=b.sku
      LEFT JOIN store_inventory_reservations r ON r.payment_intent_id=l.payment_intent_id
      WHERE b.sku IN (?,?) GROUP BY b.sku,b.sold_quantity ORDER BY b.sku`, [now, now, ...SKUS]);
    result.legacyCoverage = coverage.map(row => ({
      sku: row.sku, soldUnits: row.sold_units, committedUnits: row.committed_units, datedUnits: row.dated_units,
      invalidSoldRows: row.invalid_sold_rows,
      complete: [row.sold_units, row.committed_units, row.dated_units].every(integer) &&
        row.sold_units === row.committed_units && row.sold_units === row.dated_units && row.invalid_sold_rows === 0,
    }));
    if (coverage.length !== SKUS.length || SKUS.some(sku => !coverage.some(row => row.sku === sku)))
      return { ...result, reason: "legacy_history_missing" };
    if (result.legacyCoverage.some(row => !row.complete)) return { ...result, reason: "legacy_history_inconsistent" };
    const [continuous] = await rows(db, `SELECT COUNT(*) AS orders,
      COALESCE(SUM(CASE WHEN provider IN ('stripe','tiktok')
        AND typeof(order_id)='text' AND length(order_id) BETWEEN 1 AND 255
        AND order_id NOT GLOB '*[^A-Za-z0-9._:-]*'
        AND typeof(quantity)='integer' AND quantity BETWEEN 1 AND 99
        AND typeof(paid_at)='integer' AND paid_at BETWEEN 0 AND ? THEN 0 ELSE 1 END),0) AS invalid
      FROM production_paid_orders WHERE product_id=?`, [now, PRODUCT]);
    if (!continuous || !integer(continuous.orders) || continuous.invalid !== 0)
      return { ...result, reason: "paid_history_inconsistent" };
    let addIncoming = !!incoming;
    if (incoming) {
      const prior = await rows(db, "SELECT product_id,quantity FROM production_paid_orders WHERE provider=? AND order_id=?", [incoming.provider, incoming.orderId]);
      if (prior.length && (prior.length !== 1 || prior[0].product_id !== PRODUCT || prior[0].quantity !== incoming.quantity))
        return { ...result, reason: "incoming_payment_conflict" };
      addIncoming = !prior.length;
    }
    const bindings = [now, ...SKUS, PRODUCT];
    const pending = addIncoming ? " UNION ALL SELECT ?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM production_paid_orders WHERE provider=? AND order_id=?)" : "";
    if (addIncoming) bindings.push(incoming.provider, incoming.orderId, incoming.paidAt, incoming.quantity, incoming.provider, incoming.orderId);
    // A mixed payment can contain both legacy finite units and new continuous
    // units. Sum those components, but count its provider/order identity once.
    // Neither aggregate legacy mirrors nor split allocation rows enter here.
    const paidTimes = await rows(db, `WITH legacy AS (
      SELECT 'stripe' AS provider,r.payment_intent_id AS order_id,
        r.provider_event_created_at AS paid_at,SUM(l.committed_quantity) AS quantity
      FROM store_inventory_reservations r
      JOIN store_inventory_reservation_lines l USING(payment_intent_id)
      WHERE ${VALID_FINITE} AND l.sku IN (?,?)
      GROUP BY r.payment_intent_id,r.provider_event_created_at
    ), components AS (
      SELECT provider,order_id,paid_at,quantity FROM legacy
      UNION ALL SELECT provider,order_id,paid_at,quantity FROM production_paid_orders WHERE product_id=?${pending}
    ), orders AS (
      SELECT provider,order_id,MIN(paid_at) AS paid_at,SUM(quantity) AS quantity
      FROM components GROUP BY provider,order_id
    ) SELECT paid_at,COUNT(*) AS orders,SUM(quantity) AS units
      FROM orders GROUP BY paid_at ORDER BY paid_at`, bindings);
    if (!paidTimes.length) return { ...result, reason: "no_paid_history" };
    if (paidTimes.some(row => ![row.paid_at, row.orders, row.units].every(integer) ||
        row.orders < 1 || row.units < row.orders || row.paid_at > now))
      return { ...result, reason: "paid_history_inconsistent" };
    result.earliestPaidAt = paidTimes[0].paid_at;
    result.latestPaidAt = paidTimes[paidTimes.length - 1].paid_at;
    result.totalOrders = paidTimes.reduce((total, row) => total + row.orders, 0);
    result.totalUnits = paidTimes.reduce((total, row) => total + row.units, 0);
    const byDate = new Map();
    for (const paid of paidTimes) {
      const date = dates.date(paid.paid_at), total = byDate.get(date) || { orders: 0, units: 0 };
      total.orders += paid.orders; total.units += paid.units; byDate.set(date, total);
    }
    const firstDate = dates.date(result.earliestPaidAt);
    result.firstPartialDay = { start: dates.start(firstDate), end: dates.start(dates.shift(firstDate, 1)),
      ...byDate.get(firstDate), excludedFromWindows: true };
    // Do not turn dates preceding the first observed sale, or that first
    // partial date, into full zero-sales days. Current calendar day is excluded.
    const firstCompleteDate = dates.shift(firstDate, 1), recentDate = dates.shift(today, -28);
    const startDate = firstCompleteDate > recentDate ? firstCompleteDate : recentDate;
    for (let date = startDate; date < today; date = dates.shift(date, 1)) {
      const paid = byDate.get(date);
      result.daily.push({ start: dates.start(date), end: dates.start(dates.shift(date, 1)), date,
        orders: paid ? paid.orders : 0, units: paid ? paid.units : 0 });
    }
    for (const days of WINDOWS) {
      const start = dates.start(dates.shift(today, -days));
      const selected = result.daily.filter(day => day.start >= start);
      result.windows[days] = { start, end: windowEnd, calendarDays: days, observedDays: selected.length,
        complete: selected.length === days,
        orders: selected.length ? selected.reduce((total, day) => total + day.orders, 0) : null,
        units: selected.length ? selected.reduce((total, day) => total + day.units, 0) : null };
    }
    return { ...result, available: true, reason: null };
  } catch (_) {
    return { ...result, available: false, reason: "storage_unavailable", daily: [], windows: {} };
  }
}

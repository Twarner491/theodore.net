import { sweepExpiredInventory } from "../lib/store-inventory-expiry.js";

// Deploy only as a separately configured scheduled Worker. The Pages project
// intentionally has no cron trigger. A successful Stripe cancel response does
// not release stock here; only the later signed cancellation webhook may do so.
export default {
  async scheduled(controller, env, ctx) {
    const work = sweepExpiredInventory(env, {
      now: Math.floor(controller.scheduledTime / 1000),
      limit: 25,
    }).then((summary) => console.log("inventory expiry sweep:", JSON.stringify(summary)));
    ctx.waitUntil(work);
  },
};


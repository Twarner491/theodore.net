import { dispatchMetaPurchases } from "../lib/meta-purchase.js";

export default {
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(dispatchMetaPurchases(env, { now: Math.floor(controller.scheduledTime / 1000) })
      .then((summary) => console.log("Meta purchase delivery:", JSON.stringify(summary))));
  },
};

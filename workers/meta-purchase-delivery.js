import { dispatchMetaPurchases } from "../lib/meta-purchase.js";

export default {
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(dispatchMetaPurchases(env)
      .then((summary) => console.log("Meta purchase delivery:", JSON.stringify(summary))));
  },
};

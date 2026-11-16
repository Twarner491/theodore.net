import { readFrameOrderLink } from "../../lib/frame-order-link.js";
import { productionIntakePaused } from "../../lib/production-batch-commerce.js";

const reply = (value, status = 200) => Response.json(value, {
  status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
});

export async function onRequestPost({ request, env }) {
  let token;
  try { token = (await request.json()).token; }
  catch (_) { return reply({ error: "Invalid frame order link." }, 400); }
  try {
    const link = await readFrameOrderLink(env, token);
    if (!link) return reply({ error: "This frame order link is invalid or has expired." }, 404);
    if (productionIntakePaused(env)) return reply({ error: "Frame orders are temporarily paused." }, 409);
    return reply(link);
  } catch (_) {
    return reply({ error: "The frame order link could not be checked. Please open it again." }, 503);
  }
}

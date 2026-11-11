import { PRODUCTION_GROUP, productionBatchReady, productionIntakePaused } from "../../lib/production-batch-commerce.js";

const HEADERS = { "content-type": "application/json", "cache-control": "no-store, max-age=0" };
export async function onRequestGet({ request, env }) {
  const group = new URL(request.url).searchParams.get("group") || PRODUCTION_GROUP;
  if (group !== PRODUCTION_GROUP) return new Response(JSON.stringify({ error: "Unknown production group." }), { status: 400, headers: HEADERS });
  try {
    const current = await productionBatchReady(env);
    return new Response(JSON.stringify({ group, ordinal: current.ordinal, remaining: current.remaining, paused: productionIntakePaused(env) }), { headers: HEADERS });
  } catch (_) {
    return new Response(JSON.stringify({ error: "Production availability is temporarily unavailable." }), { status: 503, headers: HEADERS });
  }
}

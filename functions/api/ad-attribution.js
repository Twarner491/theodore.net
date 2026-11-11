import { recordPaidArrival, paidAttributionEnabled } from "../../lib/paid-attribution.js";

const reply = (value, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { "content-type": "application/json", "cache-control": "no-store" },
});
export async function onRequestPost({ request, env }) {
  if (!paidAttributionEnabled(env)) return reply({ recorded: false });
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return reply({ recorded: false }, 403);
  if (request.headers.get("sec-fetch-site") === "cross-site") return reply({ recorded: false }, 403);
  let text, body;
  try { text = await request.text(); if (text.length > 6000) return reply({ recorded: false }, 413); body = JSON.parse(text); }
  catch (_) { return reply({ recorded: false }, 400); }
  try { return reply(await recordPaidArrival(env, body)); }
  catch (_) { return reply({ recorded: false }, 503); }
}

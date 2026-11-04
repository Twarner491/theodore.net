import { submitRecoveryRequest, reviewRecovery, recoveryStatus } from "../../lib/store-recovery.js";

const reply = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json", "cache-control": "no-store", "referrer-policy": "no-referrer" },
});
export async function onRequestPost({ request, env }) {
  try { return reply(await submitRecoveryRequest(env, request)); }
  catch (error) { return reply({ error: error.status ? error.message : "Could not save this request. Please try again." }, error.status || 503); }
}
export async function onRequestGet({ request, env }) {
  try {
    const options = { requestUrl: request.url };
    return reply(await (new URL(request.url).searchParams.get("status") === "1" ? recoveryStatus(env, options) : reviewRecovery(env, options)));
  }
  catch (error) { return reply({ error: error.status ? error.message : "Review unavailable." }, error.status || 503); }
}

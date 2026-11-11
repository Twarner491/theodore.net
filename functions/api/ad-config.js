import { metaMeasurementAvailable } from "../../lib/meta-purchase.js";
import { advertisingOptOut } from "../../lib/paid-attribution.js";

export async function onRequestGet({ request, env }) {
  return new Response(JSON.stringify({ metaMeasurementEnabled: metaMeasurementAvailable(env, request),
    privacyOptOut: advertisingOptOut(request) }), {
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

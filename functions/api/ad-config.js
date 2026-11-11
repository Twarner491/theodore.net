import { metaMeasurementAvailable } from "../../lib/meta-purchase.js";
import { advertisingOptOut } from "../../lib/paid-attribution.js";

export async function onRequestGet({ request, env }) {
  const enabled = metaMeasurementAvailable(env, request);
  const browserEvents = enabled && env.META_PIXEL_ENABLED === "1";
  // Only the public dataset identifier is exposed. Local preview never loads Meta.
  const pixelId = browserEvents && env.META_CAPI_MODE === "live" ? env.META_DATASET_ID : "";
  return new Response(JSON.stringify({ metaMeasurementEnabled: enabled,
    metaBrowserEventsEnabled: browserEvents, metaPixelId: pixelId,
    privacyOptOut: advertisingOptOut(request) }), {
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

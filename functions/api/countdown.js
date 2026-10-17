// GET /api/countdown?id=<product>  (Cloudflare Pages Function)
//
// The live countdown image for email: an animated GIF of the product page's drop countdown,
// rendered per request from the same launchAt the page counts down to (/store-launches.json,
// generated from the product frontmatter by hooks/store_products.py). An email opened at any
// moment shows the time actually left and ticks for a minute in step with the site; after
// launch it shows the open state. Never cached, so each open is current. (Clients that prefetch
// images at delivery, like Apple Mail Privacy Protection, show the time as of delivery.)
import { countdownGif } from "../../lib/countdown-gif.js";

const NO_CACHE = { "cache-control": "no-store, no-cache, must-revalidate, max-age=0", expires: "0", pragma: "no-cache" };

export async function onRequestGet({ request }) {
  const id = new URL(request.url).searchParams.get("id") || "";
  let launches = null;
  try {
    const response = await fetch(new URL("/store-launches.json", request.url));
    if (response.ok) launches = await response.json();
  } catch (e) {}
  const entry = launches && typeof launches === "object" && Object.prototype.hasOwnProperty.call(launches, id) ? launches[id] : null;
  const at = entry && typeof entry.launchAt === "string" ? Date.parse(entry.launchAt) : NaN;
  if (!Number.isFinite(at)) return new Response("Unknown countdown.", { status: 404, headers: { "content-type": "text/plain", ...NO_CACHE } });
  return new Response(await countdownGif(at, Date.now()), { headers: { "content-type": "image/gif", ...NO_CACHE } });
}

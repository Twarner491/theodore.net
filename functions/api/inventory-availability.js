import { readInventoryAvailability } from "../../lib/store-inventory.js";

const HEADERS = {
  "content-type": "application/json",
  "cache-control": "no-store, max-age=0",
};

export async function onRequestGet({ request, env }) {
  let skus = null;
  try {
    const requested = new URL(request.url).searchParams.getAll("sku");
    if (requested.length) skus = requested;
  } catch (error) {
    return new Response(JSON.stringify({ error: "Bad request." }), { status: 400, headers: HEADERS });
  }
  try {
    const rows = await readInventoryAvailability(env, skus);
    return new Response(JSON.stringify({
      inventory: rows.map((row) => ({
        sku: row.sku,
        available: row.available,
        soldOut: row.soldOut,
      })),
    }), { status: 200, headers: HEADERS });
  } catch (error) {
    console.log("inventory availability unavailable:", error && error.code || "unknown");
    return new Response(JSON.stringify({ error: "Availability is temporarily unavailable." }), {
      status: 503, headers: HEADERS,
    });
  }
}


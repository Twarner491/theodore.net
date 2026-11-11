import { readInventoryAvailability } from "../lib/store-inventory.js";
import { PRODUCTION_GROUP, productionBatchReady, productionIntakePaused } from "../lib/production-batch-commerce.js";

const FIELDS = ["id", "title", "description", "availability", "condition", "price",
  "link", "image_link", "brand", "quantity_to_sell_on_facebook", "additional_image_link"];
const HEADERS = {
  "content-type": "text/csv; charset=utf-8",
  "cache-control": "no-store, max-age=0",
  "x-content-type-options": "nosniff",
};
const csvCell = (value) => {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
};

export async function onRequestGet({ request, env }) {
  let items;
  try {
    const source = await env.ASSETS.fetch(new Request(new URL("/meta-catalog-source.json", request.url)));
    if (!source.ok) throw new Error("Catalog metadata unavailable");
    items = await source.json();
    if (!Array.isArray(items) || !items.length || items.some((item) => !item || !item.id)) {
      throw new Error("Invalid catalog metadata");
    }
  } catch (error) {
    console.log("Meta catalog metadata unavailable");
    return new Response("Catalog is temporarily unavailable.", { status: 503, headers: HEADERS });
  }

  const skus = [...new Set(items.map((item) => item.inventorySku).filter(Boolean))];
  let stock = new Map();
  if (skus.length) {
    try {
      stock = new Map((await readInventoryAvailability(env, skus)).map((row) => [row.sku, row.available]));
    } catch (error) {
      // A failed inventory read must clear Meta stock, never retain a stale buyable count.
      console.log("Meta catalog inventory unavailable:", error && error.code || "unknown");
    }
  }

  let productionOpen = false;
  if (items.some((item) => item.productionBatchGroup === PRODUCTION_GROUP) && !productionIntakePaused(env)) {
    try {
      await productionBatchReady(env);
      productionOpen = true;
    } catch (_) {
      // Pause or missing ledger authority must clear channel availability too.
      console.log("Meta catalog production availability unavailable");
    }
  }

  const now = Date.now();
  const rows = items.map((item) => {
    const row = { ...item };
    const launched = !item.launchAt || Date.parse(item.launchAt) <= now;
    const productionAvailable = !item.productionBatchGroup ||
      (item.productionBatchGroup === PRODUCTION_GROUP && !item.inventorySku && productionOpen);
    const available = launched && item.availability !== "out of stock" && productionAvailable;
    if (item.inventorySku) {
      row.quantity_to_sell_on_facebook = available ? stock.get(item.inventorySku) ?? 0 : 0;
      row.availability = row.quantity_to_sell_on_facebook > 0 ? item.availability : "out of stock";
    } else if (!available) {
      row.availability = "out of stock";
      row.quantity_to_sell_on_facebook = 0;
    }
    return FIELDS.map((field) => csvCell(row[field])).join(",");
  });
  return new Response([FIELDS.join(","), ...rows, ""].join("\r\n"), { headers: HEADERS });
}

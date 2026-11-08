import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { onRequestGet } from "../functions/meta-catalog.csv.js";

function setup() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../migrations/0001_store_inventory.sql", import.meta.url), "utf8"));
  db.exec(`INSERT INTO store_inventory_batches VALUES ('avian-gen3-batch-02', 'Batch 2', 30, 0, 25, 1, 1)`);
  const items = [
    { id: "avian-visitors", title: "Avian Visitors", description: 'Birds, "nearby"', availability: "in stock", price: "699.00 USD", inventorySku: "avian-gen3-batch-02" },
    { id: "polargraph-electronics", availability: "out of stock", quantity_to_sell_on_facebook: 0 },
    { id: "avian-mic-electronics", availability: "in stock", quantity_to_sell_on_facebook: 25 },
  ];
  const env = {
    ASSETS: { async fetch(request) {
      assert.equal(new URL(request.url).pathname, "/meta-catalog-source.json");
      return Response.json(items);
    } },
    STORE_INVENTORY: {
      batch() { throw new Error("Catalog must never write inventory"); },
      withSession(constraint) { assert.equal(constraint, "first-primary"); return this; },
      prepare(sql) { return { bind(...args) { return {
        async all() { return { success: true, results: db.prepare(sql).all(...args), meta: {} }; },
      }; } }; },
    },
  };
  return { db, items, env, request: new Request("https://theodore.net/meta-catalog.csv") };
}

test("feed uses available stock after sales and reservations, then restores the same id for the next batch", async () => {
  const ctx = setup();
  try {
    let response = await onRequestGet(ctx);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control"), /no-store/);
    assert.match(await response.text(), /avian-visitors,Avian Visitors,"Birds, ""nearby""",in stock,[^\r\n]*,5,/);
    ctx.db.exec("UPDATE store_inventory_batches SET reserved_quantity = 1 WHERE sku = 'avian-gen3-batch-02'");
    assert.match(await (await onRequestGet(ctx)).text(), /avian-visitors,[^\r\n]*,4,/);
    ctx.db.exec("UPDATE store_inventory_batches SET reserved_quantity = 0, sold_quantity = 30 WHERE sku = 'avian-gen3-batch-02'");
    assert.match(await (await onRequestGet(ctx)).text(), /avian-visitors,[^\r\n]*out of stock[^\r\n]*,0,/);
    ctx.db.exec("INSERT INTO store_inventory_batches VALUES ('avian-gen3-batch-03', 'Batch 3', 20, 0, 0, 1, 1)");
    ctx.items[0].inventorySku = "avian-gen3-batch-03";
    assert.match(await (await onRequestGet(ctx)).text(), /avian-visitors,[^\r\n]*in stock[^\r\n]*,20,/);
  } finally { ctx.db.close(); }
});

test("inventory outages clear finite stock while keeping ordinary and sold-out products accurate", async () => {
  const ctx = setup();
  try {
    delete ctx.env.STORE_INVENTORY;
    const text = await (await onRequestGet(ctx)).text();
    assert.match(text, /avian-visitors,[^\r\n]*out of stock[^\r\n]*,0,/);
    assert.match(text, /polargraph-electronics,[^\r\n]*out of stock[^\r\n]*,0,/);
    assert.match(text, /avian-mic-electronics,[^\r\n]*in stock[^\r\n]*,25,/);
  } finally { ctx.db.close(); }
});

test("future launches and explicit sold-out status cannot be reopened by positive inventory", async () => {
  const ctx = setup();
  try {
    ctx.items[0].launchAt = "2999-01-01T00:00:00Z";
    assert.match(await (await onRequestGet(ctx)).text(), /avian-visitors,[^\r\n]*out of stock[^\r\n]*,0,/);
    delete ctx.items[0].launchAt;
    ctx.items[0].availability = "out of stock";
    assert.match(await (await onRequestGet(ctx)).text(), /avian-visitors,[^\r\n]*out of stock[^\r\n]*,0,/);
  } finally { ctx.db.close(); }
});

test("missing build metadata fails the upload instead of returning an empty replacement catalog", async () => {
  const ctx = setup();
  try {
    ctx.env.ASSETS.fetch = async () => new Response("missing", { status: 404 });
    assert.equal((await onRequestGet(ctx)).status, 503);
  } finally { ctx.db.close(); }
});

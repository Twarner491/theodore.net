import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { onRequestGet } from "../functions/chatgpt-catalog.csv.js";

function item(id, fields = {}) {
  return {
    id, title: id, description: 'A frame with birds, "nearby".',
    price: "699.00 USD", link: "https://theodore.net/store/avian-visitors/",
    brand: "theodore.net", image_link: "https://theodore.net/frame.png",
    condition: "new", availability: "in stock", ...fields,
  };
}

function context(items, env = {}) {
  return {
    request: new Request("https://theodore.net/chatgpt-catalog.csv"),
    env: {
      ASSETS: { async fetch(request) {
        assert.equal(new URL(request.url).pathname, "/meta-catalog-source.json");
        return Response.json(items);
      } },
      ...env,
    },
  };
}

test("discovery catalog uses stable variant URLs, correct brands and OpenAI fields", async () => {
  const response = await onRequestGet(context([
    item("avian-visitors", { group: "avian-visitors" }),
    item("pen-base", { group: "micron-pens-9", variantLabel: "9-pack", discoveryBrand: "Sakura",
      link: "https://theodore.net/store/micron-pens-9/?variant=default", availability: "out of stock" }),
    item("pen-mounts", { group: "micron-pens-9", variantLabel: "+ 9 Mounts & Caps",
      discoveryBrand: "Sakura", link: "https://theodore.net/store/micron-pens-9/?variant=with-mounts",
      availability: "available for order" }),
    item("future", { availability: "preorder", launchAt: "2999-01-01T00:00:00Z" }),
    item("preorder", { availability: "preorder" }),
  ]));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /no-store/);
  const [header, frame, pens, mounts, future, preorder] = (await response.text()).split("\r\n");
  assert.match(header, /^item_id,title,description,url,brand,seller_name,image_url,availability,price,/);
  assert.match(frame, /"A frame with birds, ""nearby""\.",https:\/\/theodore\.net\/store\/avian-visitors\/,theodore\.net,Things by Theodore,[^,]+,in_stock,699\.00 USD/);
  assert.match(pens, /\?variant=default,Sakura,Things by Theodore,[^,]+,out_of_stock,.*micron-pens-9,true,"\{""Package"":""9-pack""\}"/);
  assert.match(mounts, /\?variant=with-mounts,Sakura,Things by Theodore,[^,]+,backorder,.*micron-pens-9,true/);
  assert.match(future, /,out_of_stock,.*false,false,false$/);
  assert.match(preorder, /,pre_order,.*true,false,false$/);
  assert.doesNotMatch(header, /inventorySku|quantity_to_sell_on_facebook|productionBatchGroup/);
});

test("sellout and production pause update availability without changing product identity", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    for (const migration of ["0001_store_inventory.sql", "0007_production_batches.sql"]) {
      db.exec(readFileSync(new URL("../migrations/" + migration, import.meta.url), "utf8"));
    }
    db.exec(`INSERT INTO store_inventory_batches VALUES ('finite', 'Limited', 4, 2, 1, 1, 1);
      INSERT INTO production_batch_state (product_id,current_ordinal,observed_from,created_at)
      VALUES ('avian-visitors',3,1794348000,1794348000);
      INSERT INTO production_batches (product_id,ordinal,capacity,committed_quantity,policy_version,policy_evidence,opened_at)
      VALUES ('avian-visitors',3,30,29,'paid-demand-v1','{"privateEvidence":true}',1794348000)`);
    const env = {
      STORE_INVENTORY: {
        batch() { throw new Error("Catalog must never write inventory"); },
        withSession(constraint) { assert.equal(constraint, "first-primary"); return this; },
        prepare(sql) { return { bind(...args) { return {
          async all() { return { success: true, results: db.prepare(sql).all(...args), meta: {} }; },
        }; } }; },
      },
    };
    const ctx = context([
      item("finite-item", { inventorySku: "finite" }),
      item("avian-visitors", { productionBatchGroup: "avian-visitors" }),
      item("ordinary"),
    ], env);
    let csv = await (await onRequestGet(ctx)).text();
    assert.match(csv, /^finite-item,.*?,in_stock,/m);
    assert.match(csv, /^avian-visitors,.*?,in_stock,/m);
    assert.doesNotMatch(csv, /privateEvidence|paid-demand-v1/);
    db.exec("UPDATE store_inventory_batches SET sold_quantity = 2 WHERE sku = 'finite'");
    ctx.env.PRODUCTION_BATCH_PAUSED = "1";
    csv = await (await onRequestGet(ctx)).text();
    assert.match(csv, /^finite-item,.*?,out_of_stock,/m);
    assert.match(csv, /^avian-visitors,.*?,out_of_stock,/m);
    assert.match(csv, /^ordinary,.*?,in_stock,/m);
  } finally {
    db.close();
  }
});

test("broken source or missing required product fields fail the snapshot", async () => {
  for (const items of [[], [item("incomplete", { image_link: "" })]]) {
    const response = await onRequestGet(context(items));
    assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /^item_id,/);
  }
});

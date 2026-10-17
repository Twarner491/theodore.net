#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { verifyFreshInventoryProvisioning } from "../lib/store-inventory.js";

class ExportStatement {
  constructor(owner, sql, bindings = []) { this.owner = owner; this.sql = sql; this.bindings = bindings; }
  bind(...bindings) { return new ExportStatement(this.owner, this.sql, bindings); }
  all() {
    return {
      success: true,
      results: this.owner.sqlite.prepare(this.sql).all(...this.bindings),
      meta: { changes: 0 },
    };
  }
}

class ExportedD1 {
  constructor(sql) {
    this.sqlite = new DatabaseSync(":memory:");
    this.sqlite.exec(sql);
  }
  prepare(sql) { return new ExportStatement(this, sql); }
  withSession(constraint) {
    if (constraint !== "first-primary") throw new Error("unexpected D1 session constraint");
    return this;
  }
  async batch() { throw new Error("the provisioning verifier must remain read only"); }
  close() { this.sqlite.close(); }
}

const exportPath = process.argv[2];
if (!exportPath || process.argv.length !== 3) {
  console.error("usage: node tools/verify-store-inventory-export.mjs <wrangler-d1-export.sql>");
  process.exitCode = 2;
} else {
  const database = new ExportedD1(readFileSync(exportPath, "utf8"));
  try {
    const result = await verifyFreshInventoryProvisioning({ STORE_INVENTORY: database });
    console.log(JSON.stringify(result));
  } finally {
    database.close();
  }
}

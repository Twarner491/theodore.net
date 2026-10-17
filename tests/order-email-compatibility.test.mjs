import { test } from "node:test";
import assert from "node:assert/strict";

import { buildOrder } from "../lib/emails.js";


test("historical Avian DIY order metadata resolves against the split kit catalog", () => {
  const catalog = {
    "avian-visitors": {
      title: "Avian Visitors",
      variants: {
        assembled: { label: "Assembled", priceUsd: 700 },
      },
    },
    "avian-visitors-kit": {
      title: "Avian Visitors Kit",
      variants: {
        electronics: { label: "Electronics Kit", priceUsd: 450 },
        "electronics-printed": { label: "+ Frame & Parts", priceUsd: 520 },
      },
    },
  };
  const order = buildOrder({
    id: "pi_legacy",
    amount: 212000,
    metadata: {
      items: "avian-visitors|electronics|2;avian-visitors|electronics-printed|1;avian-visitors|assembled|1",
    },
  }, catalog);

  assert.deepEqual(order.items, [
    {
      id: "avian-visitors-kit",
      build: "electronics",
      qty: 2,
      title: "Avian Visitors Kit",
      label: "Electronics Kit",
      lineTotal: 90000,
    },
    {
      id: "avian-visitors-kit",
      build: "electronics-printed",
      qty: 1,
      title: "Avian Visitors Kit",
      label: "+ Frame & Parts",
      lineTotal: 52000,
    },
    {
      id: "avian-visitors",
      build: "assembled",
      qty: 1,
      title: "Avian Visitors",
      label: "Assembled",
      lineTotal: 70000,
    },
  ]);
});

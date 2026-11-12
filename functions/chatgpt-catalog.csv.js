import { catalogCsv, catalogUnavailable, readChannelCatalog } from "../lib/channel-catalog.js";

const REQUIRED = ["item_id", "title", "description", "url", "brand", "seller_name", "image_url", "availability", "price"];
const FIELDS = [...REQUIRED, "condition", "additional_image_urls", "seller_url", "return_policy",
  "group_id", "listing_has_variations", "variant_dict", "is_eligible_search", "is_eligible_checkout", "is_ads_eligible"];
const AVAILABILITY = new Map([
  ["in stock", "in_stock"], ["out of stock", "out_of_stock"],
  ["available for order", "backorder"], ["preorder", "pre_order"],
]);

export async function onRequestGet(context) {
  const items = await readChannelCatalog(context);
  if (!items) return catalogUnavailable();

  const groupSizes = new Map();
  for (const { group } of items) {
    if (group) groupSizes.set(group, (groupSizes.get(group) ?? 0) + 1);
  }

  const rows = items.map((item) => {
    const grouped = groupSizes.get(item.group) > 1;
    return {
      item_id: item.id,
      title: item.title,
      description: item.discoveryDescription || item.description,
      url: item.link,
      brand: item.discoveryBrand || item.brand,
      seller_name: "Things by Theodore",
      image_url: item.image_link,
      availability: AVAILABILITY.get(item.availability) ?? "unknown",
      price: item.price,
      condition: item.condition,
      additional_image_urls: item.additional_image_link,
      seller_url: "https://theodore.net/store/",
      return_policy: "https://theodore.net/returns/",
      group_id: grouped ? item.group : "",
      listing_has_variations: grouped,
      variant_dict: grouped ? JSON.stringify({ Package: item.variantLabel || item.variantId }) : "",
      is_eligible_search: item.launched,
      is_eligible_checkout: false,
      is_ads_eligible: false,
    };
  });

  if (new Set(rows.map((row) => row.item_id)).size !== rows.length ||
      rows.some((row) => REQUIRED.some((field) => !String(row[field] ?? "").trim()))) {
    console.log("ChatGPT catalog has duplicate IDs or missing required fields");
    return catalogUnavailable();
  }
  return catalogCsv(FIELDS, rows);
}

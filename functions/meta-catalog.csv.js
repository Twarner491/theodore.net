import { catalogCsv, catalogUnavailable, readChannelCatalog } from "../lib/channel-catalog.js";

const FIELDS = ["id", "title", "description", "availability", "condition", "price",
  "link", "image_link", "brand", "quantity_to_sell_on_facebook", "additional_image_link"];

export async function onRequestGet(context) {
  const items = await readChannelCatalog(context);
  return items ? catalogCsv(FIELDS, items) : catalogUnavailable();
}

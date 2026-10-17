export const CONTIGUOUS_US_GROUND = "contiguous-us-ground";

const CONTIGUOUS_STATES = new Set([
  "AL", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "ID", "IL",
  "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO",
  "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR",
  "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI",
  "WY",
]);

// Structural checks do not prove carrier deliverability. Authoritative carrier
// validation remains a paid-sale launch gate for products using this profile.
const NONCONTIGUOUS_OR_MILITARY_ZIP3 = /^(?:00[6-9]|09[0-8]|340|96[2-9]|99[5-9])$/;
const CONTROL = /[\u0000-\u001f\u007f]/;

function normalizedText(value, max) {
  if (typeof value !== "string") return null;
  const text = value.normalize("NFKC").trim().replace(/\s+/g, " ");
  return text && text.length <= max && !CONTROL.test(text) ? text : null;
}

function prohibitedDeliveryText(value) {
  const text = String(value || "").normalize("NFKC").toUpperCase();
  const words = text.replace(/[^A-Z0-9#]+/g, " ").trim().replace(/\s+/g, " ");
  const compact = text.replace(/[^A-Z0-9]+/g, "");
  return /\bGENERAL\s+DELIVERY\b/.test(words) ||
    /\bPOST(?:AL)?\s+OFFICE(?:\s+(?:BOX|NO|NUMBER|#))?\b/.test(words) ||
    /(?:^|\s)(?:P\s+O|PO)\s+(?:BOX|BX|B|NO|NUMBER|#)(?:\s|\d|$)/.test(words) ||
    /(?:^|\D)(?:POBOX|POBX|POB|PONUMBER|PONO|POSTOFFICEBOX|PO)(?:\d|$)/.test(compact);
}

export function trustedShippingProfile(variant) {
  if (!variant || !Object.prototype.hasOwnProperty.call(variant, "shippingProfile")) return "";
  return variant.shippingProfile === CONTIGUOUS_US_GROUND ? CONTIGUOUS_US_GROUND : null;
}

export function strictestShippingProfile(profiles) {
  let result = "";
  for (const profile of profiles) {
    if (profile === null || (profile !== "" && profile !== CONTIGUOUS_US_GROUND)) return null;
    if (profile === CONTIGUOUS_US_GROUND) result = profile;
  }
  return result;
}

export function canonicalShipping(shipping) {
  const source = shipping && typeof shipping === "object" ? shipping : null;
  const address = source && source.address && typeof source.address === "object" ? source.address : source;
  if (!address || typeof address !== "object") return { error: "shipping_address_required" };

  const name = normalizedText(source && source.address ? source.name : "Shipping recipient", 200);
  const line1 = normalizedText(address.line1, 200);
  const line2 = address.line2 == null || address.line2 === "" ? "" : normalizedText(address.line2, 200);
  const city = normalizedText(address.city, 100);
  const state = normalizedText(address.state, 20);
  const postal = normalizedText(address.postal_code, 20);
  const country = normalizedText(address.country, 2);
  if (!name || !line1 || line2 === null || !city || !state || !postal || !country) {
    return { error: "shipping_address_incomplete" };
  }

  const canonical = {
    name: name.toUpperCase(), line1: line1.toUpperCase(), line2: line2.toUpperCase(),
    city: city.toUpperCase(), state: state.toUpperCase(), postal_code: postal.toUpperCase(),
    country: country.toUpperCase(),
  };
  if (Object.values(canonical).some(prohibitedDeliveryText)) return { error: "shipping_po_box_not_allowed" };
  if (canonical.country !== "US") return { error: "shipping_country_not_allowed" };
  if (!CONTIGUOUS_STATES.has(canonical.state)) return { error: "shipping_region_not_allowed" };
  if (!/^\d{5}(?:-\d{4})?$/.test(canonical.postal_code)) return { error: "shipping_address_incomplete" };
  if (NONCONTIGUOUS_OR_MILITARY_ZIP3.test(canonical.postal_code.slice(0, 3))) {
    return { error: "shipping_region_not_allowed" };
  }
  return { canonical };
}

export function shippingDestinationError(profile, shipping) {
  if (!profile) return "";
  if (profile !== CONTIGUOUS_US_GROUND) return "shipping_profile_invalid";
  return canonicalShipping(shipping).error || "";
}

export function canonicalShippingJson(shipping) {
  const result = canonicalShipping(shipping);
  return result.error ? null : JSON.stringify(result.canonical);
}

export async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function shippingDestinationMessage(code) {
  if (code === "shipping_po_box_not_allowed") {
    return "This item cannot be shipped to a PO box or general-delivery address. Enter a street address.";
  }
  if (code === "shipping_country_not_allowed" || code === "shipping_region_not_allowed") {
    return "This item ships only by ground within the contiguous US.";
  }
  if (code === "shipping_address_required" || code === "shipping_address_incomplete") {
    return "Enter a complete contiguous-US street address.";
  }
  return "This item's shipping profile is unavailable.";
}

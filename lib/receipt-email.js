export function receiptEmail(value) {
  const email = typeof value === "string" ? value.trim() : "";
  const [local, domain, extra] = email.split("@");
  const domainLabel = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
  if (email.length > 200 || extra !== undefined || !domain?.includes(".") ||
      !domain.split(".").every((label) => domainLabel.test(label)) ||
      !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}$/i.test(local) ||
      local.startsWith(".") || local.endsWith(".") || local.includes("..")) return "";
  return email;
}

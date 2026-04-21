export function normalizeShopifyId(
  rawId: string | number | null | undefined,
): string | null {
  if (rawId === null || rawId === undefined) return null;

  const value = String(rawId);
  if (!value.includes("/")) return value;

  const parts = value.split("/");
  return parts[parts.length - 1] || value;
}


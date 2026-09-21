export const QUOTA_V1_MAX_ENTRIES = 100;
const MAX_NAME_CODE_POINTS = 80;
const MAX_RIGHT_CODE_POINTS = 160;

export function clampCodePoints(value, max) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const points = Array.from(text);
  return points.length > max ? points.slice(0, max).join("") : text;
}

export function toIsoTimestamp(value) {
  if (value === null || value === undefined || value === "") return undefined;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
}

export function quotaPercentRemaining(quota) {
  const direct = Number(quota?.remainingPercentage);
  if (Number.isFinite(direct)) return direct;

  const total = Number(quota?.total);
  if (!Number.isFinite(total) || total <= 0) return undefined;

  const remaining = quota?.remaining !== undefined && quota?.remaining !== null
    ? Number(quota.remaining)
    : total - Number(quota?.used);
  if (!Number.isFinite(remaining)) return undefined;
  return (remaining / total) * 100;
}

function displayName(connection) {
  return connection?.email || connection?.name || connection?.displayName || connection?.provider || "connection";
}

export function quotaV1Entry(connection, key, quota) {
  const percent = quotaPercentRemaining(quota);
  if (percent === undefined) return null;

  const name = clampCodePoints(
    `${displayName(connection)} ${quota?.displayName || key}`,
    MAX_NAME_CODE_POINTS,
  );
  if (!name) return null;

  const entry = {
    kind: "percent",
    resultType: "quota",
    name,
    label: clampCodePoints(connection?.provider, MAX_NAME_CODE_POINTS),
    percentRemaining: Math.max(0, Math.min(100, percent)),
  };

  const resetTimeIso = toIsoTimestamp(quota?.resetAt);
  if (resetTimeIso) entry.resetTimeIso = resetTimeIso;

  const used = Number(quota?.used);
  const total = Number(quota?.total);
  if (Number.isFinite(used) && Number.isFinite(total) && total > 0) {
    entry.right = clampCodePoints(`${used}/${total}`, MAX_RIGHT_CODE_POINTS);
  }

  return entry;
}

export function buildQuotaV1Entries(results) {
  const entries = [];
  for (const result of results ?? []) {
    const quotas = result?.usage?.quotas;
    if (!quotas || typeof quotas !== "object") continue;
    for (const [key, quota] of Object.entries(quotas)) {
      const entry = quotaV1Entry(result.connection, key, quota);
      if (!entry) continue;
      if (entries.length >= QUOTA_V1_MAX_ENTRIES) return entries;
      entries.push(entry);
    }
  }
  return entries;
}

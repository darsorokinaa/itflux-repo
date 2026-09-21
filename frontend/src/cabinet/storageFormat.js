const KB = 1024;
const MB = KB * 1024;
const GB = MB * 1024;

function ruNumber(value, maxDecimals) {
  if (!Number.isFinite(value)) return "0";
  if (maxDecimals <= 0) return String(Math.round(value));
  const text = value.toFixed(maxDecimals).replace(/\.?0+$/, "");
  return text.replace(".", ",");
}

export function formatStorageBytes(n) {
  const bytes = Math.max(0, Number(n) || 0);
  if (bytes < MB) {
    if (bytes < KB) return `${Math.round(bytes)} Б`;
    const kb = bytes / KB;
    return `${ruNumber(kb, kb >= 10 ? 0 : 1)} КБ`;
  }
  if (bytes < GB) {
    const mb = bytes / MB;
    const decimals = mb >= 100 || Math.abs(mb - Math.round(mb)) < 0.05 ? 0 : 1;
    return `${ruNumber(mb, decimals)} МБ`;
  }
  const gb = bytes / GB;
  return `${ruNumber(gb, gb >= 10 ? 1 : 2)} ГБ`;
}

export function formatUsedOfLimit(used, limit) {
  const usedLabel = formatStorageBytes(used);
  const limitLabel = formatStorageBytes(limit);
  const usedUnit = usedLabel.split(" ").pop();
  const limitUnit = limitLabel.split(" ").pop();
  if (usedUnit === limitUnit) {
    return `${usedLabel.slice(0, usedLabel.lastIndexOf(" "))} из ${limitLabel}`;
  }
  return `${usedLabel} из ${limitLabel}`;
}

export function quotaExceededMessage(quota) {
  const used = quota?.storage_used_bytes ?? quota?.used_bytes ?? 0;
  const limit = quota?.storage_limit_bytes ?? quota?.limit_bytes ?? 0;
  return `Недостаточно места в хранилище. Использовано ${formatUsedOfLimit(used, limit)}.`;
}

export function isQuotaExceededError(err) {
  return err?.code === "QUOTA_EXCEEDED" || err?.data?.code === "QUOTA_EXCEEDED";
}

export function quotaPayloadFromError(err, fallbackQuota) {
  const data = err?.data && typeof err.data === "object" ? err.data : {};
  return {
    ...fallbackQuota,
    ...data,
    storage_used_bytes: data.storage_used_bytes ?? data.used_bytes ?? fallbackQuota?.storage_used_bytes ?? fallbackQuota?.used_bytes,
    storage_limit_bytes: data.storage_limit_bytes ?? data.limit_bytes ?? fallbackQuota?.storage_limit_bytes ?? fallbackQuota?.limit_bytes,
    can_upgrade: Boolean(data.can_upgrade ?? fallbackQuota?.can_upgrade),
  };
}

export function formatUsageItemFrac(item) {
  const used = item?.used ?? 0;
  if (item?.unlimited) {
    return `${used} / ∞`;
  }
  const usedBytes = item?.storage_used_bytes ?? item?.used_bytes;
  const limitBytes = item?.storage_limit_bytes ?? item?.limit_bytes;
  if (item?.key === "storage" || (usedBytes != null && limitBytes != null && item?.unit === "MB")) {
    if (usedBytes != null && limitBytes != null) {
      return `${formatStorageBytes(usedBytes)} / ${formatStorageBytes(limitBytes)}`;
    }
  }
  const limit = item?.limit ?? 0;
  const unit = item?.unit === "MB" ? " МБ" : "";
  return `${used} / ${limit}${unit}`;
}

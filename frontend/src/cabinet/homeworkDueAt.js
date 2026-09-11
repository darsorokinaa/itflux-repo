export function toDateTimeLocalValue(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const h = String(d.getHours()).padStart(2, "0");
    const min = String(d.getMinutes()).padStart(2, "0");
    return `${y}-${m}-${day}T${h}:${min}`;
  } catch {
    return "";
  }
}

export function datetimeLocalToIso(localValue) {
  if (!localValue) return null;
  const match = String(localValue).trim().match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/,
  );
  if (match) {
    const date = new Date(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
      Number(match[6] || 0),
      Number(String(match[7] || "0").padEnd(3, "0")),
    );
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  const parsed = new Date(localValue);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

export function readDatetimeLocalInput(form, name = "due_at") {
  if (!form || typeof form.querySelector !== "function") return null;
  const input = form.querySelector(`input[name="${name}"]`);
  return input ? input.value : null;
}


function padMs(raw) {
  return String(raw || "0").slice(0, 3).padEnd(3, "0");
}

function normalizeTimezoneOffset(value) {
  return value.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
}

export function parseBackendDateTime(value) {
  if (value == null || value === "") return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === "number") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  if (typeof value === "string") {
    const normalized = value.trim().replace(" ", "T");
    const m = normalized.match(
      /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,6}))?(?:Z|[+-]\d{2}:?\d{2})?$/
    );

    if (m) {
      const hasExplicitTimezone = /(Z|[+-]\d{2}:?\d{2})$/i.test(normalized);

      if (hasExplicitTimezone) {
        const withNormalizedOffset = normalizeTimezoneOffset(normalized);
        const tzAware = new Date(withNormalizedOffset);
        return Number.isNaN(tzAware.getTime()) ? null : tzAware;
      }

      const year = Number(m[1]);
      const month = Number(m[2]) - 1;
      const day = Number(m[3]);
      const hour = Number(m[4]);
      const minute = Number(m[5]);
      const second = Number(m[6] || 0);
      const millisecond = Number(padMs(m[7]));
      const d = new Date(year, month, day, hour, minute, second, millisecond);
      return Number.isNaN(d.getTime()) ? null : d;
    }

    const fallback = new Date(normalized);
    return Number.isNaN(fallback.getTime()) ? null : fallback;
  }

  return null;
}

export function formatBackendDateTime(
  value,
  {
    locale = "en-US",
    options = { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" },
    fallback = "Unavailable",
  } = {}
) {
  const d = parseBackendDateTime(value);
  if (!d) return fallback;
  return d.toLocaleString(locale, options);
}

export function formatBackendDate(
  value,
  {
    locale = "en-US",
    options = { year: "numeric", month: "2-digit", day: "2-digit" },
    fallback = "Unavailable",
  } = {}
) {
  const d = parseBackendDateTime(value);
  if (!d) return fallback;
  return d.toLocaleDateString(locale, options);
}

export function formatBackendTime(
  value,
  {
    locale = "en-US",
    options = { hour: "2-digit", minute: "2-digit" },
    fallback = "Unavailable",
  } = {}
) {
  const d = parseBackendDateTime(value);
  if (!d) return fallback;
  return d.toLocaleTimeString(locale, options);
}

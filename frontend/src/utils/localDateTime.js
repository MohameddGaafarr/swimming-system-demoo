/**
 * Local calendar date as YYYY-MM-DD (no UTC shift).
 * Use this instead of Date#toISOString().slice(0, 10) for "today" and UI dates.
 */
export function formatLocalDateYYYYMMDD(dateInput) {
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (Number.isNaN(d.getTime())) return "";

  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");

  return `${y}-${m}-${day}`;
}

/**
 * Normalize time strings from schedule or <input type="time"> to HH:mm.
 * Accepts e.g. "9:00", "09:00", "09:00:00".
 */
export function normalizeTimeHHMM(value) {
  const s = String(value ?? "").trim();
  if (!s) return null;

  const parts = s.split(":");
  if (parts.length < 2) return null;

  const h = Number(parts[0]);
  const min = Number(parts[1]);

  if (
    !Number.isFinite(h) ||
    !Number.isFinite(min) ||
    h < 0 ||
    h > 23 ||
    min < 0 ||
    min > 59
  ) {
    return null;
  }

  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

export function parseTimeToMinutes(value) {
  const n = normalizeTimeHHMM(value);
  if (!n) return null;

  const [h, m] = n.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Convert HH:mm to 12-hour format with AM/PM
 * Examples:
 * 00:57 -> 12:57 AM
 * 13:05 -> 1:05 PM
 * 17:30 -> 5:30 PM
 */
export function formatTime12Hour(value) {
  const normalized = normalizeTimeHHMM(value);
  if (!normalized) return "—";

  const [hours, minutes] = normalized.split(":").map(Number);

  const suffix = hours >= 12 ? "PM" : "AM";
  const displayHour = hours % 12 || 12;

  return `${displayHour}:${String(minutes).padStart(2, "0")} ${suffix}`;
}
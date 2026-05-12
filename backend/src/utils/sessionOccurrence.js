import { SESSION_DAYS } from "../models/Session.js";
import { normalizeScheduleTime, parseTimeToMinutes } from "./scheduleTime.js";

export function isValidDateOnly(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? "").trim());
}

export function parseDateOnlyToLocalDate(dateStr) {
  if (!isValidDateOnly(dateStr)) return null;
  const [year, month, day] = String(dateStr).split("-").map(Number);
  const date = new Date(year, month - 1, day);
  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

export function dayNameFromDate(date) {
  return SESSION_DAYS[date.getDay()];
}

export function getNextDay(day) {
  const idx = SESSION_DAYS.indexOf(day);
  if (idx < 0) return null;
  return SESSION_DAYS[(idx + 1) % 7];
}

/**
 * Resolve which weekly schedule slot a calendar date + normalized times belong to.
 * Mirrors coach attendance occurrence matching (including midnight-crossing slots).
 */
export function resolveScheduleOccurrence({ schedule, parsedDate, startNorm, endNorm }) {
  const occurrenceDay = dayNameFromDate(parsedDate);
  const slots = Array.isArray(schedule) ? schedule : [];

  const matchedSlot =
    slots.find((slot) => {
      if (!slot || String(slot.day).trim() !== occurrenceDay) return false;
      const slotStart = normalizeScheduleTime(slot.startTime);
      const slotEnd = normalizeScheduleTime(slot.endTime);
      if (!slotStart || !slotEnd) return false;
      return slotStart === startNorm && slotEnd === endNorm;
    }) ??
    slots.find((slot) => {
      if (!slot) return false;
      const slotStart = normalizeScheduleTime(slot.startTime);
      const slotEnd = normalizeScheduleTime(slot.endTime);
      if (!slotStart || !slotEnd) return false;
      const parsedSlotStart = parseTimeToMinutes(slotStart);
      const parsedSlotEnd = parseTimeToMinutes(slotEnd);
      if (parsedSlotStart === null || parsedSlotEnd === null) return false;
      const crossesMidnight = parsedSlotEnd <= parsedSlotStart;
      if (!crossesMidnight) return false;
      if (getNextDay(String(slot.day).trim()) !== occurrenceDay) return false;
      return slotStart === startNorm && slotEnd === endNorm;
    });

  if (!matchedSlot) {
    return { error: "Provided date/time does not match session schedule" };
  }

  const startStored = normalizeScheduleTime(matchedSlot.startTime);
  const endStored = normalizeScheduleTime(matchedSlot.endTime);
  if (!startStored || !endStored) {
    return { error: "Session schedule has invalid time values" };
  }

  return { occurrenceDay, startStored, endStored };
}

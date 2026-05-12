import { normalizeTimeHHMM } from "./localDateTime.js";

export function buildOccurrenceKey(sessionId, date, startTime) {
  const normalizedStart = normalizeTimeHHMM(startTime) ?? String(startTime ?? "").trim();
  return `${String(sessionId)}|${String(date)}|${normalizedStart}`;
}

export function buildTraineeOccurrenceKey(traineeId, sessionId, date, startTime) {
  return `${String(traineeId)}|${buildOccurrenceKey(sessionId, date, startTime)}`;
}

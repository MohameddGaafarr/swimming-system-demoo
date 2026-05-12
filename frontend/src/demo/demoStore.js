import { DEMO_STORAGE_KEY, SESSION_DAYS, TRAINEE_LEVELS, DEMO_PASSWORD_DEFAULT, DEMO_USERNAME } from "./constants.js";
import { normalizeRoutePath } from "./demoPath.js";
import { buildSeedDatabase } from "./seedData.js";
import { findAllCurrentSessions, findNextUpcomingSession, getCairoContext } from "./cairoSessions.js";
import {
  isValidDateOnly,
  parseDateOnlyToLocalDate,
  resolveScheduleOccurrence,
} from "./sessionOccurrence.js";
import { normalizeTimeHHMM, parseTimeToMinutes } from "../utils/localDateTime.js";

let memory = null;

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(DEMO_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.coaches?.length && parsed?.trainees?.length) {
        memory = parsed;
        if (!memory.demoPassword) memory.demoPassword = DEMO_PASSWORD_DEFAULT;
        return;
      }
    }
  } catch {
    /* fall through */
  }
  memory = buildSeedDatabase();
  localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(memory));
}

export function getDb() {
  if (!memory) loadFromStorage();
  return memory;
}

function persist() {
  localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(memory));
}

export function resetDemoData() {
  memory = buildSeedDatabase();
  persist();
  window.dispatchEvent(new CustomEvent("demo:reset"));
}

function httpError(status, message, extra = {}) {
  const err = new Error(message);
  err.response = { status, data: { message, ...extra } };
  return err;
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function coachById(db, id) {
  return db.coaches.find((c) => String(c._id) === String(id));
}

function traineeById(db, id) {
  return db.trainees.find((t) => String(t._id) === String(id));
}

function sessionById(db, id) {
  return db.sessions.find((s) => String(s._id) === String(id));
}

function populateCoachBrief(db, id) {
  const c = coachById(db, id);
  if (!c) return { _id: id, name: "Unknown" };
  return { _id: c._id, name: c.name };
}

function populateTraineeBrief(db, id) {
  const t = traineeById(db, id);
  if (!t) return { _id: id, name: "Unknown", level: "", image: "" };
  return { _id: t._id, name: t.name, level: t.level, image: t.image || "" };
}

function populateSession(db, session) {
  const coach = coachById(db, session.coachId);
  const coachObj = coach ? { _id: coach._id, name: coach.name } : { _id: session.coachId, name: "—" };
  const trainees = (Array.isArray(session.trainees) ? session.trainees : []).map((tid) =>
    populateTraineeBrief(db, tid._id ?? tid),
  );
  return {
    ...session,
    coachId: coachObj,
    trainees,
  };
}

function getDayByOffset(day, offset) {
  const idx = SESSION_DAYS.indexOf(day);
  if (idx < 0) return null;
  return SESSION_DAYS[(idx + offset + 7) % 7];
}

function parseTimeToMinutesSafe(value) {
  return parseTimeToMinutes(value);
}

function expandSlotIntoDailyWindows(slot) {
  const start = parseTimeToMinutesSafe(slot.startTime);
  const end = parseTimeToMinutesSafe(slot.endTime);
  if (start === null || end === null || start === end) return [];
  if (end > start) {
    return [{ day: slot.day, start, end }];
  }
  const nextDay = getDayByOffset(slot.day, 1);
  return [
    { day: slot.day, start, end: 1440 },
    { day: nextDay, start: 0, end },
  ];
}

function isTimeOverlap(newStartM, newEndM, existingStartM, existingEndM) {
  return newStartM < existingEndM && newEndM > existingStartM;
}

function validateCoachScheduleConflicts(db, coachId, schedule, excludeSessionId = null) {
  const filterSessions = db.sessions.filter(
    (s) => String(s.coachId) === String(coachId) && String(s._id) !== String(excludeSessionId ?? ""),
  );
  for (const incomingSlot of schedule) {
    const incomingWindows = expandSlotIntoDailyWindows(incomingSlot);
    for (const existing of filterSessions) {
      const existingSlots = Array.isArray(existing.schedule) ? existing.schedule : [];
      for (const existingSlot of existingSlots) {
        const existingWindows = expandSlotIntoDailyWindows(existingSlot);
        for (const incoming of incomingWindows) {
          for (const existingWindow of existingWindows) {
            if (incoming.day !== existingWindow.day) continue;
            if (isTimeOverlap(incoming.start, incoming.end, existingWindow.start, existingWindow.end)) {
              return { error: "Coach already has a session during this time" };
            }
          }
        }
      }
    }
  }
  return { ok: true };
}

function validateScheduleSlots(schedule) {
  if (!Array.isArray(schedule)) return { error: "schedule must be an array" };
  if (schedule.length === 0) return { error: "At least one schedule slot is required" };
  const normalized = [];
  for (const slot of schedule) {
    if (!slot || typeof slot !== "object") return { error: "Each schedule slot must be an object" };
    const day = String(slot.day ?? "").trim();
    if (!SESSION_DAYS.includes(day)) {
      return { error: `Invalid day "${day}". Must be one of: ${SESSION_DAYS.join(", ")}` };
    }
    const startTime = String(slot.startTime ?? "").trim();
    const endTime = String(slot.endTime ?? "").trim();
    const startM = parseTimeToMinutesSafe(startTime);
    const endM = parseTimeToMinutesSafe(endTime);
    if (startM === null || endM === null) {
      return { error: "startTime and endTime must be in HH:mm format (00:00–23:59)" };
    }
    if (endM === startM) return { error: "Each slot must have a non-zero duration" };
    normalized.push({ day, startTime, endTime });
  }
  for (let i = 0; i < normalized.length; i += 1) {
    for (let j = i + 1; j < normalized.length; j += 1) {
      const firstWindows = expandSlotIntoDailyWindows(normalized[i]);
      const secondWindows = expandSlotIntoDailyWindows(normalized[j]);
      for (const first of firstWindows) {
        for (const second of secondWindows) {
          if (first.day !== second.day) continue;
          if (isTimeOverlap(first.start, first.end, second.start, second.end)) {
            return { error: "A session cannot contain overlapping slots on the same day" };
          }
        }
      }
    }
  }
  return { slots: normalized };
}

function normalizeTraineeIds(trainees) {
  if (!Array.isArray(trainees)) return { error: "trainees must be an array", ids: [] };
  const out = [];
  const seen = new Set();
  for (const item of trainees) {
    const s = String(item ?? "").trim();
    if (!s) continue;
    if (seen.has(s)) return { error: "Duplicate trainee ids are not allowed" };
    seen.add(s);
    out.push(s);
  }
  return { ids: out };
}

function syncTraineesToSession(db, sessionId, traineeIds) {
  const sid = String(sessionId);
  db.trainees.forEach((t) => {
    if (String(t.sessionId) === sid && !traineeIds.includes(String(t._id))) {
      t.sessionId = null;
    }
  });
  traineeIds.forEach((tid) => {
    const t = traineeById(db, tid);
    if (!t) return;
    const old = t.sessionId ? String(t.sessionId) : "";
    if (old && old !== sid) {
      const oldSession = db.sessions.find((s) => String(s._id) === old);
      if (oldSession) {
        oldSession.trainees = (oldSession.trainees || []).filter((x) => String(x._id ?? x) !== String(tid));
      }
    }
    t.sessionId = sid;
  });
}

function newOid(prefix) {
  const raw = `${prefix}${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`.replace(
    /[^0-9a-f]/gi,
    "0",
  );
  return raw.slice(0, 24).padEnd(24, "0");
}

function paginate(array, page, limit) {
  const p = Math.max(1, page);
  const l = Math.min(500, Math.max(1, limit));
  const totalItems = array.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / l));
  const currentPage = Math.min(p, totalPages);
  const skip = (currentPage - 1) * l;
  return {
    slice: array.slice(skip, skip + l),
    totalItems,
    totalPages,
    currentPage,
  };
}

function sortCoaches(rows, sortBy, order) {
  const mul = order === "asc" ? 1 : -1;
  const field = ["name", "age", "phone", "address", "totalWorkingHours", "createdAt"].includes(sortBy)
    ? sortBy
    : "createdAt";
  return [...rows].sort((a, b) => {
    const va = a[field];
    const vb = b[field];
    if (va === vb) return 0;
    if (field === "createdAt") return (new Date(va).getTime() - new Date(vb).getTime()) * -mul;
    if (typeof va === "number" && typeof vb === "number") return va < vb ? -mul : mul;
    return String(va).localeCompare(String(vb)) * mul;
  });
}

function sortTrainees(rows, sortBy, order) {
  const mul = order === "asc" ? 1 : -1;
  const field = ["name", "age", "level", "createdAt"].includes(sortBy) ? sortBy : "createdAt";
  return [...rows].sort((a, b) => {
    const va = a[field];
    const vb = b[field];
    if (va === vb) return 0;
    if (field === "createdAt") return (new Date(va).getTime() - new Date(vb).getTime()) * -mul;
    if (typeof va === "number" && typeof vb === "number") return va < vb ? -mul : mul;
    return String(va).localeCompare(String(vb)) * mul;
  });
}

function sortSessions(rows, sortBy, order) {
  const asc = order === "asc";
  const field = sortBy === "createdAt" ? "createdAt" : "createdAt";
  return [...rows].sort((a, b) => {
    const va = new Date(a[field]).getTime();
    const vb = new Date(b[field]).getTime();
    return asc ? va - vb : vb - va;
  });
}

function filterSessionsBySearch(db, sessions, search) {
  const q = String(search ?? "").trim();
  if (!q) return sessions;
  const rx = new RegExp(escapeRegex(q), "i");
  const coachIds = new Set(
    db.coaches.filter((c) => rx.test(c.name)).map((c) => String(c._id)),
  );
  const qLower = q.toLowerCase();
  const matchedDays = SESSION_DAYS.filter((d) => d.toLowerCase().includes(qLower));
  return sessions.filter((s) => {
    if (coachIds.has(String(s.coachId))) return true;
    const slots = Array.isArray(s.schedule) ? s.schedule : [];
    return slots.some((sl) => matchedDays.includes(sl.day));
  });
}

function calculateDuration(startTime, endTime) {
  const start = parseTimeToMinutesSafe(startTime);
  const end = parseTimeToMinutesSafe(endTime);
  if (start === null || end === null) return { durationMinutes: 0, durationHours: 0 };
  let durationMinutes = end - start;
  if (durationMinutes <= 0) durationMinutes += 24 * 60;
  const durationHours = Math.round((durationMinutes / 60) * 100) / 100;
  return { durationMinutes, durationHours };
}

function buildCoachAttendancePopulate(db, row) {
  const session = sessionById(db, row.sessionId);
  const coach = coachById(db, row.coachId);
  return {
    ...row,
    sessionId: session
      ? {
          _id: session._id,
          coachId: populateCoachBrief(db, session.coachId),
          schedule: session.schedule,
        }
      : { _id: row.sessionId, coachId: null, schedule: [] },
    coachId: coach ? { _id: coach._id, name: coach.name, totalWorkingHours: coach.totalWorkingHours } : { _id: row.coachId, name: "—" },
  };
}

function buildTraineeAttendancePopulate(db, row) {
  const session = sessionById(db, row.sessionId);
  const coach = coachById(db, row.coachId);
  const trainee = traineeById(db, row.traineeId);
  return {
    ...row,
    traineeId: trainee
      ? { _id: trainee._id, name: trainee.name, image: trainee.image, level: trainee.level }
      : { _id: row.traineeId, name: "—" },
    sessionId: session
      ? {
          _id: session._id,
          coachId: populateCoachBrief(db, session.coachId),
          schedule: session.schedule,
        }
      : { _id: row.sessionId },
    coachId: coach ? { _id: coach._id, name: coach.name } : { _id: row.coachId, name: "—" },
  };
}

export async function handleDemoRequest(method, urlPath, params = {}, body = null) {
  const db = getDb();
  const path = normalizeRoutePath(urlPath);
  const m = String(method || "get").toLowerCase();

  const coachIdMatch = path.match(/^\/api\/coaches\/([^/]+)$/);
  const traineeIdMatch = path.match(/^\/api\/trainees\/([^/]+)$/);
  const sessionIdMatch = path.match(/^\/api\/sessions\/([^/]+)$/);

  /* ---------- AUTH ---------- */
  if (m === "post" && path.endsWith("/api/auth/login")) {
    const username = String(body?.username ?? "").trim();
    const password = String(body?.password ?? "");
    if (!username || !password) throw httpError(400, "Username and password are required");
    if (username !== DEMO_USERNAME) throw httpError(401, "Invalid username or password");
    if (password !== db.demoPassword) throw httpError(401, "Invalid username or password");
    return {
      token: "demo-token",
      user: {
        id: "demo-admin",
        username: "demo",
        role: "admin",
        name: "Demo Admin",
      },
    };
  }

  if (m === "post" && path.endsWith("/api/auth/change-password")) {
    const { currentPassword, newPassword } = body ?? {};
    if (!currentPassword || !newPassword) {
      throw httpError(400, "currentPassword and newPassword are required");
    }
    if (String(newPassword).length < 8) {
      throw httpError(400, "New password must be at least 8 characters");
    }
    if (currentPassword !== db.demoPassword) {
      throw httpError(400, "Current password is incorrect");
    }
    db.demoPassword = String(newPassword);
    persist();
    return { message: "Password changed successfully" };
  }

  /* ---------- COACHES ---------- */
  if (m === "get" && /^\/api\/coaches$/.test(path)) {
    const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1);
    let limit = parseInt(params.limit ?? "", 10);
    if (!Number.isFinite(limit) || limit <= 0) limit = 500;
    limit = Math.min(500, limit);
    const search = String(params.search ?? "").trim();
    const sortBy = params.sortBy;
    const order = params.order === "asc" ? "asc" : "desc";
    let rows = [...db.coaches];
    if (search) {
      const rx = new RegExp(escapeRegex(search), "i");
      rows = rows.filter((c) => rx.test(c.name) || rx.test(c.phone) || rx.test(c.address));
    }
    rows = sortCoaches(rows, sortBy, order);
    const { slice, totalItems, totalPages, currentPage } = paginate(rows, page, limit);
    return { coaches: slice, totalItems, totalPages, currentPage };
  }

  if (coachIdMatch && m === "get") {
    const id = coachIdMatch[1];
    const coach = coachById(db, id);
    if (!coach) throw httpError(404, "Coach not found");
    const attendanceHistory = db.coachAttendance
      .filter((a) => String(a.coachId) === String(id))
      .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.startTime).localeCompare(String(a.startTime)))
      .map((row) => buildCoachAttendancePopulate(db, row));
    const totalRecordedSessions = attendanceHistory.length;
    const totalAttendedSessions = attendanceHistory.filter((row) => row.attended !== false).length;
    const totalAbsentSessions = attendanceHistory.filter((row) => row.attended === false).length;
    const attendancePercentage =
      totalRecordedSessions > 0 ? (totalAttendedSessions / totalRecordedSessions) * 100 : 0;
    return {
      ...clone(coach),
      attendanceStats: {
        totalRecordedSessions,
        totalAttendedSessions,
        totalAbsentSessions,
        attendancePercentage,
      },
      attendanceHistory,
    };
  }

  if (m === "post" && /^\/api\/coaches$/.test(path)) {
    const parsed = parseCoachPayload(body);
    if (parsed.error) throw httpError(400, parsed.error);
    const doc = {
      _id: newOid("64a"),
      ...parsed.data,
      image: body?.image ? String(body.image) : "",
      imagePublicId: "",
      totalWorkingHours: 0,
      createdAt: new Date().toISOString(),
    };
    db.coaches.push(doc);
    persist();
    return doc;
  }

  if (coachIdMatch && m === "put") {
    const id = coachIdMatch[1];
    const coach = coachById(db, id);
    if (!coach) throw httpError(404, "Coach not found");
    const parsed = parseCoachPayload(body);
    if (parsed.error) throw httpError(400, parsed.error);
    Object.assign(coach, parsed.data);
    if (body?.image && String(body.image).length > 0) {
      coach.image = String(body.image);
    }
    persist();
    return clone(coach);
  }

  if (coachIdMatch && m === "delete") {
    const id = coachIdMatch[1];
    const coach = coachById(db, id);
    if (!coach) throw httpError(404, "Coach not found");
    const removedSessionIds = db.sessions
      .filter((s) => String(s.coachId) === String(id))
      .map((s) => String(s._id));
    db.trainees.forEach((t) => {
      if (removedSessionIds.includes(String(t.sessionId))) t.sessionId = null;
    });
    db.traineeAttendance = db.traineeAttendance.filter((a) => !removedSessionIds.includes(String(a.sessionId)));
    db.coachAttendance = db.coachAttendance.filter((a) => String(a.coachId) !== String(id));
    db.sessions = db.sessions.filter((s) => String(s.coachId) !== String(id));
    db.coaches = db.coaches.filter((c) => String(c._id) !== String(id));
    persist();
    return { message: "Coach deleted successfully" };
  }

  /* ---------- TRAINEES ---------- */
  if (m === "get" && /^\/api\/trainees$/.test(path)) {
    const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1);
    let limit = parseInt(params.limit ?? "", 10);
    if (!Number.isFinite(limit) || limit <= 0) limit = 500;
    limit = Math.min(500, limit);
    const search = String(params.search ?? "").trim();
    const level = String(params.level ?? "").trim();
    const sortBy = params.sortBy;
    const order = params.order === "asc" ? "asc" : "desc";
    let rows = [...db.trainees];
    if (search) {
      const rx = new RegExp(escapeRegex(search), "i");
      rows = rows.filter((t) => rx.test(t.name));
    }
    if (level && TRAINEE_LEVELS.includes(level)) {
      rows = rows.filter((t) => t.level === level);
    }
    rows = sortTrainees(rows, sortBy, order);
    const populated = rows.map((t) => populateTraineeWithSession(db, t));
    const { slice, totalItems, totalPages, currentPage } = paginate(populated, page, limit);
    return { trainees: slice, currentPage, totalPages, totalItems };
  }

  if (traineeIdMatch && m === "get") {
    const id = traineeIdMatch[1];
    const trainee = traineeById(db, id);
    if (!trainee) throw httpError(404, "Trainee not found");
    const tcopy = populateTraineeWithSession(db, trainee);
    const rows = db.traineeAttendance.filter((a) => String(a.traineeId) === String(id));
    const totalRecordedSessions = rows.length;
    const totalAttendedSessions = rows.filter((r) => r.attended !== false).length;
    const totalAbsentSessions = rows.filter((r) => r.attended === false).length;
    const attendancePercentage =
      totalRecordedSessions > 0
        ? Math.round((totalAttendedSessions / totalRecordedSessions) * 10000) / 100
        : 0;
    const attendanceHistory = [...rows]
      .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.startTime).localeCompare(String(a.startTime)))
      .slice(0, 100)
      .map((row) => buildTraineeAttendancePopulate(db, row));
    return {
      ...tcopy,
      attendanceStats: {
        totalRecordedSessions,
        totalAttendedSessions,
        totalAbsentSessions,
        attendancePercentage,
      },
      attendanceHistory,
    };
  }

  if (m === "post" && /^\/api\/trainees$/.test(path)) {
    const parsed = parseTraineePayload(body);
    if (parsed.error) throw httpError(400, parsed.error);
    const doc = {
      _id: newOid("64b"),
      ...parsed.data,
      image: body?.image || "",
      imagePublicId: "",
      createdAt: new Date().toISOString(),
    };
    db.trainees.push(doc);
    persist();
    return populateTraineeWithSession(db, doc);
  }

  if (traineeIdMatch && m === "put") {
    const id = traineeIdMatch[1];
    const trainee = traineeById(db, id);
    if (!trainee) throw httpError(404, "Trainee not found");
    const parsed = parseTraineePayload(body);
    if (parsed.error) throw httpError(400, parsed.error);
    Object.assign(trainee, parsed.data);
    if (body?.image && String(body.image).length > 0) {
      trainee.image = String(body.image);
    }
    persist();
    return populateTraineeWithSession(db, trainee);
  }

  if (traineeIdMatch && m === "delete") {
    const id = traineeIdMatch[1];
    const trainee = traineeById(db, id);
    if (!trainee) throw httpError(404, "Trainee not found");
    db.traineeAttendance = db.traineeAttendance.filter((a) => String(a.traineeId) !== String(id));
    db.sessions.forEach((s) => {
      s.trainees = (s.trainees || []).filter((tid) => String(tid._id ?? tid) !== String(id));
    });
    db.trainees = db.trainees.filter((t) => String(t._id) !== String(id));
    persist();
    return { message: "Trainee deleted", id: trainee._id };
  }

  /* ---------- SESSIONS ---------- */
  if (m === "get" && path.endsWith("/api/sessions/current")) {
    const cairoNow = getCairoContext();
    const populated = db.sessions.map((s) => populateSession(db, s));
    const current = findAllCurrentSessions(populated);
    return {
      current,
      now: {
        weekday: cairoNow.weekday,
        minutesOfDay: cairoNow.minutesOfDay,
        dateOnly: cairoNow.dateOnly,
        timestampMs: Date.now(),
      },
    };
  }

  if (m === "get" && path.endsWith("/api/sessions/upcoming")) {
    const populated = db.sessions.map((s) => populateSession(db, s));
    const currentSessions = findAllCurrentSessions(populated);
    const currentIds = new Set(currentSessions.map((s) => String(s._id)));
    const pool = populated.filter((s) => !currentIds.has(String(s._id)));
    const upcoming = findNextUpcomingSession(pool);
    return { upcoming };
  }

  if (m === "get" && /^\/api\/sessions$/.test(path)) {
    const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1);
    const limit = Math.min(500, Math.max(1, parseInt(params.limit ?? "10", 10) || 10));
    const sortBy = params.sortBy;
    const order = params.order === "asc" ? "asc" : "desc";
    const search = params.search;
    let rows = filterSessionsBySearch(db, [...db.sessions], search);
    rows = sortSessions(rows, sortBy, order);
    const { slice, totalItems, totalPages, currentPage } = paginate(rows, page, limit);
    return {
      sessions: slice.map((s) => populateSession(db, s)),
      currentPage,
      totalPages,
      totalItems,
    };
  }

  if (sessionIdMatch && m === "get" && sessionIdMatch[1] !== "clear") {
    const id = sessionIdMatch[1];
    const session = sessionById(db, id);
    if (!session) throw httpError(404, "Session not found");
    return populateSession(db, session);
  }

  if (m === "post" && /^\/api\/sessions$/.test(path)) {
    const parsed = parseAndValidateSessionBody(db, body);
    if (parsed.error) throw httpError(400, parsed.error);
    const overlap = validateCoachScheduleConflicts(db, parsed.data.coachId, parsed.data.schedule, null);
    if (overlap.error) throw httpError(400, overlap.error);
    const doc = {
      _id: newOid("64c"),
      coachId: parsed.data.coachId,
      trainees: parsed.data.trainees,
      schedule: parsed.data.schedule,
      createdAt: new Date().toISOString(),
    };
    db.sessions.push(doc);
    syncTraineesToSession(db, doc._id, parsed.data.trainees);
    persist();
    return populateSession(db, doc);
  }

  if (sessionIdMatch && m === "put") {
    const id = sessionIdMatch[1];
    const existing = sessionById(db, id);
    if (!existing) throw httpError(404, "Session not found");
    const parsed = parseAndValidateSessionBody(db, body);
    if (parsed.error) throw httpError(400, parsed.error);
    const overlap = validateCoachScheduleConflicts(db, parsed.data.coachId, parsed.data.schedule, id);
    if (overlap.error) throw httpError(400, overlap.error);
    Object.assign(existing, {
      coachId: parsed.data.coachId,
      trainees: parsed.data.trainees,
      schedule: parsed.data.schedule,
    });
    syncTraineesToSession(db, id, parsed.data.trainees);
    persist();
    return populateSession(db, existing);
  }

  if (sessionIdMatch && m === "delete" && sessionIdMatch[1] !== "clear") {
    const id = sessionIdMatch[1];
    const existing = sessionById(db, id);
    if (!existing) throw httpError(404, "Session not found");
    db.trainees.forEach((t) => {
      if (String(t.sessionId) === String(id)) t.sessionId = null;
    });
    db.coachAttendance = db.coachAttendance.filter((a) => String(a.sessionId) !== String(id));
    db.traineeAttendance = db.traineeAttendance.filter((a) => String(a.sessionId) !== String(id));
    db.sessions = db.sessions.filter((s) => String(s._id) !== String(id));
    persist();
    return { message: "deleted" };
  }

  if (m === "delete" && path.endsWith("/api/sessions/clear")) {
    db.sessions = [];
    db.trainees.forEach((t) => {
      t.sessionId = null;
    });
    persist();
    return { message: "All sessions cleared" };
  }

  /* ---------- ATTENDANCE (longer paths first) ---------- */
  if (m === "get" && path.endsWith("/api/attendance/trainees/history")) {
    return getTraineeAttendanceHistory(db, params);
  }

  if (m === "get" && path.endsWith("/api/attendance/trainees/by-session")) {
    const sessionId = String(params.sessionId ?? "").trim();
    if (!sessionId) throw httpError(400, "Valid sessionId query is required");
    const date = params.date ? String(params.date).trim() : undefined;
    const startTime = params.startTime ? normalizeTimeHHMM(params.startTime) : undefined;
    let rows = db.traineeAttendance.filter((r) => String(r.sessionId) === sessionId);
    if (date) rows = rows.filter((r) => r.date === date);
    if (startTime) rows = rows.filter((r) => normalizeTimeHHMM(r.startTime) === startTime);
    rows.sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.startTime).localeCompare(String(a.startTime)));
    return {
      sessionId,
      records: rows.map((r) => buildTraineeAttendancePopulate(db, r)),
    };
  }

  if (m === "get" && path.endsWith("/api/attendance/history")) {
    return getCoachAttendanceHistory(db, params);
  }

  if (m === "get" && path.endsWith("/api/attendance/payroll-summary")) {
    return getPayrollSummary(db, params);
  }

  if (m === "delete" && path.endsWith("/api/attendance/clear/coaches")) {
    db.coachAttendance = [];
    db.coaches.forEach((c) => {
      c.totalWorkingHours = 0;
    });
    persist();
    return { message: "Coach attendance cleared successfully" };
  }

  if (m === "delete" && path.endsWith("/api/attendance/clear/trainees")) {
    db.traineeAttendance = [];
    persist();
    return { message: "Trainee attendance cleared successfully" };
  }

  if (m === "get" && /^\/api\/attendance\/trainees$/.test(path)) {
    const dateOnly = params.date ? String(params.date).trim() : getCairoDateOnly();
    if (!isValidDateOnly(dateOnly)) throw httpError(400, "date query must be in YYYY-MM-DD format");
    const records = db.traineeAttendance.filter((r) => r.date === dateOnly);
    const items = records.map((r) => buildTraineeAttendancePopulate(db, r));
    const statusByKey = {};
    items.forEach((record) => {
      const tid = record.traineeId?._id ?? record.traineeId;
      const sid = record.sessionId?._id ?? record.sessionId;
      const key = `${String(tid)}|${String(sid)}|${dateOnly}|${normalizeTimeHHMM(record.startTime) ?? record.startTime}`;
      const attendedValue = record.attended === false ? false : true;
      const storedReason = record.reason ?? record.note ?? "";
      statusByKey[key] = { attended: attendedValue, note: storedReason, reason: storedReason };
    });
    return { date: dateOnly, items, statusByKey };
  }

  if (m === "post" && /^\/api\/attendance\/trainees$/.test(path)) {
    return markTraineeAttendance(db, body);
  }

  if (m === "get" && /^\/api\/attendance$/.test(path)) {
    const dateOnly = params.date ? String(params.date).trim() : getCairoDateOnly();
    if (!isValidDateOnly(dateOnly)) throw httpError(400, "date query must be in YYYY-MM-DD format");
    const records = db.coachAttendance.filter((r) => r.date === dateOnly);
    const items = records.map((r) => buildCoachAttendancePopulate(db, r));
    const statusByKey = {};
    const markedKeys = [];
    items.forEach((record) => {
      const sid = record.sessionId?._id ?? record.sessionId;
      const start = record.startTime;
      const key = `${String(sid)}|${dateOnly}|${normalizeTimeHHMM(start) ?? start}`;
      markedKeys.push(key);
      const attendedValue = record.attended === false ? false : true;
      const storedReason = record.reason ?? record.note ?? "";
      statusByKey[key] = { attended: attendedValue, note: storedReason, reason: storedReason };
    });
    return { date: dateOnly, items, markedKeys, statusByKey };
  }

  if (m === "post" && /^\/api\/attendance$/.test(path)) {
    return markCoachAttendance(db, body);
  }

  console.error("[SwimaxDemo:router] unmatched mock route", {
    method: m,
    path,
    rawUrlPath: urlPath,
  });
  throw httpError(404, "Not found");
}

function populateTraineeWithSession(db, trainee) {
  const sid = trainee.sessionId;
  const session = sid ? sessionById(db, sid) : null;
  const sessionObj = session
    ? { _id: session._id, schedule: session.schedule }
    : null;
  return { ...clone(trainee), sessionId: sessionObj };
}

function parseCoachPayload(body = {}) {
  const { name, age, phone, address, bio } = body;
  const PHONE_REGEX = /^[0-9+\-() ]{7,20}$/;
  if (!name || String(name).trim() === "") return { error: "Name is required" };
  if (age === undefined || age === null || age === "") return { error: "Age is required" };
  const ageNum = Number(age);
  if (!Number.isFinite(ageNum) || ageNum < 0) return { error: "Age must be a valid non-negative number" };
  if (!phone || String(phone).trim() === "") return { error: "Phone is required" };
  const phoneStr = String(phone).trim();
  if (!PHONE_REGEX.test(phoneStr)) return { error: "Phone format is invalid" };
  if (!address || String(address).trim() === "") return { error: "Address is required" };
  const addressStr = String(address).trim();
  if (addressStr.length < 3) return { error: "Address must be at least 3 characters" };
  return {
    data: {
      name: String(name).trim(),
      age: ageNum,
      phone: phoneStr,
      address: addressStr,
      bio: bio ? String(bio) : "",
    },
  };
}

function parseTraineePayload(body) {
  const { name, age, level, phone, address } = body ?? {};
  const PHONE_REGEX = /^[0-9+\-() ]{7,20}$/;
  if (!name || String(name).trim() === "") return { error: "Name is required" };
  if (age === undefined || age === null || age === "") return { error: "Age is required" };
  const ageNum = Number(age);
  if (!Number.isFinite(ageNum) || ageNum < 0) return { error: "Age must be a valid non-negative number" };
  const levelStr = String(level);
  if (!TRAINEE_LEVELS.includes(levelStr)) {
    return { error: `Level must be one of: ${TRAINEE_LEVELS.join(", ")}` };
  }
  if (!phone || String(phone).trim() === "") return { error: "Phone is required" };
  const phoneStr = String(phone).trim();
  if (!PHONE_REGEX.test(phoneStr)) return { error: "Phone must match format /^[0-9+\\-() ]{7,20}$/" };
  if (!address || String(address).trim() === "") return { error: "Address is required" };
  const addressStr = String(address).trim();
  if (addressStr.length < 3) return { error: "Address must be at least 3 characters" };
  const data = {
    name: String(name).trim(),
    age: ageNum,
    level: levelStr,
    phone: phoneStr,
    address: addressStr,
  };
  if ("notes" in body) data.notes = body.notes ? String(body.notes) : "";
  if ("sessionId" in body) {
    const raw = body.sessionId;
    if (!raw) data.sessionId = null;
    else data.sessionId = String(raw);
  }
  return { data };
}

function parseAndValidateSessionBody(db, body) {
  const { coachId, trainees, schedule } = body ?? {};
  if (coachId === undefined || coachId === null || String(coachId).trim() === "") {
    return { error: "coachId is required" };
  }
  const coachIdStr = String(coachId).trim();
  if (!coachById(db, coachIdStr)) return { error: "Coach not found" };
  const idParse = normalizeTraineeIds(trainees);
  if (idParse.error) return { error: idParse.error };
  for (const tid of idParse.ids) {
    if (!traineeById(db, tid)) return { error: "One or more trainees do not exist" };
  }
  const sched = validateScheduleSlots(schedule);
  if (sched.error) return { error: sched.error };
  return { data: { coachId: coachIdStr, trainees: idParse.ids, schedule: sched.slots } };
}

function getCoachAttendanceHistory(db, query) {
  const page = Math.max(1, parseInt(String(query.page ?? "1"), 10) || 1);
  const limitRaw = parseInt(String(query.limit ?? "10"), 10) || 10;
  const limit = Math.min(100, Math.max(1, limitRaw));
  let rows = [...db.coachAttendance];
  if (query.coachId) rows = rows.filter((r) => String(r.coachId) === String(query.coachId));
  if (query.sessionId) rows = rows.filter((r) => String(r.sessionId) === String(query.sessionId));
  if (query.status) {
    const statusRaw = String(query.status).trim().toLowerCase();
    if (statusRaw === "attended") {
      rows = rows.filter((r) => r.attended !== false);
    } else if (statusRaw === "not_attended") {
      rows = rows.filter((r) => r.attended === false);
    } else if (statusRaw !== "all") {
      throw httpError(400, "status must be attended, not_attended, or all");
    }
  }
  if (query.startDate || query.endDate) {
    const from = query.startDate ? String(query.startDate).trim() : null;
    const to = query.endDate ? String(query.endDate).trim() : null;
    if (from && !isValidDateOnly(from)) throw httpError(400, "startDate must be in YYYY-MM-DD format");
    if (to && !isValidDateOnly(to)) throw httpError(400, "endDate must be in YYYY-MM-DD format");
    rows = rows.filter((r) => {
      if (from && r.date < from) return false;
      if (to && r.date > to) return false;
      return true;
    });
  }
  rows.sort(
    (a, b) => String(b.date).localeCompare(String(a.date)) || String(b.startTime).localeCompare(String(a.startTime)),
  );
  const totalItems = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / limit));
  const currentPage = Math.min(page, totalPages);
  const skip = (currentPage - 1) * limit;
  const records = rows.slice(skip, skip + limit).map((r) => buildCoachAttendancePopulate(db, r));
  return { records, currentPage, totalPages, totalItems };
}

function getTraineeAttendanceHistory(db, query) {
  const page = Math.max(1, parseInt(String(query.page ?? "1"), 10) || 1);
  const limitRaw = parseInt(String(query.limit ?? "10"), 10) || 10;
  const limit = Math.min(100, Math.max(1, limitRaw));
  let rows = [...db.traineeAttendance];
  if (query.coachId) rows = rows.filter((r) => String(r.coachId) === String(query.coachId));
  if (query.sessionId) rows = rows.filter((r) => String(r.sessionId) === String(query.sessionId));
  if (query.traineeId) rows = rows.filter((r) => String(r.traineeId) === String(query.traineeId));
  if (query.status) {
    const statusRaw = String(query.status).trim().toLowerCase();
    if (["present", "attended"].includes(statusRaw)) {
      rows = rows.filter((r) => r.attended !== false);
    } else if (["absent", "not_attended"].includes(statusRaw)) {
      rows = rows.filter((r) => r.attended === false);
    } else if (statusRaw !== "all") {
      throw httpError(400, "status must be attended, absent, or all");
    }
  }
  if (query.startDate || query.endDate) {
    rows = rows.filter((r) => {
      if (query.startDate && r.date < String(query.startDate).trim()) return false;
      if (query.endDate && r.date > String(query.endDate).trim()) return false;
      return true;
    });
  }
  rows.sort(
    (a, b) => String(b.date).localeCompare(String(a.date)) || String(b.startTime).localeCompare(String(a.startTime)),
  );
  const totalItems = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / limit));
  const currentPage = Math.min(page, totalPages);
  const skip = (currentPage - 1) * limit;
  const records = rows.slice(skip, skip + limit).map((r) => buildTraineeAttendancePopulate(db, r));
  return { records, currentPage, totalPages, totalItems };
}

function getPayrollSummary(db, query) {
  let rows = db.coachAttendance.filter((r) => r.attended !== false);
  if (query.startDate || query.endDate) {
    const from = query.startDate ? String(query.startDate).trim() : null;
    const to = query.endDate ? String(query.endDate).trim() : null;
    if (from && !isValidDateOnly(from)) throw httpError(400, "startDate must be in YYYY-MM-DD format");
    if (to && !isValidDateOnly(to)) throw httpError(400, "endDate must be in YYYY-MM-DD format");
    if (from && to && from > to) throw httpError(400, "startDate must be before or equal to endDate");
    rows = rows.filter((r) => {
      if (from && r.date < from) return false;
      if (to && r.date > to) return false;
      return true;
    });
  }
  const byCoach = new Map();
  rows.forEach((r) => {
    const cid = String(r.coachId);
    const prev = byCoach.get(cid) || { totalMinutes: 0, totalHours: 0 };
    const dm = r.durationMinutes ?? Math.round((r.durationHours || 0) * 60);
    const dh = r.durationHours ?? dm / 60;
    prev.totalMinutes += dm;
    prev.totalHours += dh;
    byCoach.set(cid, prev);
  });
  const summary = [...byCoach.entries()]
    .map(([coachId, agg]) => {
      const coach = coachById(db, coachId);
      const totalMinutes = Math.round(agg.totalMinutes);
      const totalHours = Math.round(agg.totalHours * 100) / 100;
      const h = Math.floor(totalMinutes / 60);
      const m = totalMinutes % 60;
      return {
        coachId,
        coachName: coach?.name ?? "Unknown Coach",
        totalMinutes,
        totalHours,
        totalHoursFormatted: `${h}h ${m}m`,
      };
    })
    .sort((a, b) => b.totalHours - a.totalHours || a.coachName.localeCompare(b.coachName));
  return summary;
}

function markCoachAttendance(db, body) {
  const { sessionId, date, startTime, endTime, attended, note, reason } = body ?? {};
  if (!sessionId) throw httpError(400, "Valid sessionId is required");
  const session = sessionById(db, sessionId);
  if (!session) throw httpError(404, "Session not found");
  const dateOnly = String(date ?? "").trim();
  if (!isValidDateOnly(dateOnly)) throw httpError(400, "date must be in YYYY-MM-DD format");
  const parsedDate = parseDateOnlyToLocalDate(dateOnly);
  if (!parsedDate) throw httpError(400, "date must be valid");
  const startNorm = normalizeTimeHHMM(startTime);
  const endNorm = normalizeTimeHHMM(endTime);
  if (!startNorm || !endNorm) throw httpError(400, "startTime/endTime must be valid times (e.g. HH:mm)");
  const resolved = resolveScheduleOccurrence({
    schedule: session.schedule,
    parsedDate,
    startNorm,
    endNorm,
  });
  if (resolved.error) throw httpError(400, resolved.error);
  const { startStored, endStored } = resolved;
  const dup = db.coachAttendance.some(
    (r) => String(r.sessionId) === String(sessionId) && r.date === dateOnly && r.startTime === startStored,
  );
  if (dup) throw httpError(409, "Attendance already marked for this occurrence");
  const { durationMinutes, durationHours } = calculateDuration(startStored, endStored);
  const attendedValue = attended === false ? false : true;
  const reasonValue = String(reason ?? note ?? "").trim();
  const coach = coachById(db, session.coachId);
  if (attendedValue && coach) {
    coach.totalWorkingHours = Math.round((coach.totalWorkingHours + durationHours) * 100) / 100;
  }
  const row = {
    _id: newOid("64d"),
    sessionId: String(sessionId),
    coachId: String(session.coachId),
    date: dateOnly,
    startTime: startStored,
    endTime: endStored,
    durationMinutes,
    durationHours,
    attended: attendedValue,
    note: reasonValue,
    reason: reasonValue,
    createdAt: new Date().toISOString(),
  };
  db.coachAttendance.push(row);
  persist();
  const populated = buildCoachAttendancePopulate(db, row);
  const occurrenceKey = `${String(sessionId)}|${dateOnly}|${startStored}`;
  return { message: "Attendance marked", attendance: populated, occurrenceKey };
}

function traineeBelongsToSession(session, traineeIdStr) {
  const trainees = Array.isArray(session.trainees) ? session.trainees : [];
  return trainees.some((t) => String(t._id ?? t) === traineeIdStr);
}

function markTraineeAttendance(db, body) {
  const { sessionId, traineeId, date, startTime, endTime, attended, note, reason } = body ?? {};
  if (!sessionId) throw httpError(400, "Valid sessionId is required");
  if (!traineeId) throw httpError(400, "Valid traineeId is required");
  const session = sessionById(db, sessionId);
  if (!session) throw httpError(404, "Session not found");
  const traineeIdStr = String(traineeId);
  if (!traineeBelongsToSession(session, traineeIdStr)) {
    throw httpError(400, "Trainee is not assigned to this session");
  }
  const dateOnly = String(date ?? "").trim();
  if (!isValidDateOnly(dateOnly)) throw httpError(400, "date must be in YYYY-MM-DD format");
  const parsedDate = parseDateOnlyToLocalDate(dateOnly);
  if (!parsedDate) throw httpError(400, "date must be valid");
  const startNorm = normalizeTimeHHMM(startTime);
  const endNorm = normalizeTimeHHMM(endTime);
  if (!startNorm || !endNorm) throw httpError(400, "startTime/endTime must be valid times (HH:mm)");
  const resolved = resolveScheduleOccurrence({
    schedule: session.schedule,
    parsedDate,
    startNorm,
    endNorm,
  });
  if (resolved.error) throw httpError(400, resolved.error);
  const { occurrenceDay, startStored, endStored } = resolved;
  const attendedValue = attended === false ? false : true;
  const reasonValue = String(reason ?? note ?? "").trim();
  const idx = db.traineeAttendance.findIndex(
    (r) =>
      String(r.sessionId) === String(sessionId) &&
      String(r.traineeId) === traineeIdStr &&
      r.date === dateOnly &&
      r.startTime === startStored,
  );
  const payload = {
    sessionId: String(sessionId),
    traineeId: traineeIdStr,
    coachId: String(session.coachId),
    date: dateOnly,
    dayName: occurrenceDay,
    startTime: startStored,
    endTime: endStored,
    attended: attendedValue,
    note: reasonValue,
    reason: reasonValue,
    createdAt: new Date().toISOString(),
  };
  let row;
  if (idx >= 0) {
    row = { ...db.traineeAttendance[idx], ...payload };
    db.traineeAttendance[idx] = row;
  } else {
    row = { _id: newOid("64e"), ...payload };
    db.traineeAttendance.push(row);
  }
  persist();
  const populated = buildTraineeAttendancePopulate(db, row);
  const occurrenceKey = `${String(sessionId)}|${dateOnly}|${startStored}`;
  const traineeOccurrenceKey = `${traineeIdStr}|${occurrenceKey}`;
  return {
    message: "Trainee attendance saved",
    attendance: populated,
    occurrenceKey,
    traineeOccurrenceKey,
  };
}

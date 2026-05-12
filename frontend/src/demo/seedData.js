import { TRAINEE_LEVELS, SESSION_DAYS } from "./constants.js";
import { getCairoDateOnly } from "../utils/sessionActivity.js";
import { normalizeTimeHHMM } from "../utils/localDateTime.js";
import { resolveScheduleOccurrence } from "./sessionOccurrence.js";

const COACH_IDS = [
  "64a100000000000000000001",
  "64a100000000000000000002",
  "64a100000000000000000003",
  "64a100000000000000000004",
  "64a100000000000000000005",
  "64a100000000000000000006",
  "64a100000000000000000007",
  "64a100000000000000000008",
];

const COACH_NAMES = [
  "Ahmed Hassan",
  "Mona El-Sayed",
  "Karim Farouk",
  "Layla Ibrahim",
  "Omar Sedky",
  "Nour Hamdy",
  "Youssef Magdy",
  "Salma Rashid",
];

const TRAINEE_FIRST = [
  "Ali",
  "Yara",
  "Hana",
  "Omar",
  "Mariam",
  "Karim",
  "Farida",
  "Tarek",
  "Nada",
  "Youssef",
  "Laila",
  "Hassan",
  "Dina",
  "Khaled",
  "Reem",
  "Mostafa",
  "Sara",
  "Amr",
  "Nour",
  "Hussein",
];

const TRAINEE_LAST = [
  "Mohamed",
  "Ibrahim",
  "Soliman",
  "El-Masry",
  "Farouk",
  "Abdel-Rahman",
  "El-Sherif",
  "Mahmoud",
  "Gaber",
  "Hassan",
  "Khalil",
  "Nassar",
  "Oraby",
  "Fathy",
  "Zaki",
  "Roushdy",
  "Salem",
  "El-Gendy",
  "Mansour",
  "Awad",
];

function traineeId(i) {
  const n = i + 1;
  return `64b1000000000000${String(n).padStart(8, "0")}`.slice(0, 24);
}

function sessionId(i) {
  const n = i + 1;
  return `64c1000000000000${String(n).padStart(8, "0")}`.slice(0, 24);
}

function coachAttendanceId(i) {
  const n = i + 1;
  return `64d1000000000000${String(n).padStart(8, "0")}`.slice(0, 24);
}

function traineeAttendanceId(i) {
  const n = i + 1;
  return `64e1000000000000${String(n).padStart(8, "0")}`.slice(0, 24);
}

function addDaysToDateOnly(dateOnly, deltaDays) {
  const [y, m, d] = dateOnly.split("-").map(Number);
  const dt = new Date(y, m - 1, d + deltaDays);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function durationFromTimes(startTime, endTime) {
  const [sh, sm] = String(startTime).split(":").map(Number);
  const [eh, em] = String(endTime).split(":").map(Number);
  let start = sh * 60 + sm;
  let end = eh * 60 + em;
  let durationMinutes = end - start;
  if (durationMinutes <= 0) durationMinutes += 24 * 60;
  const durationHours = Math.round((durationMinutes / 60) * 100) / 100;
  return { durationMinutes, durationHours };
}

/**
 * Build a fresh demo database (deterministic structure, dates relative to `now`).
 */
export function buildSeedDatabase(now = new Date()) {
  const cairoToday = getCairoDateOnly(now);
  const coaches = COACH_IDS.map((id, i) => ({
    _id: id,
    name: COACH_NAMES[i],
    age: 26 + (i % 15),
    phone: `+20 10${String(10000000 + i * 137).slice(0, 8)}`,
    address: `${12 + i} Nile Corniche, Maadi, Cairo`,
    bio: `Head coach for ${TRAINEE_LEVELS[i % TRAINEE_LEVELS.length]} groups. ASCA-certified, 10+ years pool instruction.`,
    image: `https://i.pravatar.cc/300?img=${(i % 70) + 1}`,
    imagePublicId: "",
    totalWorkingHours: 0,
    createdAt: new Date(now.getTime() - (8 - i) * 86400000 * 30).toISOString(),
  }));

  const trainees = [];
  for (let i = 0; i < 48; i += 1) {
    const sid = sessionId(Math.floor(i / 4) % 12);
    trainees.push({
      _id: traineeId(i),
      name: `${TRAINEE_FIRST[i % TRAINEE_FIRST.length]} ${TRAINEE_LAST[(i * 2) % TRAINEE_LAST.length]}`,
      age: 5 + (i % 12),
      level: TRAINEE_LEVELS[i % TRAINEE_LEVELS.length],
      phone: `+20 11${String(20000000 + i * 97).slice(0, 8)}`,
      address: `${3 + (i % 20)} Street ${(i % 5) + 1}, Heliopolis, Cairo`,
      notes: i % 7 === 0 ? "Parent prefers evening SMS reminders." : "",
      image: `https://i.pravatar.cc/200?img=${((i + 15) % 70) + 1}`,
      imagePublicId: "",
      sessionId: sid,
      createdAt: new Date(now.getTime() - (i + 1) * 86400000 * 3).toISOString(),
    });
  }

  const sessionTemplates = [
    { coachIdx: 0, day: "Monday", start: "09:00", end: "10:30" },
    { coachIdx: 1, day: "Monday", start: "16:00", end: "17:30" },
    { coachIdx: 2, day: "Tuesday", start: "09:00", end: "10:30" },
    { coachIdx: 3, day: "Tuesday", start: "17:00", end: "18:30" },
    { coachIdx: 4, day: "Wednesday", start: "10:00", end: "11:30" },
    { coachIdx: 5, day: "Wednesday", start: "18:00", end: "19:30" },
    { coachIdx: 6, day: "Thursday", start: "09:30", end: "11:00" },
    { coachIdx: 7, day: "Thursday", start: "16:30", end: "18:00" },
    { coachIdx: 0, day: "Saturday", start: "10:00", end: "11:30" },
    { coachIdx: 1, day: "Saturday", start: "12:00", end: "13:30" },
    { coachIdx: 2, day: "Sunday", start: "11:00", end: "12:30" },
    { coachIdx: 3, day: "Sunday", start: "15:00", end: "16:30" },
  ];

  const sessions = sessionTemplates.map((tpl, idx) => {
    const tidStart = idx * 4;
    const traineeIds = [0, 1, 2, 3].map((j) => traineeId(tidStart + j));
    return {
      _id: sessionId(idx),
      coachId: COACH_IDS[tpl.coachIdx],
      trainees: traineeIds,
      schedule: [{ day: tpl.day, startTime: tpl.start, endTime: tpl.end }],
      createdAt: new Date(now.getTime() - (12 - idx) * 86400000 * 10).toISOString(),
    };
  });

  const coachAttendance = [];
  const traineeAttendance = [];
  let ca = 0;
  let ta = 0;

  for (let dayOffset = 1; dayOffset <= 56; dayOffset += 1) {
    const date = addDaysToDateOnly(cairoToday, -dayOffset);
    if (dayOffset % 3 === 0) continue;

    sessions.forEach((session, sIdx) => {
      if ((dayOffset + sIdx) % 4 !== 0) return;
      const slot = session.schedule[0];
      const startNorm = normalizeTimeHHMM(slot.startTime);
      const endNorm = normalizeTimeHHMM(slot.endTime);
      const [py, pm, pd] = date.split("-").map(Number);
      const parsed = new Date(py, pm - 1, pd);
      const resolved = resolveScheduleOccurrence({
        schedule: session.schedule,
        parsedDate: parsed,
        startNorm,
        endNorm,
      });
      if (resolved.error) return;

      const { durationMinutes, durationHours } = durationFromTimes(resolved.startStored, resolved.endStored);
      const attended = dayOffset % 11 !== 0;
      const coachDoc = {
        _id: coachAttendanceId(ca++),
        sessionId: session._id,
        coachId: session.coachId,
        date,
        startTime: resolved.startStored,
        endTime: resolved.endStored,
        durationMinutes,
        durationHours,
        attended,
        note: attended ? "" : "Pool maintenance overrun — session shortened.",
        reason: attended ? "" : "Pool maintenance overrun — session shortened.",
        createdAt: new Date(`${date}T12:00:00`).toISOString(),
      };
      coachAttendance.push(coachDoc);

      const tids = session.trainees;
      tids.forEach((tid, ti) => {
        if (!attended && ti === 0) return;
        traineeAttendance.push({
          _id: traineeAttendanceId(ta++),
          sessionId: session._id,
          traineeId: tid,
          coachId: session.coachId,
          date,
          dayName: resolved.occurrenceDay,
          startTime: resolved.startStored,
          endTime: resolved.endStored,
          attended: attended && ti !== 2 ? true : ti === 2 ? dayOffset % 17 !== 0 : attended,
          note: "",
          reason: "",
          createdAt: new Date(`${date}T12:05:00`).toISOString(),
        });
      });
    });
  }

  const coachHours = {};
  coaches.forEach((c) => {
    coachHours[c._id] = 0;
  });
  coachAttendance.forEach((row) => {
    if (row.attended === false) return;
    coachHours[row.coachId] = (coachHours[row.coachId] || 0) + row.durationHours;
  });
  coaches.forEach((c) => {
    c.totalWorkingHours = Math.round((coachHours[c._id] || 0) * 100) / 100;
  });

  return {
    coaches,
    trainees,
    sessions,
    coachAttendance,
    traineeAttendance,
    demoPassword: "demo123",
  };
}

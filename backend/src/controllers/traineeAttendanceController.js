import mongoose from "mongoose";
import TraineeAttendance from "../models/TraineeAttendance.js";
import Session from "../models/Session.js";
import Trainee from "../models/Trainee.js";
import {
  normalizeScheduleTime,
  parseTimeToMinutes,
} from "../utils/scheduleTime.js";
import {
  buildOccurrenceKey,
  buildTraineeOccurrenceKey,
} from "../utils/occurrenceKey.js";
import {
  isValidDateOnly,
  parseDateOnlyToLocalDate,
  resolveScheduleOccurrence,
} from "../utils/sessionOccurrence.js";

const POPULATE_LIST = [
  { path: "traineeId", select: "name image level" },
  { path: "sessionId", select: "coachId schedule" },
  { path: "coachId", select: "name" },
];

function parsePagination(query) {
  const page =
    Math.max(1, Number.parseInt(String(query.page ?? "1"), 10)) || 1;

  const limitRaw =
    Number.parseInt(String(query.limit ?? "10"), 10) || 10;

  const limit = Math.min(100, Math.max(1, limitRaw));
  const skip = (page - 1) * limit;

  return { page, limit, skip };
}

function parseObjectIdOrNull(value) {
  if (
    value === undefined ||
    value === null ||
    String(value).trim() === ""
  ) {
    return null;
  }

  const id = String(value).trim();

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return false;
  }

  return new mongoose.Types.ObjectId(id);
}

function getTodayDateOnly() {
  const now = new Date();

  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function traineeBelongsToSession(session, traineeIdStr) {
  const trainees = Array.isArray(session.trainees)
    ? session.trainees
    : [];

  return trainees.some(
    (t) =>
      String(t) === traineeIdStr ||
      String(t?._id ?? t) === traineeIdStr
  );
}

/* ================= MARK ================= */

export async function markTraineeAttendance(req, res, next) {
  try {
    const {
      sessionId,
      traineeId,
      date,
      startTime,
      endTime,
      attended,
      note,
      reason,
    } = req.body ?? {};

    if (
      !sessionId ||
      !mongoose.Types.ObjectId.isValid(String(sessionId))
    ) {
      return res
        .status(400)
        .json({ message: "Valid sessionId is required" });
    }

    if (
      !traineeId ||
      !mongoose.Types.ObjectId.isValid(String(traineeId))
    ) {
      return res
        .status(400)
        .json({ message: "Valid traineeId is required" });
    }

    if (!date) {
      return res.status(400).json({ message: "date is required" });
    }

    const dateOnly = String(date).trim();

    if (!isValidDateOnly(dateOnly)) {
      return res
        .status(400)
        .json({ message: "date must be in YYYY-MM-DD format" });
    }

    const parsedDate = parseDateOnlyToLocalDate(dateOnly);

    if (!parsedDate) {
      return res.status(400).json({ message: "date must be valid" });
    }

    const startNorm = normalizeScheduleTime(startTime);
    const endNorm = normalizeScheduleTime(endTime);

    if (!startNorm || !endNorm) {
      return res.status(400).json({
        message: "startTime/endTime must be valid times (HH:mm)",
      });
    }

    const startMinutes = parseTimeToMinutes(startNorm);
    const endMinutes = parseTimeToMinutes(endNorm);

    if (startMinutes === null || endMinutes === null) {
      return res.status(400).json({
        message: "startTime/endTime must be valid times (HH:mm)",
      });
    }

    if (startMinutes === endMinutes) {
      return res.status(400).json({
        message: "startTime and endTime cannot be equal",
      });
    }

    const session = await Session.findById(sessionId)
      .select("coachId schedule trainees")
      .lean();

    if (!session) {
      return res.status(404).json({ message: "Session not found" });
    }

    const traineeIdStr = String(traineeId);

    if (!traineeBelongsToSession(session, traineeIdStr)) {
      return res.status(400).json({
        message: "Trainee is not assigned to this session",
      });
    }

    const schedule = Array.isArray(session.schedule)
      ? session.schedule
      : [];

    const resolved = resolveScheduleOccurrence({
      schedule,
      parsedDate,
      startNorm,
      endNorm,
    });

    if (resolved.error) {
      return res.status(400).json({ message: resolved.error });
    }

    const { occurrenceDay, startStored, endStored } = resolved;

    const attendedValue = attended === false ? false : true;
    const reasonValue = String(reason ?? note ?? "").trim();

    const payload = {
      sessionId,
      traineeId,
      coachId: session.coachId ?? null,
      date: dateOnly,
      dayName: occurrenceDay,
      startTime: startStored,
      endTime: endStored,
      attended: attendedValue,
      note: reasonValue,
      reason: reasonValue,
    };

    const doc = await TraineeAttendance.findOneAndUpdate(
      {
        sessionId,
        traineeId,
        date: dateOnly,
        startTime: startStored,
      },
      { $set: payload },
      {
        new: true,
        upsert: true,
        runValidators: true,
      }
    )
      .populate(POPULATE_LIST)
      .lean();

    return res.status(200).json({
      message: "Trainee attendance saved",
      attendance: doc,
      occurrenceKey: buildOccurrenceKey(
        sessionId,
        dateOnly,
        startStored
      ),
      traineeOccurrenceKey: buildTraineeOccurrenceKey(
        traineeId,
        sessionId,
        dateOnly,
        startStored
      ),
    });
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(409).json({
        message:
          "Could not save trainee attendance (duplicate key)",
      });
    }

    return next(err);
  }
}

/* ================= GET BY DATE ================= */

export async function getTraineeAttendanceByDate(req, res, next) {
  try {
    const dateOnly = req.query.date
      ? String(req.query.date).trim()
      : getTodayDateOnly();

    if (!isValidDateOnly(dateOnly)) {
      return res.status(400).json({
        message: "date query must be in YYYY-MM-DD format",
      });
    }

    const records = await TraineeAttendance.find({ date: dateOnly })
      .populate(POPULATE_LIST)
      .lean();

    const statusByKey = Object.fromEntries(
      records.map((record) => {
        const tid = record.traineeId?._id ?? record.traineeId;
        const sid = record.sessionId?._id ?? record.sessionId;

        const key = buildTraineeOccurrenceKey(
          tid,
          sid,
          dateOnly,
          record.startTime
        );

        const attendedValue =
          record.attended === false ? false : true;

        const storedReason = record.reason ?? record.note ?? "";

        return [
          key,
          {
            attended: attendedValue,
            note: storedReason,
            reason: storedReason,
          },
        ];
      })
    );

    return res.json({
      date: dateOnly,
      items: records,
      statusByKey,
    });
  } catch (err) {
    return next(err);
  }
}

/* ================= HISTORY ================= */

export async function getTraineeAttendanceHistory(req, res, next) {
  try {
    const { startDate, endDate, status } = req.query;
    const { page, limit } = parsePagination(req.query);

    const coachId = parseObjectIdOrNull(req.query.coachId);
    const sessionId = parseObjectIdOrNull(req.query.sessionId);
    const traineeId = parseObjectIdOrNull(req.query.traineeId);

    if (coachId === false)
      return res.status(400).json({ message: "coachId must be valid" });

    if (sessionId === false)
      return res.status(400).json({ message: "sessionId must be valid" });

    if (traineeId === false)
      return res.status(400).json({ message: "traineeId must be valid" });

    const filter = {};

    if (coachId) filter.coachId = coachId;
    if (sessionId) filter.sessionId = sessionId;
    if (traineeId) filter.traineeId = traineeId;

    if (status) {
      const statusRaw = String(status).trim().toLowerCase();

      if (["present", "attended"].includes(statusRaw)) {
        filter.$or = [
          { attended: true },
          { attended: { $exists: false } },
        ];
      } else if (
        ["absent", "not_attended"].includes(statusRaw)
      ) {
        filter.attended = false;
      } else if (statusRaw !== "all") {
        return res.status(400).json({
          message:
            "status must be attended, absent, or all",
        });
      }
    }

    if (startDate || endDate) {
      const range = {};

      if (startDate) range.$gte = String(startDate).trim();
      if (endDate) range.$lte = String(endDate).trim();

      filter.date = range;
    }

    const totalItems = await TraineeAttendance.countDocuments(filter);

    const totalPages = Math.max(
      1,
      Math.ceil(totalItems / limit)
    );

    const currentPage = Math.min(page, totalPages);

    const records = await TraineeAttendance.find(filter)
      .sort({ date: -1, startTime: -1, createdAt: -1 })
      .skip((currentPage - 1) * limit)
      .limit(limit)
      .populate(POPULATE_LIST)
      .lean();

    return res.json({
      records,
      currentPage,
      totalPages,
      totalItems,
    });
  } catch (err) {
    return next(err);
  }
}

/* ================= BY SESSION ================= */

export async function getTraineeAttendanceBySession(req, res, next) {
  try {
    const sessionIdRaw = req.query.sessionId;

    if (
      !sessionIdRaw ||
      !mongoose.Types.ObjectId.isValid(String(sessionIdRaw))
    ) {
      return res.status(400).json({
        message: "Valid sessionId query is required",
      });
    }

    const filter = {
      sessionId: new mongoose.Types.ObjectId(String(sessionIdRaw)),
    };

    if (req.query.date) {
      filter.date = String(req.query.date).trim();
    }

    if (req.query.startTime) {
      const normalized = normalizeScheduleTime(
        req.query.startTime
      );

      if (!normalized) {
        return res.status(400).json({
          message: "Invalid startTime",
        });
      }

      filter.startTime = normalized;
    }

    const records = await TraineeAttendance.find(filter)
      .sort({ date: -1, startTime: -1 })
      .populate(POPULATE_LIST)
      .lean();

    return res.json({
      sessionId: String(sessionIdRaw),
      records,
    });
  } catch (err) {
    return next(err);
  }
}

/* ================= SUMMARY ================= */

export async function getTraineeAttendanceSummary(req, res, next) {
  try {
    const { traineeId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(String(traineeId))) {
      return res.status(400).json({
        message: "Invalid trainee id",
      });
    }

    const exists = await Trainee.findById(traineeId)
      .select("_id")
      .lean();

    if (!exists) {
      return res.status(404).json({
        message: "Trainee not found",
      });
    }

    const counts = await TraineeAttendance.aggregate([
      {
        $match: {
          traineeId: new mongoose.Types.ObjectId(String(traineeId)),
        },
      },
      {
        $group: {
          _id: null,
          totalRecorded: { $sum: 1 },
          attendedSessions: {
            $sum: {
              $cond: [{ $eq: ["$attended", false] }, 0, 1],
            },
          },
          absentSessions: {
            $sum: {
              $cond: [{ $eq: ["$attended", false] }, 1, 0],
            },
          },
        },
      },
    ]);

    const row = counts[0] || {
      totalRecorded: 0,
      attendedSessions: 0,
      absentSessions: 0,
    };

    const totalRecorded = Number(row.totalRecorded) || 0;
    const attendedSessions = Number(row.attendedSessions) || 0;
    const absentSessions = Number(row.absentSessions) || 0;

    const attendancePercentage =
      totalRecorded > 0
        ? Math.round((attendedSessions / totalRecorded) * 10000) /
          100
        : 0;

    return res.json({
      traineeId: String(traineeId),
      totalRecordedSessions: totalRecorded,
      totalAttendedSessions: attendedSessions,
      totalAbsentSessions: absentSessions,
      attendancePercentage,
    });
  } catch (err) {
    return next(err);
  }
}
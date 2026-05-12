import mongoose from "mongoose";
import Attendance from "../models/Attendance.js";
import TraineeAttendance from "../models/TraineeAttendance.js";
import Coach from "../models/Coach.js";
import Session from "../models/Session.js";
import { normalizeScheduleTime, parseTimeToMinutes } from "../utils/scheduleTime.js";
import { buildOccurrenceKey } from "../utils/occurrenceKey.js";
import {
  isValidDateOnly,
  parseDateOnlyToLocalDate,
  resolveScheduleOccurrence,
} from "../utils/sessionOccurrence.js";

function parsePagination(query) {
  const page = Math.max(1, Number.parseInt(String(query.page ?? "1"), 10) || 1);
  const limitRaw = Number.parseInt(String(query.limit ?? "10"), 10) || 10;
  const limit = Math.min(100, Math.max(1, limitRaw));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
}

function parseObjectIdOrNull(value) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const id = String(value).trim();
  if (!mongoose.Types.ObjectId.isValid(id)) return false;
  return new mongoose.Types.ObjectId(id);
}

function calculateDuration(startTime, endTime) {
  const start = parseTimeToMinutes(startTime);
  const end = parseTimeToMinutes(endTime);

  if (start === null || end === null) {
    return { durationMinutes: 0, durationHours: 0 };
  }

  let durationMinutes = end - start;

  if (durationMinutes <= 0) {
    durationMinutes += 24 * 60;
  }

  const durationHours = durationMinutes / 60;

  return { durationMinutes, durationHours };
}

function getTodayDateOnly() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

export async function markAttendance(req, res, next) {
  try {
    const { sessionId, date, startTime, endTime, attended, note, reason } = req.body ?? {};

    if (!sessionId || !mongoose.Types.ObjectId.isValid(String(sessionId))) {
      return res.status(400).json({ message: "Valid sessionId is required" });
    }

    if (!date) {
      return res.status(400).json({ message: "date is required" });
    }

    const dateOnly = String(date).trim();

    if (!isValidDateOnly(dateOnly)) {
      return res.status(400).json({ message: "date must be in YYYY-MM-DD format" });
    }

    const parsedDate = parseDateOnlyToLocalDate(dateOnly);

    if (!parsedDate) {
      return res.status(400).json({ message: "date must be valid" });
    }

    const startNorm = normalizeScheduleTime(startTime);
    const endNorm = normalizeScheduleTime(endTime);

    if (!startNorm || !endNorm) {
      return res.status(400).json({
        message: "startTime/endTime must be valid times (e.g. HH:mm)",
      });
    }

    const startMinutes = parseTimeToMinutes(startNorm);
    const endMinutes = parseTimeToMinutes(endNorm);

    if (startMinutes === null || endMinutes === null) {
      return res.status(400).json({
        message: "startTime/endTime must be valid times (e.g. HH:mm)",
      });
    }

    if (endMinutes === startMinutes) {
      return res.status(400).json({
        message: "startTime and endTime cannot be equal",
      });
    }

    const session = await Session.findById(sessionId)
      .select("coachId schedule")
      .lean();

    if (!session) {
      return res.status(404).json({ message: "Session not found" });
    }

    const schedule = Array.isArray(session.schedule) ? session.schedule : [];

    const resolved = resolveScheduleOccurrence({
      schedule,
      parsedDate,
      startNorm,
      endNorm,
    });

    if (resolved.error) {
      return res.status(400).json({ message: resolved.error });
    }

    const { startStored, endStored } = resolved;

    const existing = await Attendance.findOne({
      sessionId,
      date: dateOnly,
      startTime: startStored,
    }).lean();

    if (existing) {
      return res.status(409).json({
        message: "Attendance already marked for this occurrence",
      });
    }

    const { durationMinutes, durationHours } = calculateDuration(startStored, endStored);
    const attendedValue = attended === false ? false : true;
    const reasonValue = String(reason ?? note ?? "").trim();

    if (attendedValue) {
      const coachUpdated = await Coach.findByIdAndUpdate(
        session.coachId,
        { $inc: { totalWorkingHours: durationHours } },
        { new: true },
      )
        .select("_id name totalWorkingHours")
        .lean();

      if (!coachUpdated) {
        return res.status(400).json({
          message: "Session coach not found",
        });
      }
    }

    const attendance = await Attendance.create({
      sessionId,
      coachId: session.coachId,
      date: dateOnly,
      startTime: startStored,
      endTime: endStored,
      durationMinutes,
      durationHours,
      attended: attendedValue,
      note: reasonValue,
      reason: reasonValue,
    });

    const populated = await Attendance.findById(attendance._id)
      .populate({
        path: "sessionId",
        select: "coachId schedule",
      })
      .populate({
        path: "coachId",
        select: "name totalWorkingHours",
      })
      .lean();

    return res.status(201).json({
      message: "Attendance marked",
      attendance: populated,
      occurrenceKey: buildOccurrenceKey(sessionId, dateOnly, startStored),
    });
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(409).json({
        message: "Attendance already marked for this occurrence",
      });
    }

    return next(err);
  }
}

export async function getAttendanceByDate(req, res, next) {
  try {
    const dateOnly = req.query.date
      ? String(req.query.date).trim()
      : getTodayDateOnly();

    if (!isValidDateOnly(dateOnly)) {
      return res.status(400).json({
        message: "date query must be in YYYY-MM-DD format",
      });
    }

    const records = await Attendance.find({ date: dateOnly })
      .populate({
        path: "sessionId",
        select: "coachId",
      })
      .populate({
        path: "coachId",
        select: "name",
      })
      .lean();

    const markedKeys = records.map((record) =>
      buildOccurrenceKey(
        record.sessionId?._id ?? record.sessionId,
        dateOnly,
        record.startTime,
      ),
    );

    const statusByKey = Object.fromEntries(
      records.map((record) => {
        const key = buildOccurrenceKey(
          record.sessionId?._id ?? record.sessionId,
          dateOnly,
          record.startTime,
        );

        const attendedValue = record.attended === false ? false : true;
        const storedReason = record.reason ?? record.note ?? "";

        return [
          key,
          {
            attended: attendedValue,
            note: storedReason,
            reason: storedReason,
          },
        ];
      }),
    );

    return res.json({
      date: dateOnly,
      items: records,
      markedKeys,
      statusByKey,
    });
  } catch (err) {
    return next(err);
  }
}

export async function getAllAttendance(req, res, next) {
  try {
    const { startDate, endDate, status } = req.query;
    const { page, limit } = parsePagination(req.query);

    const coachId = parseObjectIdOrNull(req.query.coachId);

    if (coachId === false) {
      return res.status(400).json({
        message: "coachId must be valid",
      });
    }

    const sessionId = parseObjectIdOrNull(req.query.sessionId);

    if (sessionId === false) {
      return res.status(400).json({
        message: "sessionId must be valid",
      });
    }

    const filter = {};

    if (coachId) filter.coachId = coachId;
    if (sessionId) filter.sessionId = sessionId;

    if (status) {
      const statusRaw = String(status).trim().toLowerCase();

      if (statusRaw === "attended") {
        filter.$or = [{ attended: true }, { attended: { $exists: false } }];
      } else if (statusRaw === "not_attended") {
        filter.attended = false;
      } else if (statusRaw !== "all") {
        return res.status(400).json({
          message: "status must be attended, not_attended, or all",
        });
      }
    }

    if (startDate || endDate) {
      const range = {};

      if (startDate) {
        const from = String(startDate).trim();

        if (!isValidDateOnly(from)) {
          return res.status(400).json({
            message: "startDate must be in YYYY-MM-DD format",
          });
        }

        range.$gte = from;
      }

      if (endDate) {
        const to = String(endDate).trim();

        if (!isValidDateOnly(to)) {
          return res.status(400).json({
            message: "endDate must be in YYYY-MM-DD format",
          });
        }

        range.$lte = to;
      }

      filter.date = range;
    }

    const totalItems = await Attendance.countDocuments(filter);
    const totalPages = Math.max(1, Math.ceil(totalItems / limit));
    const currentPage = Math.min(page, totalPages);
    const resolvedSkip = (currentPage - 1) * limit;

    const records = await Attendance.find(filter)
      .sort({ date: -1, startTime: -1, createdAt: -1 })
      .skip(resolvedSkip)
      .limit(limit)
      .populate({
        path: "coachId",
        select: "name",
      })
      .populate({
        path: "sessionId",
        select: "coachId schedule",
      })
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

export async function getCoachPayrollSummary(req, res, next) {
  try {
    const { startDate, endDate } = req.query;

    const match = {
      $or: [{ attended: true }, { attended: { $exists: false } }],
    };

    if (startDate || endDate) {
      const range = {};

      if (startDate) {
        const from = String(startDate).trim();

        if (!isValidDateOnly(from)) {
          return res.status(400).json({
            message: "startDate must be in YYYY-MM-DD format",
          });
        }

        range.$gte = from;
      }

      if (endDate) {
        const to = String(endDate).trim();

        if (!isValidDateOnly(to)) {
          return res.status(400).json({
            message: "endDate must be in YYYY-MM-DD format",
          });
        }

        range.$lte = to;
      }

      match.date = range;

      if (range.$gte && range.$lte && range.$gte > range.$lte) {
        return res.status(400).json({
          message: "startDate must be before or equal to endDate",
        });
      }
    }

    const summary = await Attendance.aggregate([
      { $match: match },
      {
        $group: {
          _id: "$coachId",
          totalMinutes: {
            $sum: {
              $ifNull: [
                "$durationMinutes",
                { $round: [{ $multiply: ["$durationHours", 60] }, 0] },
              ],
            },
          },
          totalHours: { $sum: "$durationHours" },
        },
      },
      {
        $lookup: {
          from: "coaches",
          localField: "_id",
          foreignField: "_id",
          as: "coach",
        },
      },
      {
        $project: {
          _id: 0,
          coachId: "$_id",
          coachName: {
            $ifNull: [{ $arrayElemAt: ["$coach.name", 0] }, "Unknown Coach"],
          },
          totalMinutes: 1,
          totalHours: { $round: ["$totalHours", 2] },
          totalHoursFormatted: {
            $concat: [
              { $toString: { $floor: { $divide: ["$totalMinutes", 60] } } },
              "h ",
              { $toString: { $mod: ["$totalMinutes", 60] } },
              "m",
            ],
          },
        },
      },
      { $sort: { totalHours: -1, coachName: 1 } },
    ]);

    return res.json(summary);
  } catch (err) {
    return next(err);
  }
}

export async function clearCoachAttendance(req, res, next) {
  try {
    await Attendance.deleteMany({});
    await Coach.updateMany({}, { $set: { totalWorkingHours: 0 } });

    return res.json({
      message: "Coach attendance cleared successfully",
    });
  } catch (err) {
    return next(err);
  }
}

export async function clearTraineeAttendance(req, res, next) {
  try {
    await TraineeAttendance.deleteMany({});

    return res.json({
      message: "Trainee attendance cleared successfully",
    });
  } catch (err) {
    return next(err);
  }
}

export async function getAttendanceBySession(req, res, next) {
  try {
    const summary = await Attendance.aggregate([
      {
        $group: {
          _id: "$sessionId",
          totalMinutes: {
            $sum: {
              $ifNull: [
                "$durationMinutes",
                { $round: [{ $multiply: ["$durationHours", 60] }, 0] },
              ],
            },
          },
          totalHours: { $sum: "$durationHours" },
          occurrences: { $sum: 1 },
        },
      },
      {
        $lookup: {
          from: "sessions",
          localField: "_id",
          foreignField: "_id",
          as: "session",
        },
      },
      {
        $project: {
          _id: 0,
          sessionId: "$_id",
          totalMinutes: 1,
          totalHours: { $round: ["$totalHours", 2] },
          occurrences: 1,
          schedule: {
            $ifNull: [{ $arrayElemAt: ["$session.schedule", 0] }, []],
          },
        },
      },
      { $sort: { totalHours: -1 } },
    ]);

    return res.json(summary);
  } catch (err) {
    return next(err);
  }
}
import mongoose from "mongoose";
import "../models/Session.js";
import Trainee, { TRAINEE_LEVELS } from "../models/Trainee.js";
import TraineeAttendance from "../models/TraineeAttendance.js";
import { escapeRegex } from "../utils/escapeRegex.js";
import cloudinary from "../config/cloudinary.js";

const ALLOWED_SORT_FIELDS = ["name", "age", "level", "createdAt"];
const MAX_PAGE_SIZE = 100;
const PHONE_REGEX = /^[0-9+\-() ]{7,20}$/;

const cloudinaryEnabled =
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET;

const populateSession = { path: "sessionId", select: "schedule" };

function buildImageUrl(req, file) {
  if (!file) return "";

  // Cloudinary
  if (file.path?.startsWith("http")) {
    return file.path;
  }

  // Local uploads
  const cleanPath = String(file.path).replace(/\\/g, "/");
  return `${req.protocol}://${req.get("host")}/${cleanPath}`;
}

function invalidIdResponse(res) {
  return res.status(400).json({ message: "Invalid trainee id" });
}

function parseTraineePayload(body) {
  const { name, age, level, phone, address } = body ?? {};

  if (!name || String(name).trim() === "") {
    return { error: "Name is required" };
  }

  if (age === undefined || age === null || age === "") {
    return { error: "Age is required" };
  }

  const ageNum = Number(age);
  if (!Number.isFinite(ageNum) || ageNum < 0) {
    return { error: "Age must be a valid non-negative number" };
  }

  const levelStr = String(level);

  if (!TRAINEE_LEVELS.includes(levelStr)) {
    return {
      error: `Level must be one of: ${TRAINEE_LEVELS.join(", ")}`,
    };
  }

  if (!phone || String(phone).trim() === "") {
    return { error: "Phone is required" };
  }

  const phoneStr = String(phone).trim();

  if (!PHONE_REGEX.test(phoneStr)) {
    return { error: "Phone must match format /^[0-9+\\-() ]{7,20}$/" };
  }

  if (!address || String(address).trim() === "") {
    return { error: "Address is required" };
  }

  const addressStr = String(address).trim();

  if (addressStr.length < 3) {
    return { error: "Address must be at least 3 characters" };
  }

  const data = {
    name: String(name).trim(),
    age: ageNum,
    level: levelStr,
    phone: phoneStr,
    address: addressStr,
  };

  if ("notes" in body) {
    data.notes = body.notes ? String(body.notes) : "";
  }

  if ("sessionId" in body) {
    const raw = body.sessionId;

    if (!raw) {
      data.sessionId = null;
    } else if (!mongoose.Types.ObjectId.isValid(String(raw))) {
      return { error: "Invalid session id" };
    } else {
      data.sessionId = new mongoose.Types.ObjectId(String(raw));
    }
  }

  return { data };
}

/* ================= CREATE ================= */

export async function createTrainee(req, res, next) {
  try {
    const parsed = parseTraineePayload(req.body);

    if (parsed.error) {
      return res.status(400).json({ message: parsed.error });
    }

    if (req.file) {
      parsed.data.image = buildImageUrl(req, req.file);
      parsed.data.imagePublicId = req.file.filename || "";
    }

    const trainee = await Trainee.create(parsed.data);

    const populated = await Trainee.findById(trainee._id)
      .populate(populateSession)
      .lean();

    return res.status(201).json(populated);
  } catch (err) {
    return next(err);
  }
}

/* ================= GET ALL ================= */

export async function getAllTrainees(req, res, next) {
  try {
    const { search, sortBy, order, level } = req.query;

    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const limit = Math.min(
      MAX_PAGE_SIZE,
      parseInt(req.query.limit || "10", 10)
    );

    const filter = {};

    if (search) {
      filter.name = {
        $regex: escapeRegex(search),
        $options: "i",
      };
    }

    if (level && TRAINEE_LEVELS.includes(String(level))) {
      filter.level = String(level);
    }

    const sortField = ALLOWED_SORT_FIELDS.includes(sortBy)
      ? sortBy
      : "createdAt";

    const sortOrder = order === "asc" ? 1 : -1;

    const totalItems = await Trainee.countDocuments(filter);
    const totalPages = Math.max(1, Math.ceil(totalItems / limit));

    const trainees = await Trainee.find(filter)
      .sort({ [sortField]: sortOrder })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate(populateSession)
      .lean();

    return res.json({
      trainees,
      currentPage: page,
      totalPages,
      totalItems,
    });
  } catch (err) {
    return next(err);
  }
}

/* ================= GET BY ID ================= */

export async function getTraineeById(req, res, next) {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return invalidIdResponse(res);
    }

    const trainee = await Trainee.findById(id)
      .populate(populateSession)
      .lean();

    if (!trainee) {
      return res.status(404).json({ message: "Trainee not found" });
    }

    const traineeObjectId = new mongoose.Types.ObjectId(String(id));

    const [aggRow] = await TraineeAttendance.aggregate([
      { $match: { traineeId: traineeObjectId } },
      {
        $group: {
          _id: null,
          totalRecordedSessions: { $sum: 1 },
          totalAttendedSessions: {
            $sum: {
              $cond: [{ $eq: ["$attended", false] }, 0, 1],
            },
          },
          totalAbsentSessions: {
            $sum: {
              $cond: [{ $eq: ["$attended", false] }, 1, 0],
            },
          },
        },
      },
    ]);

    const totalRecordedSessions = Number(aggRow?.totalRecordedSessions) || 0;
    const totalAttendedSessions = Number(aggRow?.totalAttendedSessions) || 0;
    const totalAbsentSessions = Number(aggRow?.totalAbsentSessions) || 0;

    const attendancePercentage =
      totalRecordedSessions > 0
        ? Math.round((totalAttendedSessions / totalRecordedSessions) * 10000) /
          100
        : 0;

    const attendanceHistory = await TraineeAttendance.find({
      traineeId: traineeObjectId,
    })
      .sort({ date: -1, startTime: -1, createdAt: -1 })
      .limit(100)
      .populate([
        {
          path: "sessionId",
          select: "schedule coachId",
          populate: {
            path: "coachId",
            select: "name",
          },
        },
        {
          path: "coachId",
          select: "name",
        },
      ])
      .lean();

    return res.json({
      ...trainee,
      attendanceStats: {
        totalRecordedSessions,
        totalAttendedSessions,
        totalAbsentSessions,
        attendancePercentage,
      },
      attendanceHistory,
    });
  } catch (err) {
    return next(err);
  }
}

/* ================= UPDATE ================= */

export async function updateTrainee(req, res, next) {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return invalidIdResponse(res);
    }

    const parsed = parseTraineePayload(req.body);

    if (parsed.error) {
      return res.status(400).json({ message: parsed.error });
    }

    const trainee = await Trainee.findById(id);

    if (!trainee) {
      return res.status(404).json({ message: "Trainee not found" });
    }

    Object.assign(trainee, parsed.data);

    if (req.file) {
      if (trainee.imagePublicId && cloudinaryEnabled) {
        await cloudinary.uploader.destroy(trainee.imagePublicId);
      }

      trainee.image = buildImageUrl(req, req.file);
      trainee.imagePublicId = req.file.filename || "";
    }

    await trainee.save();

    const populated = await Trainee.findById(id)
      .populate(populateSession)
      .lean();

    return res.json(populated);
  } catch (err) {
    return next(err);
  }
}

/* ================= DELETE ================= */

export async function deleteTrainee(req, res, next) {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return invalidIdResponse(res);
    }

    const trainee = await Trainee.findById(id);

    if (!trainee) {
      return res.status(404).json({ message: "Trainee not found" });
    }

    if (trainee.imagePublicId && cloudinaryEnabled) {
      await cloudinary.uploader.destroy(trainee.imagePublicId);
    }

    await trainee.deleteOne();

    return res.json({
      message: "Trainee deleted",
      id: trainee._id,
    });
  } catch (err) {
    return next(err);
  }
}
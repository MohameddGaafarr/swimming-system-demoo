import cloudinary from "../config/cloudinary.js";
import Coach from "../models/Coach.js";
import { escapeRegex } from "../utils/escapeRegex.js";
import Attendance from "../models/Attendance.js";
const PHONE_REGEX = /^[0-9+\-() ]{7,20}$/;
const ALLOWED_SORT_FIELDS = [
  "name",
  "age",
  "phone",
  "address",
  "totalWorkingHours",
  "createdAt",
];
const MAX_PAGE_SIZE = 100;

const cloudinaryEnabled =
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET;

function parseCoachPayload(body = {}) {
  const { name, age, phone, address, bio } = body;

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

  if (!phone || String(phone).trim() === "") {
    return { error: "Phone is required" };
  }

  const phoneStr = String(phone).trim();
  if (!PHONE_REGEX.test(phoneStr)) {
    return { error: "Phone format is invalid" };
  }

  if (!address || String(address).trim() === "") {
    return { error: "Address is required" };
  }

  const addressStr = String(address).trim();
  if (addressStr.length < 3) {
    return { error: "Address must be at least 3 characters" };
  }

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

function buildImageUrl(req, file) {
  if (!file) return "";

  // cloudinary
  if (file.path?.startsWith("http")) {
    return file.path;
  }

  // local uploads
  const cleanPath = String(file.path).replace(/\\/g, "/");
  return `${req.protocol}://${req.get("host")}/${cleanPath}`;
}

/**
 * Create Coach
 */
export async function createCoach(req, res, next) {
  try {
    const parsed = parseCoachPayload(req.body);

    if (parsed.error) {
      return res.status(400).json({ message: parsed.error });
    }

    const data = parsed.data;

    if (req.file) {
      data.image = buildImageUrl(req, req.file);
      data.imagePublicId = req.file.filename || "";
    }

    const coach = await Coach.create(data);

    res.status(201).json(coach);
  } catch (err) {
    next(err);
  }
}

/**
 * Get All Coaches
 */
export async function getAllCoaches(req, res, next) {
  try {
    const { search, sortBy, order } = req.query;
    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const limit = Math.min(
      MAX_PAGE_SIZE,
      parseInt(req.query.limit || "10", 10)
    );

    const filter = {};

    if (search && String(search).trim()) {
      const rx = {
        $regex: escapeRegex(String(search).trim()),
        $options: "i",
      };

      filter.$or = [{ name: rx }, { phone: rx }, { address: rx }];
    }

    const sortField = ALLOWED_SORT_FIELDS.includes(sortBy)
      ? sortBy
      : "createdAt";

    const sortOrder = order === "asc" ? 1 : -1;

    const totalItems = await Coach.countDocuments(filter);
    const totalPages = Math.max(1, Math.ceil(totalItems / limit));

    const coaches = await Coach.find(filter)
      .sort({ [sortField]: sortOrder })
      .skip((page - 1) * limit)
      .limit(limit);

    res.json({
      coaches,
      totalItems,
      totalPages,
      currentPage: page,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Get Coach By ID
 */
export async function getCoachById(req, res, next) {
  try {
    const coach = await Coach.findById(req.params.id);

    if (!coach) {
      return res.status(404).json({ message: "Coach not found" });
    }

    const attendanceHistory = await Attendance.find({
      coachId: coach._id,
    })
      .populate({
        path: "sessionId",
        populate: {
          path: "coachId",
          select: "name",
        },
      })
      .sort({ date: -1, createdAt: -1 })
      .lean();

    const totalRecordedSessions = attendanceHistory.length;
    const totalAttendedSessions = attendanceHistory.filter(
      (row) => row.attended === true
    ).length;
    const totalAbsentSessions = attendanceHistory.filter(
      (row) => row.attended === false
    ).length;

    const attendancePercentage =
      totalRecordedSessions > 0
        ? (totalAttendedSessions / totalRecordedSessions) * 100
        : 0;

    res.json({
      ...coach.toObject(),
      attendanceStats: {
        totalRecordedSessions,
        totalAttendedSessions,
        totalAbsentSessions,
        attendancePercentage,
      },
      attendanceHistory,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Update Coach
 */
export async function updateCoach(req, res, next) {
  try {
    const parsed = parseCoachPayload(req.body);

    if (parsed.error) {
      return res.status(400).json({ message: parsed.error });
    }

    const coach = await Coach.findById(req.params.id);

    if (!coach) {
      return res.status(404).json({ message: "Coach not found" });
    }

    Object.assign(coach, parsed.data);

    if (req.file) {
      if (coach.imagePublicId && cloudinaryEnabled) {
        await cloudinary.uploader.destroy(coach.imagePublicId);
      }

      coach.image = buildImageUrl(req, req.file);
      coach.imagePublicId = req.file.filename || "";
    }

    await coach.save();

    res.json(coach);
  } catch (err) {
    next(err);
  }
}

/**
 * Delete Coach
 */
export async function deleteCoach(req, res, next) {
  try {
    const coach = await Coach.findById(req.params.id);

    if (!coach) {
      return res.status(404).json({ message: "Coach not found" });
    }

    if (coach.imagePublicId && cloudinaryEnabled) {
      await cloudinary.uploader.destroy(coach.imagePublicId);
    }

    await coach.deleteOne();

    res.json({ message: "Coach deleted successfully" });
  } catch (err) {
    next(err);
  }
}
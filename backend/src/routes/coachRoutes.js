import { Router } from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import {
  createCoach,
  deleteCoach,
  getAllCoaches,
  getCoachById,
  updateCoach,
} from "../controllers/coachController.js";

const router = Router();

/* ================= LOCAL MULTER CONFIG ================= */

const uploadDir = "uploads/coaches";

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, uniqueName);
  },
});

const fileFilter = (_req, file, cb) => {
  if (!file) return cb(null, true);

  if (file.mimetype.startsWith("image/")) {
    cb(null, true);
  } else {
    cb(new Error("Only image files are allowed"), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
});

/* ================= ROUTES ================= */

router.post("/", upload.single("image"), createCoach);

router.put("/:id", upload.single("image"), updateCoach);

router.get("/", getAllCoaches);

router.get("/:id", getCoachById);

router.delete("/:id", deleteCoach);

export default router;
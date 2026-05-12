import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";

import {
  createTrainee,
  deleteTrainee,
  getAllTrainees,
  getTraineeById,
  updateTrainee,
} from "../controllers/traineeController.js";

const router = Router();

/* ================= LOCAL MULTER CONFIG ================= */

const uploadDir = "uploads/trainees";

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

router.post("/", upload.single("image"), createTrainee);

router.put("/:id", upload.single("image"), updateTrainee);

router.get("/", getAllTrainees);

router.get("/:id", getTraineeById);

router.delete("/:id", deleteTrainee);

export default router;
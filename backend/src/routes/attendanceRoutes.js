import { Router } from "express";
import {
  clearCoachAttendance,
  clearTraineeAttendance,
  getAllAttendance,
  getAttendanceByDate,
  getAttendanceBySession,
  getCoachPayrollSummary,
  markAttendance,
} from "../controllers/attendanceController.js";

import {
  getTraineeAttendanceByDate,
  getTraineeAttendanceBySession,
  getTraineeAttendanceHistory,
  getTraineeAttendanceSummary,
  markTraineeAttendance,
} from "../controllers/traineeAttendanceController.js";

const router = Router();

/* TRAINEE ATTENDANCE */
router.post("/trainees", markTraineeAttendance);
router.get("/trainees/history", getTraineeAttendanceHistory);
router.get("/trainees/by-session", getTraineeAttendanceBySession);
router.get("/trainees/summary/:traineeId", getTraineeAttendanceSummary);
router.get("/trainees", getTraineeAttendanceByDate);
router.delete("/clear/trainees", clearTraineeAttendance);

/* COACH ATTENDANCE */
router.get("/history", getAllAttendance);
router.get("/payroll-summary", getCoachPayrollSummary);
router.get("/by-session-summary", getAttendanceBySession);
router.delete("/clear/coaches", clearCoachAttendance);
router.post("/", markAttendance);
router.get("/", getAttendanceByDate);

export default router;
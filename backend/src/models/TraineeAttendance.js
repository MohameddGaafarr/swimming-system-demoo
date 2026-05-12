import mongoose from "mongoose";

const traineeAttendanceSchema = new mongoose.Schema(
  {
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Session",
      required: true,
      index: true,
    },
    traineeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Trainee",
      required: true,
      index: true,
    },
    coachId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Coach",
      default: null,
      index: true,
    },
    date: { type: String, required: true, trim: true, index: true },
    dayName: { type: String, required: true, trim: true },
    startTime: { type: String, required: true, trim: true },
    endTime: { type: String, required: true, trim: true },
    attended: { type: Boolean, required: true, default: true },
    note: { type: String, default: "", trim: true },
    reason: { type: String, default: "", trim: true },
  },
  { timestamps: true },
);

traineeAttendanceSchema.index({ sessionId: 1, traineeId: 1, date: 1, startTime: 1 }, { unique: true });
traineeAttendanceSchema.index({ traineeId: 1, date: -1 });
traineeAttendanceSchema.index({ sessionId: 1, date: -1 });

export default mongoose.model("TraineeAttendance", traineeAttendanceSchema);

import "dotenv/config";
import express from "express";
import cors from "cors";
import morgan from "morgan";

import { connectDB } from "./config/db.js";
import { seedDefaultManager } from "./utils/seedManager.js";

import authRoutes from "./routes/authRoutes.js";
import { authMiddleware } from "./middleware/authMiddleware.js";

import attendanceRoutes from "./routes/attendanceRoutes.js";
import coachRoutes from "./routes/coachRoutes.js";
import sessionRoutes from "./routes/sessionRoutes.js";
import traineeRoutes from "./routes/traineeRoutes.js";

const app = express();

const PORT = Number.parseInt(String(process.env.PORT || "8080"), 10) || 8080;

function parseAllowedOriginsList() {
  const fromEnv = String(process.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const devDefaults =
    process.env.NODE_ENV !== "production"
      ? ["http://localhost:5173", "http://127.0.0.1:5173"]
      : [];

  const legacy = ["https://swimax-system.vercel.app"];

  return [...new Set([...devDefaults, ...fromEnv, ...legacy])];
}

const allowedOriginSet = new Set(parseAllowedOriginsList());

function isOriginAllowed(origin) {
  if (!origin) return true;
  try {
    const { hostname } = new URL(origin);
    if (allowedOriginSet.has(origin)) return true;
    if (hostname.endsWith(".vercel.app")) return true;
    return false;
  } catch {
    return false;
  }
}

const corsOptions = {
  origin(origin, callback) {
    if (isOriginAllowed(origin)) {
      return callback(null, true);
    }
    console.warn("Blocked by CORS:", origin);
    return callback(null, false);
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

app.use(express.json());

app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));

app.use("/uploads", express.static("uploads"));

app.get("/", (_req, res) => {
  res.send("API is running 🚀");
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "swimming-academy-api" });
});

app.use("/api/auth", authRoutes);

const protectedApi = express.Router();
protectedApi.use(authMiddleware);

protectedApi.get("/health", (req, res) => {
  res.json({
    ok: true,
    user: req.user?.username ?? null,
  });
});

protectedApi.use("/coaches", coachRoutes);
protectedApi.use("/sessions", sessionRoutes);
protectedApi.use("/trainees", traineeRoutes);
protectedApi.use("/attendance", attendanceRoutes);

app.use("/api", protectedApi);

app.use((_req, res) => {
  res.status(404).json({ message: "Not found" });
});

app.use((err, _req, res, _next) => {
  console.error("ERROR:", err);

  res.status(err.status || 500).json({
    message: err.message || "Internal server error",
  });
});

async function start() {
  try {
    if (!process.env.JWT_SECRET) {
      throw new Error("JWT_SECRET is missing");
    }

    await connectDB();

    await seedDefaultManager();

    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server listening on port ${PORT}`);
    });
  } catch (err) {
    console.error("START ERROR:", err);
    process.exit(1);
  }
}

start();

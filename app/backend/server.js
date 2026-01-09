require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

// AUTH
const { handleLogin, authMiddleware } = require("./auth");

// ROUTES
const dashboardRouter = require("./routes/dashboard");
const logsRouter = require("./routes/logs");
const settingsRouter = require("./routes/settings");
const usersRouter = require("./routes/users");
const statusRouter = require("./routes/status");
const versionRouter = require("./routes/version");

const app = express();

// -------------------------------------------------------------
// Security + Parsing
// -------------------------------------------------------------
app.use(helmet());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// -------------------------------------------------------------
// CORS allowlist (PoC-offen, wenn CORS_ORIGINS leer)
// Beispiel .env: CORS_ORIGINS=http://localhost:8080,http://127.0.0.1:8080
// -------------------------------------------------------------
const allowedOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: function (origin, cb) {
      if (!origin) return cb(null, true); // curl / server-to-server
      if (allowedOrigins.length === 0) return cb(null, true); // PoC-Default: offen
      return allowedOrigins.includes(origin)
        ? cb(null, true)
        : cb(new Error("CORS blocked"));
    },
  })
);

// -------------------------------------------------------------
// Rate-Limit nur für Login (bcrypt schützt nicht vor DoS)
// -------------------------------------------------------------
const loginLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 Minute
  max: 10, // 10 Versuche/Minute/IP
  standardHeaders: true,
  legacyHeaders: false,
});

// -------------------------------------------------------------
// Public Endpoints
// -------------------------------------------------------------
app.post("/api/auth/login", loginLimiter, handleLogin);

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Version bewusst public (wenn du es privat willst, einfach nach authMiddleware verschieben)
app.use("/api/version", versionRouter);

// -------------------------------------------------------------
// Auth Default: alles unter /api ist privat, außer was oben gemountet ist
// -------------------------------------------------------------
app.use("/api", authMiddleware());

// -------------------------------------------------------------
// Private API Routes
// -------------------------------------------------------------
app.use("/api/dashboard", dashboardRouter);
app.use("/api/logs", logsRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/users", usersRouter);
app.use("/api/status", statusRouter);

// -------------------------------------------------------------
// STATIC REACT BUILD
// -------------------------------------------------------------
const publicPath = path.join(__dirname, "public");
app.use(express.static(publicPath));

// -------------------------------------------------------------
// SPA FALLBACK
// -------------------------------------------------------------
app.get("*", (req, res) => {
  res.sendFile(path.join(publicPath, "index.html"));
});

// -------------------------------------------------------------
// SERVER START
// -------------------------------------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Backend läuft auf Port ${PORT}`);
});

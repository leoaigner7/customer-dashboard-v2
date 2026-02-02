// Lädt .env variablen aus der .env datei
require("dotenv").config();
// express webserver
const express = require("express");
//cors-Middleware (frontend + backend)
const cors = require("cors");
const path = require("path");
// Helmet setzt wichtige HTTP-Security-Header
const helmet = require("helmet");
//Rate-Limiter gegen Brute-Force oder DoS
const rateLimit = require("express-rate-limit");

const { handleLogin, authMiddleware } = require("./auth");

 //routen importieren
const dashboardRouter = require("./routes/dashboard");
const logsRouter = require("./routes/logs");
const settingsRouter = require("./routes/settings");
const usersRouter = require("./routes/users");
const statusRouter = require("./routes/status");
const versionRouter = require("./routes/version");

const app = express();

// Security + Request-Parsing
app.use(helmet());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Erlaubt Origins aus der ENV lesen
// Bsp: CORS_ORIGINS=http://localhost:8080,http://127.0.0.1:8080
const allowedOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

  //Cors-Middleware registrieren
app.use(
  cors({
    origin: function (origin, cb) {
      if (!origin) return cb(null, true); // curl / server-to-server
      //keine allowlist gesetzt -> alles erlauben
      if (allowedOrigins.length === 0) return cb(null, true); 

      return allowedOrigins.includes(origin)
        ? cb(null, true)
        : cb(new Error("CORS blocked"));
    },
  })
);

// Schutz gegen Brute-Force Angriffe auf den Login
const loginLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 Minute
  max: 10, // 10 Versuche/Minute/IP
  standardHeaders: true,
  legacyHeaders: false,
});

// Login Endpunkte (öffentlich, aber rate-limitiert)
app.post("/api/auth/login", loginLimiter, handleLogin);
// Healthcheck z.B. Docker 
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Version bewusst public (wenn man es privat will, einfach nach authMiddleware verschieben)
app.use("/api/version", versionRouter);


// Auth Default: alles unter /api ist privat, außer was oben gemountet ist
app.use("/api", authMiddleware());

// Private API Routes
app.use("/api/dashboard", dashboardRouter);
app.use("/api/logs", logsRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/users", usersRouter);
app.use("/api/status", statusRouter);

// STATIC REACT BUILD
const publicPath = path.join(__dirname, "public");
app.use(express.static(publicPath));

// SPA FALLBACK
app.get("*", (req, res) => {
  res.sendFile(path.join(publicPath, "index.html"));
});

// SERVER START
// Port aus ENV oder Fallback auf 3000
const PORT = process.env.PORT || 3000;
// Seerver starten
app.listen(PORT, () => {
  console.log(`Backend läuft auf Port ${PORT}`);
});

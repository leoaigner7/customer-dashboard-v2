require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");

// Import backend routes
const dashboardRouter = require("./routes/dashboard");
const logsRouter = require("./routes/logs");
const settingsRouter = require("./routes/settings");
const usersRouter = require("./routes/users");
const statusRouter = require("./routes/status");
const versionRouter = require("./routes/version");

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// API ROUTES
app.use("/api/dashboard", dashboardRouter);
app.use("/api/logs", logsRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/users", usersRouter);
app.use("/api/status", statusRouter);
app.use("/api/version", versionRouter);

// HEALTHCHECK
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ----------------------------
// SERVE REACT FRONTEND BUILD
// ----------------------------

const publicPath = path.join(__dirname, "public");
app.use(express.static(publicPath));

// Fallback für React Router
app.get("*", (req, res) => {
  res.sendFile(path.join(publicPath, "index.html"));
});

// ----------------------------
// START SERVER (FIX: ALWAYS 3000 IN DOCKER)
// ----------------------------
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Backend läuft auf Port ${PORT}`);
});

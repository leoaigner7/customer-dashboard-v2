require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");

// AUTH — bleibt an Ort & Stelle
const { handleLogin, authMiddleware } = require("./auth");

// ROUTES
const dashboardRouter = require("./routes/dashboard");
const logsRouter = require("./routes/logs");
const settingsRouter = require("./routes/settings");
const usersRouter = require("./routes/users");
const statusRouter = require("./routes/status");
const versionRouter = require("./routes/version");

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// ----------------------------
// AUTH ROUTE (NEU!!!)
// ----------------------------
app.post("/api/auth/login", handleLogin);

// Optional — Token-Check für private APIs:
// app.use("/api/*", authMiddleware());

// ----------------------------
// API ROUTES
// ----------------------------
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
// STATIC REACT BUILD
// ----------------------------
const publicPath = path.join(__dirname, "dist");
app.use(express.static(publicPath));

// ----------------------------
// SPA FALLBACK
// ----------------------------
app.get("*", (req, res) => {
  res.sendFile(path.join(publicPath, "index.html"));
});

// ----------------------------
// SERVER START
// ----------------------------
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Backend läuft auf Port ${PORT}`);
});

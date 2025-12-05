require("dotenv").config();

const express = require("express");
const cors = require("cors");
const db = require("./db");

const dashboardRouter = require("./routes/dashboard");
const logsRouter = require("./routes/logs");
const settingsRouter = require("./routes/settings");
const usersRouter = require("./routes/users");
const statusRouter = require("./routes/status"); // NEU

const app = express();

// Middlewares
app.use(cors());
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: false }));

// API Routes
app.use("/api/dashboard", dashboardRouter);
app.use("/api/logs", logsRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/users", usersRouter);
app.use("/api/status", statusRouter); // NEU

// Default healthcheck
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Server-Start
const PORT = process.env.PORT || process.env.APP_PORT || 3000;
app.listen(PORT, () => {
  console.log(`Backend läuft auf Port ${PORT}`);
});

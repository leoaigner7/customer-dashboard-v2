const express = require("express");
const fs = require("fs");
const path = require("path");

const router = express.Router();

// Pfad des Statusfiles aus dem Daemon
const DEFAULT_STATUS_FILE =
  "C:\\CustomerDashboard\\logs\\update-status.json";

// Unterstützt Linux & Windows
function getStatusFilePath() {
  if (process.env.STATUS_FILE) {
    return process.env.STATUS_FILE;
  }
  return DEFAULT_STATUS_FILE;
}

// API: GET /api/status
router.get("/", (req, res) => {
  const statusFile = getStatusFilePath();

  let data = {
    installedVersion: null,
    latestVersion: null,
    lastResult: null,
    lastSource: null,
    lastError: null,
    lastCheckedAt: null,
    nextCheckAt: null,
    rollbackAvailable: null,
    health: null,
  };

  try {
    if (fs.existsSync(statusFile)) {
      const raw = fs.readFileSync(statusFile, "utf8");
      const parsed = JSON.parse(raw);

      data.installedVersion = parsed.currentVersion || null;
      data.latestVersion = parsed.latestVersion || null;
      data.lastResult = parsed.lastResult || null;
      data.lastSource = parsed.lastSource || null;
      data.lastError = parsed.lastError || null;
      data.lastCheckedAt = parsed.lastCheckedAt || null;
      data.rollbackAvailable =
        parsed.lastResult === "rollback" ||
        parsed.lastResult === "failed-rollback";

      // Nächster gepl. Lauf berechnen
      const interval =
        parseInt(process.env.DAEMON_INTERVAL_MS || "300000", 10) || 300000;
      if (parsed.lastCheckedAt) {
        const next = new Date(Date.parse(parsed.lastCheckedAt) + interval);
        data.nextCheckAt = next.toISOString();
      }

      // Health Information
      data.health = parsed.health || "unknown";
    }
  } catch (err) {
    return res.status(500).json({
      error: "Statusfile konnte nicht gelesen werden.",
      detail: err.message,
    });
  }

  res.json(data);
});

module.exports = router;

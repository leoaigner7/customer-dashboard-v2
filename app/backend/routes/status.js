const express = require("express");
// FileSystem wird verwendet um Datei zu lesen
const fs = require("fs");
// für saubere Pfadbehandlung (Plattformübergreifend)
const path = require("path");

const router = express.Router();
/**
 *  Standard Pfad zur Statusdatei (Windwows)
 *  wurde vom Daemon geschrieben
 *  infos über Updates und Systemzustand
 */ 
const DEFAULT_STATUS_FILE =
  "C:\\CustomerDashboard\\logs\\update-status.json";


  // Sucht Pfad zur Statusdatei
  // Win und Linux
function getStatusFilePath() {
  if (process.env.STATUS_FILE) {
    return process.env.STATUS_FILE;
  }
  return DEFAULT_STATUS_FILE;
}
// liefert aktuellen Status ans Frontend -> Daten kommen aus einer JSON Datei des Daemon nicht aus der DB
router.get("/", (req, res) => {
  const statusFile = getStatusFilePath();
// default 
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
    // prüfen ob statusdatei existiert
    if (fs.existsSync(statusFile)) {
      // Datei als Text lesen
      const raw = fs.readFileSync(statusFile, "utf8");
      // json Text in ein Objekt umwandeln
      const parsed = JSON.parse(raw);
      // werte aus Datei übernehmen (Fallback -> null)
      data.installedVersion = parsed.currentVersion || null;
      data.latestVersion = parsed.latestVersion || null;
      data.lastResult = parsed.lastResult || null;
      data.lastSource = parsed.lastSource || null;
      data.lastError = parsed.lastError || null;
      data.lastCheckedAt = parsed.lastCheckedAt || null;
      data.rollbackAvailable =
        parsed.lastResult === "rollback" ||
        parsed.lastResult === "failed-rollback";
      // nächstes Update berechnen (300000ms)
      const interval =
        parseInt(process.env.DAEMON_INTERVAL_MS || "300000", 10) || 300000;
      if (parsed.lastCheckedAt) {
        const next = new Date(Date.parse(parsed.lastCheckedAt) + interval);
        data.nextCheckAt = next.toISOString();
      }

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

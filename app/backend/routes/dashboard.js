// Express-Framework importiert (wird für HTTP-routen genutzt)
const express = require("express");
// Datenbank Instanz import. 
const db = require("../db");
// Einen neuen Router erstellen, um ROuten zu definieren
const router = express.Router();


// Liefert Daten für das Dashboard (aufruf vom Frontend unter /api/dashboard)
router.get("/", (req, res) => {
  // Dashboard Karten ( Anzahl Logs bspw.)
  //zählt Einträge in die jeweieligen TB
  const cards = [
    { id: 1, title: "Benutzer", value: db.prepare("SELECT COUNT(*) AS c FROM users").get().c },
    { id: 2, title: "Logs", value: db.prepare("SELECT COUNT(*) AS c FROM logs").get().c }
  ];

  // Letzten 5 Logs
  const recentLogs = db.prepare(
    "SELECT level, message, created_at FROM logs ORDER BY id DESC LIMIT 5"
  ).all();

  res.json({
    cards,
    recentLogs
  });
});
// Router exportieren ( Server eingebunden)
module.exports = router;

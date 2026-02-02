const express = require("express");
const db = require("../db");

const router = express.Router();

//Liefert log-Eintäge aus der DB 
router.get("/",  (req, res) => {
  try {
    const { limit = 200, level, since } = req.query;

    let query = `SELECT id, level, message, created_at FROM logs`;
    const params = [];

    if (level) {
      query += " WHERE level = ?";
      params.push(level);
    }

    if (since) {
      if (typeof since !== "string") {
        return res.status(400).json({ error: "since muss ein String sein" });
      }
      query += level ? " AND created_at > ?" : " WHERE created_at > ?";
      params.push(since);
    }

    // neuste Logs zuerst
    query += " ORDER BY created_at DESC LIMIT ?";
    const rawLimit = parseInt(limit, 10);
    const safeLimit = Number.isFinite(rawLimit)
      ? Math.min(Math.max(rawLimit, 1), 500)
      : 200;

    params.push(safeLimit);
    // SQL-Abfrage ausführen
    const rows = db.prepare(query).all(...params);
    //ergebnis als Json ans Frontend senden
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Logabfrage fehlgeschlagen", detail: err.message });
  }
});
// speichert Log-Eintrag in der DB
router.post("/", (req, res) => {
  try {
    const { level = "info", message } = req.body;


  if (typeof message !== "string" || message.trim().length === 0) {
      return res.status(400).json({ error: "message fehlt" });
    }
    // alle erlaubten Log-Level definieren
    const allowedLevels = new Set(["debug", "info", "warn", "error"]);
    // ungültige Level automatisch auf info setzen
    const safeLevel = allowedLevels.has(level) ? level : "info";
    // Message trimmen und auf 2000 zeichen setzen
    const safeMessage = message.trim().slice(0, 2000);

    //log eintrag in die DB schreiben
    db.prepare(
      `INSERT INTO logs (level, message, created_at)
       VALUES (?, ?, datetime('now'))`
    ).run(safeLevel, safeMessage);

    res.json({ status: "ok" });
  } catch (err) {
    res.status(500).json({ error: "Log konnte nicht gespeichert werden", detail: err.message });
  }
});

module.exports = router;

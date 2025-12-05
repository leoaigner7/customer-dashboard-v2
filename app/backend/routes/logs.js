const express = require("express");
const db = require("../db");

const router = express.Router();

// GET /api/logs
router.get("/", async (req, res) => {
  try {
    const { limit = 200, level, since } = req.query;

    let query = `SELECT id, level, message, created_at FROM logs`;
    const params = [];

    if (level) {
      query += " WHERE level = ?";
      params.push(level);
    }

    if (since) {
      query += level ? " AND created_at > ?" : " WHERE created_at > ?";
      params.push(since);
    }

    query += " ORDER BY created_at DESC LIMIT ?";
    params.push(parseInt(limit, 10));

    const rows = db.prepare(query).all(...params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Logabfrage fehlgeschlagen", detail: err.message });
  }
});

// POST /api/logs
router.post("/", (req, res) => {
  try {
    const { level = "info", message } = req.body;

    if (!message) {
      return res.status(400).json({ error: "message fehlt" });
    }

    db.prepare(
      `INSERT INTO logs (level, message, created_at)
       VALUES (?, ?, datetime('now'))`
    ).run(level, message);

    res.json({ status: "ok" });
  } catch (err) {
    res.status(500).json({ error: "Log konnte nicht gespeichert werden", detail: err.message });
  }
});

module.exports = router;

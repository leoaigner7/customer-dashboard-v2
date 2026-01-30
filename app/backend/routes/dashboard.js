const express = require("express");
const db = require("../db");
const router = express.Router();

router.get("/", (req, res) => {
  // Beispielkarten
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

module.exports = router;

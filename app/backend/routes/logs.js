const express = require("express");
const router = express.Router();
const { db } = require("../db");

router.get("/", (req, res) => {
  const logs = db.prepare("SELECT * FROM logs ORDER BY created_at DESC LIMIT 100").all();
  res.json(logs);
});

router.post("/", (req, res) => {
  const { level, message } = req.body;
  db.prepare("INSERT INTO logs (level, message) VALUES (?, ?)").run(level, message);
  res.json({ success: true });
});

module.exports = router;

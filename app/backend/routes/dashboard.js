const express = require("express");
const router = express.Router();
const { db } = require("../db");

// Beispiel: Dashboard-Daten
router.get("/", (req, res) => {
  const logs = db.prepare("SELECT COUNT(*) as logCount FROM logs").get();
  const users = db.prepare("SELECT COUNT(*) as userCount FROM users").get();

  res.json({
    users: users.userCount,
    logs: logs.logCount,
    status: "ok"
  });
});

module.exports = router;

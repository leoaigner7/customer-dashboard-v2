const express = require("express");
const router = express.Router();
const { db } = require("../db");

router.get("/", (req, res) => {
  const settings = db.prepare("SELECT * FROM settings WHERE id = 1").get();
  res.json(settings);
});

router.post("/", (req, res) => {
  const { theme, language } = req.body;

  db.prepare("UPDATE settings SET theme = ?, language = ? WHERE id = 1")
    .run(theme, language);

  res.json({ success: true });
});

module.exports = router;

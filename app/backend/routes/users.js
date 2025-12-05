const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const { db } = require("../db");

router.get("/", (req, res) => {
  const users = db.prepare("SELECT id, email, role FROM users").all();
  res.json(users);
});

router.post("/", (req, res) => {
  const { email, password, role } = req.body;

  const hash = bcrypt.hashSync(password, 10);

  db.prepare("INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)")
    .run(email, hash, role);

  res.json({ success: true });
});

module.exports = router;

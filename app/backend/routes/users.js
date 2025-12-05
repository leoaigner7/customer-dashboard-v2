const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../db");
const { authMiddleware } = require("../auth");

const router = express.Router();

// GET /api/users → Admin: Nutzertabelle abrufen
router.get("/", authMiddleware("admin"), (req, res) => {
  try {
    const users = db
      .prepare("SELECT id, email, role, created_at FROM users ORDER BY id DESC")
      .all();

    res.json(users);
  } catch (err) {
    res.status(500).json({ error: "Fehler beim Laden der Benutzer", detail: err.message });
  }
});

// POST /api/users → Admin: Benutzer anlegen
router.post("/", authMiddleware("admin"), async (req, res) => {
  const { email, password, role = "user" } = req.body;

  if (!email || !password)
    return res.status(400).json({ error: "email und password sind erforderlich" });

  try {
    const hash = await bcrypt.hash(password, 10);

    db.prepare(
      "INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)"
    ).run(email, hash, role);

    res.json({ status: "ok" });
  } catch (err) {
    if (err.message.includes("UNIQUE")) {
      return res.status(400).json({ error: "Email bereits vergeben" });
    }
    res.status(500).json({ error: "Fehler beim Erstellen", detail: err.message });
  }
});

// PUT /api/users/:id/password → User oder Admin: Passwort ändern
router.put("/:id/password", authMiddleware(), async (req, res) => {
  const userId = parseInt(req.params.id, 10);
  const { newPassword } = req.body;

  if (!newPassword)
    return res.status(400).json({ error: "newPassword fehlt" });

  try {
    // Nur Admin oder eigener Account
    if (req.user.role !== "admin" && req.user.id !== userId) {
      return res.status(403).json({ error: "Keine Berechtigung" });
    }

    const hash = await bcrypt.hash(newPassword, 10);

    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hash, userId);

    res.json({ status: "ok" });
  } catch (err) {
    res.status(500).json({ error: "Passwortänderung fehlgeschlagen", detail: err.message });
  }
});

// DELETE /api/users/:id → Admin: Benutzer löschen
router.delete("/:id", authMiddleware("admin"), (req, res) => {
  const userId = parseInt(req.params.id, 10);

  try {
    db.prepare("DELETE FROM users WHERE id = ?").run(userId);

    res.json({ status: "ok" });
  } catch (err) {
    res.status(500).json({ error: "Löschen fehlgeschlagen", detail: err.message });
  }
});

module.exports = router;

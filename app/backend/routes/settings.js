const express = require("express");
const db = require("../db");
//Auth-Middleware import ( nur Berechtigte Benutzer dürfen zugreifen  )
const { authMiddleware } = require("../auth");

const router = express.Router();

// abrufen aller gespeicherten Settings der DB (nur Admins zugriffsberechtigt)
router.get("/", authMiddleware("admin"), (req, res) => {
  try {
    const rows = db.prepare("SELECT key, value FROM settings").all();
    const map = {};
    rows.forEach((r) => {
      map[r.key] = r.value;
    });

    res.json(map);
  } catch (err) {
    res.status(500).json({ error: "Settings konnten nicht geladen werden", detail: err.message });
  }
});


router.post("/", authMiddleware("admin"), (req, res) => {
  const { key, value } = req.body;

  //Validierung Key ist pflicht
  if (!key) {
    return res.status(400).json({ error: "key fehlt" });
  }
// Settings speichern : Key existiert -> Update || Key existiert nicht -> insert
  try {
    db.prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value;
    `).run(key, value);

    res.json({ status: "ok" });
  } catch (err) {
    res.status(500).json({ error: "Fehler beim Speichern", detail: err.message });
  }
});

//Update-Verhalten ausschließlich durch admins änderbar
router.post("/policy", authMiddleware("admin"), (req, res) => {
  const { pinnedVersion, allowDowngrade } = req.body;

  try {
    //Feste Version speichern (oder null)
    db.prepare(`
      INSERT INTO settings (key, value) VALUES ('pinnedVersion', ?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value;
    `).run(pinnedVersion || null);
    // Downgrade erlauben
    db.prepare(`
      INSERT INTO settings (key, value) VALUES ('allowDowngrade', ?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value;
    `).run(String(!!allowDowngrade));

    res.json({ status: "ok" });
  } catch (err) {
    res.status(500).json({ error: "Fehler beim Speichern der Policy", detail: err.message });
  }
});

module.exports = router;

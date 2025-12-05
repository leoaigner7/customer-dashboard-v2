import express from "express";
import { db }  from "../db.js";
import { authMiddleware } from "../auth.js";

export function createSettingsRouter() {
  const router = express.Router();

  router.get("/", authMiddleware(), (_req, res) => {
    const settings = db
      .prepare("SELECT theme, language FROM settings WHERE id = 1")
      .get();
    res.json(settings);
  });

  router.put("/", authMiddleware(), (req, res) => {
    const { theme, language } = req.body;
    db.prepare(
      "UPDATE settings SET theme = ?, language = ? WHERE id = 1"
    ).run(theme ?? "light", language ?? "de");
    res.json({ ok: true });
  });

  return router;
}

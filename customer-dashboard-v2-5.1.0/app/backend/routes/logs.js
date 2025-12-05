import express from "express";
import { db } from "../db.js";
import { authMiddleware } from "../auth.js";

export function createLogsRouter() {
  const router = express.Router();

  router.get("/", authMiddleware(), (_req, res) => {
    const logs = db
      .prepare(
        "SELECT level, message, created_at FROM logs ORDER BY created_at DESC LIMIT 100"
      )
      .all();
    res.json(logs);
  });

  router.post("/", authMiddleware("admin"), (req, res) => {
    const { level, message } = req.body;
    db.prepare("INSERT INTO logs (level, message) VALUES (?, ?)")
      .run(level ?? "INFO", message ?? "");
    res.json({ ok: true });
  });

  return router;
}

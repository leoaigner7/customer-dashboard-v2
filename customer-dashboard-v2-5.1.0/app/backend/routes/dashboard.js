import express from "express";
import { db } from "../db.js";
import { authMiddleware } from "../auth.js";

export function createDashboardRouter() {
  const router = express.Router();

  router.get("/widgets", authMiddleware(), (_req, res) => {
    const totalLogs = db
      .prepare("SELECT COUNT(*) AS count FROM logs")
      .get().count;

    const recentLogs = db
      .prepare(
        "SELECT level, message, created_at FROM logs ORDER BY created_at DESC LIMIT 5"
      )
      .all();

    const chartData = [
      { label: "Mo", value: 120 },
      { label: "Di", value: 150 },
      { label: "Mi", value: 90 },
      { label: "Do", value: 200 },
      { label: "Fr", value: 180 }
    ];

    res.json({
      cards: [
        { id: "logs_count", title: "Log-Einträge", value: totalLogs },
        { id: "uptime", title: "System Uptime", value: "99.98 %" }
      ],
      recentLogs,
      chartData
    });
  });

  return router;
}

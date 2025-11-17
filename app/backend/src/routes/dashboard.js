//Webframework mit dem man HTTP-Routen definiert (Get /..)
import express from "express";
// Datenbank verbindung. Kommt aber von db.js
import { db } from "../db.js";
// Middleware funktion, die vor der Route ausgeführt wird. Sorgt dafür, dass nur eingeloggte User auf diese Route zugreifen dürfen
import { authMiddleware } from "../auth.js";

// exportieren einer Funktion die einen Router erzeugt -> Vorteil: Router flexible initialisieren
export function createDashboardRouter() {
// neuer router wird erstellt. Wird später noch in die Hauptapp eingebunden
  const router = express.Router();

  // eine GET-Route wird relative zum Router definiert || wenn der Router unter "app/dashboard" gemountet ist, dann ist bspw. der vollständige Pfad:GET /api/dashboard/widgets
  // "/widgets" Pfad innerhalb dieses Routers
  // "middleware" wird aufgerufen prüft -> Token, Session, Cookie z.b. || wenn nicht ok -> sendet z.b. 401 unauthorized und ruft den Handler nicht mehr auf || wenn ok -> ruft next() auf und dein Handler _req, res => { ... } wird ausgeführt.
  // "(_req, res)" eigentlicher Request Handler (_req: Request-Objekt (du brauchst es hier nicht, daher der Unterstrich ||res: Response-Objekt, damit sendest du die Antwort zurück.)
  router.get("/widgets", authMiddleware(), (_req, res) => {

    // Bereitet SQL abfrage vor
    const totalLogs = db
      .prepare("SELECT COUNT(*) AS count FROM logs")
      // führt abfrage aus und holt genau eine Zeile aus der DB bspw.   count:13   "Diese Zahl wird später im Dashboard als „Log-Einträge“ angezeigt."
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
// schickt eine Antwort an den Client (HTTP: ist standardmäßig 200 OK)
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

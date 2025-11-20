const express = require("express");
const path = require("path");
require("dotenv").config();

const app = express();
const port = 3000;
const version = process.env.APP_VERSION || "unknown";

// Statische Dateien (dein Vite-Frontend)
app.use(express.static(path.join(__dirname, "public")));

// Backend API – Beispiel: Version
app.get("/api/version", (req, res) => {
  res.json({ version });
});

// WICHTIG: SPA-Fallback (für React Router)
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Server starten
app.listen(port, () => {
  console.log(`Customer Dashboard läuft auf Port ${port} – Version ${version}`);
});

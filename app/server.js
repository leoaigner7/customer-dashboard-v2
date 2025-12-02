const express = require("express");
const path = require("path");
require("dotenv").config();

const app = express();
const port = 3000;
const version = process.env.APP_VERSION || "unknown";

// STATIC FILES – Frontend aus dem public Ordner
app.use(express.static(path.join(__dirname, "public")));

// API ENDPOINTS
app.get("/api/version", (req, res) => {
  res.json({ version });
});

// SPA FALLBACK – ALLES an React senden
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(port, () => {
  console.log(`Customer Dashboard läuft auf Port ${port} - Version ${version}`);
});

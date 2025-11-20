import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = 3000;
const version = process.env.APP_VERSION || "unknown";

// Statische Dateien
app.use(express.static(path.join(__dirname, "public")));

// API
app.get("/api/version", (req, res) => {
  res.json({ version });
});

// SPA-Fallback
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(port, () => {
  console.log(`Customer Dashboard läuft auf Port ${port} – Version ${version}`);
});

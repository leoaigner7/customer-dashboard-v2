import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

import { seedAdmin } from "./auth.js";
import { createUserRouter } from "./routes/users.js";
import { createDashboardRouter } from "./routes/dashboard.js";
import { createSettingsRouter } from "./routes/settings.js";
import { createLogsRouter } from "./routes/logs.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(cors());
app.use(express.json());

// API
app.use("/api/auth", createUserRouter());
app.use("/api/dashboard", createDashboardRouter());
app.use("/api/settings", createSettingsRouter());
app.use("/api/logs", createLogsRouter());

// Static React build
const frontendPath = path.join(__dirname, "public");
app.use(express.static(frontendPath));

app.get("*", (_req, res) => {
  res.sendFile(path.join(frontendPath, "index.html"));
});

const port = process.env.PORT || 3000;

seedAdmin().then(() => {
  app.listen(port, () => console.log("Server läuft auf Port " + port));
});

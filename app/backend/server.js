const express = require("express");
const path = require("path");
const db = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// === API ROUTES ===

// AUTHENTIFIZIERUNG
const authRoute = require("./auth");
app.use("/api/auth", authRoute);

// DASHBOARD-DATEN
const dashboardRoute = require("./routes/dashboard");
app.use("/api/dashboard", dashboardRoute);

// LOGS
const logsRoute = require("./routes/logs");
app.use("/api/logs", logsRoute);

// USER MANAGEMENT
const usersRoute = require("./routes/users");
app.use("/api/users", usersRoute);

// SETTINGS
const settingsRoute = require("./routes/settings");
app.use("/api/settings", settingsRoute);

// VERSION
const versionRoute = require("./routes/version");
app.use("/api/version", versionRoute);


// === STATIC FRONTEND ===
const frontendDist = path.join(__dirname, "../frontend/dist");
app.use(express.static(frontendDist));

// SPA fallback
app.get("*", (req, res) => {
  res.sendFile(path.join(frontendDist, "index.html"));
});

// START SERVER
app.listen(PORT, () => {
  console.log(`Backend läuft auf Port ${PORT}`);
});

const express = require("express");
const path = require("path");
const db = require("./db");
const auth = require("./auth");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());

// API ROUTES
app.use("/api/auth", auth);

// VERSION ROUTE EINBINDEN (NEU)
app.use("/api/version", require("./routes/version"));

// STATIC FRONTEND
const frontendDist = path.join(__dirname, "../frontend/dist");
app.use(express.static(frontendDist));

// SPA fallback für React
app.get("*", (req, res) => {
  res.sendFile(path.join(frontendDist, "index.html"));
});

// START SERVER
app.listen(PORT, () => {
  console.log(`Backend läuft auf Port ${PORT}`);
});

const express = require("express");
const path = require("path");
const db = require("./db");
const auth = require("./auth");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());


// VERSION ROUTE – **KORREKTER ABSOLUTER PFAD!**
const versionRoute = require(path.join(__dirname, "routes", "version.js"));
app.use("/api/version", versionRoute);

// STATIC FRONTEND
const frontendDist = path.join(__dirname, "../frontend/dist");
app.use(express.static(frontendDist));

// SPA fallback
app.get("*", (req, res) => {
  res.sendFile(path.join(frontendDist, "index.html"));
});

// START
app.listen(PORT, () => {
  console.log(`Backend läuft auf Port ${PORT}`);
});

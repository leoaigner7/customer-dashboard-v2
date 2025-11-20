const express = require("express");
const path = require("path");
require("dotenv").config();

const app = express();
const port = 3000;
const version = process.env.APP_VERSION || "unknown";

app.use(express.static(path.join(__dirname, "public")));

app.get("/api/version", (req, res) => {
  res.json({ version });
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(port, () => {
  console.log(`Customer Dashboard läuft auf Port ${port} - Version ${version}`);
});

const express = require("express");
const router = express.Router();
const path = require("path");
const fs = require("fs");

router.get("/", (req, res) => {
  const versionFile = path.join(__dirname, "..", "..", "VERSION.txt");

  if (!fs.existsSync(versionFile)) {
    return res.json({ version: "unknown" });
  }

  const version = fs.readFileSync(versionFile, "utf8").trim();
  res.json({ version });
});

module.exports = router;

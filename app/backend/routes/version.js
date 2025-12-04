const fs = require("fs");
const path = require("path");
const express = require("express");

const router = express.Router();

router.get("/", (req, res) => {
  try {
    const versionPath = path.join(__dirname, "../../../VERSION.txt");
    const version = fs.readFileSync(versionPath, "utf8").trim();
    res.json({ version });
  } catch (err) {
    console.error("VERSION API ERROR:", err);
    res.json({ version: "unknown" });
  }
});

module.exports = router;

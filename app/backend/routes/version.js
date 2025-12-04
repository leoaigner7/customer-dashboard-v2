const express = require("express");
const fs = require("fs");
const path = require("path");

const router = express.Router();

router.get("/", (req, res) => {
  try {
    const envPath = path.join(__dirname, "../.env");

    if (!fs.existsSync(envPath)) {
      return res.json({ version: "unknown" });
    }

    const envContent = fs.readFileSync(envPath, "utf8");
    const match = envContent.match(/^APP_VERSION\s*=\s*(.+)$/m);
    const version = match ? match[1].trim() : "unknown";

    res.json({ version });
  } catch (err) {
    console.error("VERSION API ERROR:", err);
    res.json({ version: "unknown" });
  }
});

module.exports = router;

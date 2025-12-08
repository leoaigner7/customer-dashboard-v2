const express = require("express");
const router = express.Router();

router.get("/", (req, res) => {
  const version = process.env.APP_VERSION || "unknown";
  res.json({ version });
});

module.exports = router;

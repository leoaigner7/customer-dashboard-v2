const express = require("express");
const router = express.Router();
// aktuell laufende Version der Anwendung
router.get("/", (req, res) => {
  // Version aus der Env lesen
  const version = process.env.APP_VERSION || "unknown";
  res.json({ version });
});

module.exports = router;

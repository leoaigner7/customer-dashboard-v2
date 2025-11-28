function log(msg, config) {
  try {
    const stamp = new Date().toISOString();
    const line = `[${stamp}] ${msg}\n`;

    // Fallback: logs-Ordner im InstallDir
    const fallbackDir = "C:\\CustomerDashboard\\logs";
    const fallbackFile = fallbackDir + "\\daemon.log";

    // 1. Zielpfad aus config
    let logPath = fallbackFile;

    if (config.notification?.logFile) {
      const candidate = resolvePath(__dirname, config.notification.logFile);
      logPath = candidate;
    }

    // 2. Ordner anlegen (falls nicht existiert)
    const targetDir = require("path").dirname(logPath);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    // 3. Schreiben
    fs.appendFileSync(logPath, line);
    console.log(line.trim());
  } catch (err) {
    console.error("LOGGING ERROR:", err.message);
  }
}

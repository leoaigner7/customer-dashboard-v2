// system-daemon/targets/docker-dashboard.js
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// Hilfsfunktion, um relative Pfade aus config sauber aufzulösen
function resolvePath(baseDir, rel) {
  if (!rel) return baseDir;
  if (path.isAbsolute(rel)) return rel;
  return path.normalize(path.join(baseDir, rel));
}

// ENV-Version aus .env lesen
function readEnvVersion(_baseDir, envFile, key) {
  try {
    if (!fs.existsSync(envFile)) return null;
    const content = fs.readFileSync(envFile, "utf8");
    const lines = content.split(/\r?\n/);
    const line = lines.find(l => l.startsWith(key + "="));
    if (!line) return null;
    return line.substring(key.length + 1).trim();
  } catch (err) {
    console.error("readEnvVersion error:", err.message);
    return null;
  }
}

// ENV-Version in .env schreiben (Key ersetzen oder hinzufügen)
function writeEnvVersion(_baseDir, envFile, key, version) {
  let content = "";

  if (fs.existsSync(envFile)) {
    content = fs.readFileSync(envFile, "utf8");
  }

  const lines = content.split(/\r?\n/);
  let updated = false;

  const newLines = lines.map(line => {
    if (line.startsWith(key + "=")) {
      updated = true;
      return `${key}=${version}`;
    }
    return line;
  });

  if (!updated) {
    newLines.push(`${key}=${version}`);
  }

  fs.writeFileSync(envFile, newLines.join("\n"), "utf8");
}

// Docker-Image für eine Version laden
function downloadImage(config, version) {
  const template = config.artifacts && config.artifacts.imageTemplate;
  if (!template) {
    throw new Error("artifacts.imageTemplate nicht konfiguriert");
  }
  const image = template.replace("{version}", version);

  execSync(`docker pull "${image}"`, { stdio: "inherit" });
}

// Dashboard-Container neu starten (down + pull + up -d)
function restartDashboard(_baseDir, composeFile, serviceName) {
  if (!fs.existsSync(composeFile)) {
    throw new Error("docker-compose.yml nicht gefunden: " + composeFile);
  }

  const serviceArg = serviceName ? ` ${serviceName}` : "";

  execSync(`docker compose -f "${composeFile}" down${serviceArg}`, {
    stdio: "inherit"
  });

  execSync(`docker compose -f "${composeFile}" pull${serviceArg}`, {
    stdio: "inherit"
  });

  execSync(`docker compose -f "${composeFile}" up -d${serviceArg}`, {
    stdio: "inherit"
  });
}

// Logging mit Rotation (optional)
function log(msg, config) {
  try {
    const stamp = new Date().toISOString();
    const line = `[${stamp}] ${msg}\n`;

    // Fallback: logs-Ordner im InstallDir
    const fallbackDir = "C:\\CustomerDashboard\\logs";
    const fallbackFile = path.join(fallbackDir, "daemon.log");

    let logPath = fallbackFile;

    if (config.notification && config.notification.logFile) {
      logPath = resolvePath(__dirname, config.notification.logFile);
    }

    const logDir = path.dirname(logPath);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    // einfache Rotation
    try {
      const maxSize = config.logging?.maxSize || 1024 * 1024;
      const maxFiles = config.logging?.maxFiles || 5;

      if (fs.existsSync(logPath)) {
        const stat = fs.statSync(logPath);
        if (stat.size > maxSize) {
          // alte Dateien umbenennen: daemon.log -> daemon.log.1 -> ...
          for (let i = maxFiles - 1; i >= 1; i--) {
            const src = `${logPath}.${i}`;
            const dst = `${logPath}.${i + 1}`;
            if (fs.existsSync(src)) {
              fs.renameSync(src, dst);
            }
          }
          fs.renameSync(logPath, `${logPath}.1`);
        }
      }
    } catch (e) {
      console.error("Log-Rotation Fehler:", e.message);
    }

    fs.appendFileSync(logPath, line);
    console.log(line.trim());
  } catch (err) {
    console.error("LOGGING ERROR:", err.message);
  }
}

module.exports = {
  resolvePath,
  readEnvVersion,
  writeEnvVersion,
  downloadImage,
  restartDashboard,
  log
};

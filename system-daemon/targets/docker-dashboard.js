// system-daemon/targets/docker-dashboard.js
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

// -------------------------------------------------------------
// Logging
// -------------------------------------------------------------
function log(message, config) {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log(line);

  if (!config || !config.notification || !config.notification.logFile) {
    return;
  }

  try {
    const logFile = config.notification.logFile;
    const logPath = path.isAbsolute(logFile)
      ? logFile
      : path.join(__dirname, "..", logFile);

    const dir = path.dirname(logPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.appendFileSync(logPath, line + "\n", "utf8");
  } catch (e) {
    console.error("Fehler beim Schreiben des Logfiles:", e.message);
  }
}

// -------------------------------------------------------------
// .env lesen / schreiben
// -------------------------------------------------------------
function readEnvVersion(baseDir, envPath, key) {
  try {
    if (!envPath || !fs.existsSync(envPath)) return null;

    const content = fs.readFileSync(envPath, "utf8");
    const lines = content.split(/\r?\n/);

    const line = lines.find((l) => l.startsWith(key + "="));
    if (!line) return null;

    const value = line.substring((key + "=").length).trim();
    return value || null;
  } catch {
    return null;
  }
}

function writeEnvVersion(baseDir, envPath, key, value) {
  try {
    let lines = [];
    if (fs.existsSync(envPath)) {
      lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
    }

    let found = false;
    lines = lines.map((l) => {
      if (l.startsWith(key + "=")) {
        found = true;
        return `${key}=${value}`;
      }
      return l;
    });

    if (!found) {
      lines.push(`${key}=${value}`);
    }

    fs.writeFileSync(envPath, lines.join("\n"), "utf8");
  } catch (e) {
    console.error("Fehler beim Schreiben der .env:", e.message);
  }
}

// -------------------------------------------------------------
// Docker Image laden
// -------------------------------------------------------------
async function downloadImage(config, version) {
  const template = config.artifacts && config.artifacts.imageTemplate;
  if (!template) {
    throw new Error("imageTemplate in config.artifacts fehlt.");
  }

  const image = template.replace("{version}", version);
  log("Pull Docker-Image: " + image, config);

  const result = spawnSync("docker", ["pull", image], {
    stdio: "inherit"
  });

  if (result.status !== 0) {
    throw new Error("docker pull fehlgeschlagen.");
  }
}

// -------------------------------------------------------------
// Dashboard neu starten
// -------------------------------------------------------------
async function restartDashboard(baseDir, composeFile, serviceName) {
  if (!composeFile) {
    throw new Error("composeFile ist nicht gesetzt.");
  }
  if (!serviceName) {
    throw new Error("serviceName ist nicht gesetzt.");
  }

  const file = composeFile;
  const args = ["compose", "-f", file, "up", "-d", serviceName];

  const result = spawnSync("docker", args, {
    stdio: "inherit"
  });

  if (result.status !== 0) {
    throw new Error("docker compose up -d fehlgeschlagen.");
  }
}

module.exports = {
  log,
  readEnvVersion,
  writeEnvVersion,
  downloadImage,
  restartDashboard
};

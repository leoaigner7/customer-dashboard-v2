// system-daemon/targets/docker-dashboard.js
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

// -------------------------------------------------------------
// Logging
// -------------------------------------------------------------
function log(message, config) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}`;

  console.log(line);

  if (!config || !config.notification || !config.notification.logFile) return;

  try {
    const logFile = config.notification.logFile;

    // Relative Pfade zu system-daemon verarbeiten
    const fullPath = path.isAbsolute(logFile)
      ? logFile
      : path.join(__dirname, "..", logFile);

    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.appendFileSync(fullPath, line + "\n", "utf8");
  } catch (err) {
    console.error("Fehler beim Schreiben ins Logfile:", err.message);
  }
}

// -------------------------------------------------------------
// .env Version lesen/schreiben
// -------------------------------------------------------------
function readEnvVersion(baseDir, envFile, versionKey) {
  const filePath = path.isAbsolute(envFile)
    ? envFile
    : path.join(baseDir, envFile || "");

  if (!fs.existsSync(filePath)) return null;

  try {
    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split(/\r?\n/);

    const line = lines.find((l) => l.trim().startsWith(versionKey + "="));
    if (!line) return null;

    const value = line.split("=", 2)[1];
    return value ? value.trim() : null;
  } catch (err) {
    console.error("Fehler beim Lesen der .env:", err.message);
    return null;
  }
}

function writeEnvVersion(baseDir, envFile, versionKey, newVersion) {
  const filePath = path.isAbsolute(envFile)
    ? envFile
    : path.join(baseDir, envFile || "");

  let lines = [];
  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath, "utf8");
    lines = content.split(/\r?\n/);
  }

  const needle = versionKey + "=";
  const idx = lines.findIndex((l) => l.trim().startsWith(needle));

  if (idx >= 0) {
    lines[idx] = `${versionKey}=${newVersion}`;
  } else {
    lines.push(`${versionKey}=${newVersion}`);
  }

  const finalContent = lines.join("\n");
  fs.writeFileSync(filePath, finalContent, "utf8");
}

// -------------------------------------------------------------
// Docker Image ziehen
// -------------------------------------------------------------
function downloadImage(config, version) {
  if (!config.artifacts || !config.artifacts.imageTemplate) {
    throw new Error("imageTemplate in config.artifacts fehlt");
  }

  const template = config.artifacts.imageTemplate;
  const image = template.replace("{version}", version);

  log(`Pull Docker-Image: ${image}`, config);

  const result = spawnSync("docker", ["pull", image], {
    stdio: "inherit",
  });

  if (result.error) {
    throw new Error("docker pull fehlgeschlagen: " + result.error.message);
  }
  if (result.status !== 0) {
    throw new Error("docker pull exit code " + result.status);
  }

  return image;
}

// -------------------------------------------------------------
// Dashboard neustarten
// -------------------------------------------------------------
function restartDashboard(baseDir, composeFile, serviceName) {
  const filePath = path.isAbsolute(composeFile)
    ? composeFile
    : path.join(baseDir, composeFile || "");

  const args = ["compose", "-f", filePath, "up", "-d"];
  if (serviceName) {
    args.push(serviceName);
  }

  console.log("Starte Docker Compose:", args.join(" "));

  const result = spawnSync("docker", args, {
    stdio: "inherit",
  });

  if (result.error) {
    console.error(
      "Fehler beim Neustart via docker compose:",
      result.error.message
    );
  } else if (result.status !== 0) {
    console.error("docker compose exit code:", result.status);
  }
}

module.exports = {
  readEnvVersion,
  writeEnvVersion,
  downloadImage,
  restartDashboard,
  log,
};

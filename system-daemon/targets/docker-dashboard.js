const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

/**
 * Einfache Logfunktion; wird auch vom Daemon genutzt.
 * @param {"debug"|"info"|"warn"|"error"} level
 * @param {string} message
 * @param {object} [config]
 * @param {object} [extra]
 */
function log(level, message, config, extra = undefined) {
  const logFile =
    (config && config.logging && config.logging.logFile) ||
    (config && config.notification && config.notification.logFile) ||
    "C:\\CustomerDashboard\\logs\\daemon.log";

  const entry = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    extra
  };

  const line = JSON.stringify(entry) + "\n";
  try {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.appendFileSync(logFile, line);
  } catch {
    // Silent fallback to console
    console.log(`[${entry.ts}] [${level}] ${message}`, extra || "");
  }
}

/**
 * Liest die Version aus einer .env Datei.
 */
function readEnvVersion(config) {
  const envFile = config.target.envFile;
  const key = config.target.versionKey || "APP_VERSION";

  if (!fs.existsSync(envFile)) {
    return null;
  }

  const lines = fs.readFileSync(envFile, "utf8").split(/\r?\n/);
  const line = lines.find((l) => l.startsWith(key + "="));
  if (!line) return null;
  return line.substring(key.length + 1).trim() || null;
}

/**
 * Schreibt die Version in eine .env Datei.
 */
function writeEnvVersion(config, version) {
  const envFile = config.target.envFile;
  const key = config.target.versionKey || "APP_VERSION";

  let lines = [];
  if (fs.existsSync(envFile)) {
    lines = fs.readFileSync(envFile, "utf8").split(/\r?\n/);
  }

  let found = false;
  const newLines = lines.map((line) => {
    if (line.startsWith(key + "=")) {
      found = true;
      return `${key}=${version}`;
    }
    return line;
  });

  if (!found) {
    newLines.push(`${key}=${version}`);
  }

  fs.writeFileSync(envFile, newLines.join("\n"), "utf8");
}

/**
 * Führt ein Docker/Kommando asynchron aus und loggt Ausgabe.
 */
function runCommand(command, args, options = {}, logFn) {
  return new Promise((resolve, reject) => {
    logFn("info", `Starte: ${command} ${args.join(" ")}`);
    const child = spawn(command, args, { shell: false, ...options });

    let output = "";
    let errorOutput = "";

    child.stdout.on("data", (data) => {
      output += data.toString();
    });

    child.stderr.on("data", (data) => {
      const t = data.toString();
      errorOutput += t;
    });

    child.on("error", (err) => {
      logFn("error", `Fehler beim Start von ${command}`, { err: err.message });
      reject(err);
    });

    child.on("close", (code) => {
      if (code === 0) {
        logFn("info", `${command} beendet`, { output: output.trim() });
        resolve(output);
      } else {
        logFn("error", `${command} mit Fehlercode beendet`, {
          code,
          stderr: errorOutput.trim()
        });
        reject(
          new Error(
            `${command} exited with code ${code}: ${errorOutput.trim()}`
          )
        );
      }
    });
  });
}

/**
 * Lädt ein Docker-Image vom Registry (pull).
 */
async function downloadImage(config, version) {
  const imageTemplate = config.sources.github.imageTemplate;
  const image = imageTemplate.replace("{version}", version);

  await runCommand(
    "docker",
    ["pull", image],
    {},
    (level, msg, extra) => log(level, msg, config, extra)
  );

  return image;
}

/**
 * Startet das Dashboard mit docker compose neu (Atomic im Sinne von Pull+Restart).
 */
async function restartDashboard(config) {
  const composeFile = config.target.composeFile;

  await runCommand(
    "docker",
    ["compose", "-f", composeFile, "down"],
    {},
    (level, msg, extra) => log(level, msg, config, extra)
  );

  await runCommand(
    "docker",
    ["compose", "-f", composeFile, "pull"],
    {},
    (level, msg, extra) => log(level, msg, config, extra)
  );

  await runCommand(
    "docker",
    ["compose", "-f", composeFile, "up", "-d"],
    {},
    (level, msg, extra) => log(level, msg, config, extra)
  );
}

/**
 * Healthcheck für das laufende Dashboard über HTTP.
 */
async function checkHealth(config) {
  const url = config.target.healthUrl;
  if (!url) return true;

  return new Promise((resolve) => {
    const http = url.startsWith("https") ? require("https") : require("http");
    const req = http.get(url, (res) => {
      const ok = res.statusCode && res.statusCode >= 200 && res.statusCode < 400;
      res.resume();
      resolve(ok);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(8000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

module.exports = {
  log,
  readEnvVersion,
  writeEnvVersion,
  downloadImage,
  restartDashboard,
  checkHealth
};

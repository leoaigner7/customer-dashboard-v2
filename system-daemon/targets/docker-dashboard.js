/**
 * CUSTOMER DASHBOARD – Docker Target
 * ----------------------------------
 * Zuständig für:
 *  - Logging (JSON-Logfile)
 *  - Lesen/Schreiben der APP_VERSION aus .env
 *  - Docker-Befehle (pull / compose up/down)
 *  - HTTP-Healthcheck
 */

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

/**
 * Zentrale Logfunktion.
 *
 * Schreibt JSON-Lines in eine Logdatei, z.B.:
 * {
 *   "ts": "2025-12-09T11:49:22.912Z",
 *   "level": "info",
 *   "message": "Docker-Update erfolgreich angewendet.",
 *   "context": {
 *     "event": "update.apply.docker",
 *     "version": "6.6.2",
 *     "durationMs": 1234
 *   }
 * }
 *
 * @param {"debug"|"info"|"warn"|"error"} level
 * @param {string} message
 * @param {object} [config]
 * @param {object} [context]
 */
function log(level, message, config, context = undefined) {
  const logFile =
    (config && config.logging && config.logging.logFile) ||
    (config && config.notification && config.notification.logFile) ||
    "C:\\CustomerDashboard\\logs\\daemon.log";

  const entry = {
    ts: new Date().toISOString(),
    level,
    message,
    context: context || undefined
  };

  const line = JSON.stringify(entry) + "\n";

  try {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.appendFileSync(logFile, line, "utf8");
  } catch {
    // Fallback auf Konsole, falls Datei nicht geschrieben werden kann
    // (z.B. Berechtigungsproblem)
    console.log(`[${entry.ts}] [${level}] ${message}`, context || "");
  }
}

/**
 * Kleine Hilfsfunktion zur Laufzeitmessung.
 * @param {bigint} startHrtime - process.hrtime.bigint() zum Start
 * @returns {number} Dauer in Millisekunden
 */
function durationMsFrom(startHrtime) {
  const diffNs = process.hrtime.bigint() - startHrtime;
  return Number(diffNs / 1000000n);
}

/**
 * Liest die Version aus der .env-Datei.
 * Die Key-Bezeichnung kommt aus config.target.versionKey (Default: APP_VERSION).
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
 * Schreibt die Version in die .env-Datei.
 * Existierender Eintrag wird ersetzt, sonst angehängt.
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

  fs.mkdirSync(path.dirname(envFile), { recursive: true });
  fs.writeFileSync(envFile, newLines.join("\n"), "utf8");
}

/**
 * Führt einen externen Befehl aus (z.B. docker, docker compose).
 *
 * - Loggt Start, Ende, Exit-Code und Dauer
 * - Gibt stdout als String zurück
 * - Wirft Fehler bei Exit-Code != 0
 *
 * @param {string} command
 * @param {string[]} args
 * @param {object} options
 * @param {(level:string, message:string, context?:object) => void} logFn
 * @returns {Promise<string>}
 */
function runCommand(command, args, options = {}, logFn) {
  return new Promise((resolve, reject) => {
    const startedAt = process.hrtime.bigint();

    logFn("info", `Starte externen Befehl`, {
      event: "process.start",
      command,
      args
    });

    const child = spawn(command, args, {
      shell: false,
      ...options
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("error", (err) => {
      const durationMs = durationMsFrom(startedAt);
      logFn("error", `Konnte Befehl nicht starten`, {
        event: "process.error",
        command,
        args,
        error: err.message,
        durationMs
      });
      reject(err);
    });

    child.on("close", (code) => {
      const durationMs = durationMsFrom(startedAt);

      if (code === 0) {
        logFn("info", `Befehl beendet`, {
          event: "process.end",
          command,
          args,
          exitCode: code,
          durationMs,
          stdout: stdout.trim() || undefined
        });
        resolve(stdout);
      } else {
        logFn("error", `Befehl mit Fehlercode beendet`, {
          event: "process.end",
          command,
          args,
          exitCode: code,
          durationMs,
          stderr: stderr.trim() || undefined
        });
        reject(
          new Error(
            `${command} exited with code ${code}: ${stderr.trim()}`
          )
        );
      }
    });
  });
}

/**
 * Lädt ein Docker-Image aus dem Registry.
 * Nutzt config.sources.github.imageTemplate mit {version}.
 */
async function downloadImage(config, version) {
  const imageTemplate = config.sources.github.imageTemplate;
  const image = imageTemplate.replace("{version}", version);

  await runCommand(
    "docker",
    ["pull", image],
    {},
    (level, message, context) => log(level, message, config, context)
  );

  return image;
}

/**
 * Startet das Dashboard über docker compose neu:
 *  - docker compose -f <file> down
 *  - docker compose -f <file> pull
 *  - docker compose -f <file> up -d
 */
async function restartDashboard(config) {
  const composeFile = config.target.composeFile;

  await runCommand(
    "docker",
    ["compose", "-f", composeFile, "down"],
    {},
    (level, message, context) => log(level, message, config, context)
  );

  await runCommand(
    "docker",
    ["compose", "-f", composeFile, "pull"],
    {},
    (level, message, context) => log(level, message, config, context)
  );

  await runCommand(
    "docker",
    ["compose", "-f", composeFile, "up", "-d"],
    {},
    (level, message, context) => log(level, message, config, context)
  );
}

/**
 * Führt einen einzelnen HTTP-Healthcheck aus.
 * Gibt true zurück, wenn HTTP-Status 2xx/3xx.
 *
 * Mehrere Versuche / Retry-Logik kommen aus daemon.js.
 */
async function checkHealth(config) {
  const url = config.target.healthUrl;
  if (!url) return true;

  return new Promise((resolve) => {
    const http = url.startsWith("https") ? require("https") : require("http");

    const req = http.get(url, (res) => {
      const statusCode = res.statusCode || 0;
      // Body wird nicht benötigt
      res.resume();
      const ok = statusCode >= 200 && statusCode < 400;
      resolve(ok);
    });

    req.on("error", () => {
      resolve(false);
    });

    req.setTimeout(3000, () => {
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
  checkHealth,
  // runCommand bewusst NICHT exportiert, um API klein zu halten
};

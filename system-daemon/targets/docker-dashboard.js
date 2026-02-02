const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");


function log(level, message, config, extra = undefined) {
  const logFile =
    (config &&
      config.logging &&
      config.logging.logFile) ||
    (config &&
      config.notification &&
      config.notification.logFile) ||
    "C:\\CustomerDashboard\\logs\\daemon.log";

  const entry = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    extra,
  };

  const line = JSON.stringify(entry) + "\n";

  try {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.appendFileSync(logFile, line, "utf8");
  } catch {
    // Fallback zur Konsole, falls Datei nicht beschreibbar
    console.log(
      `[${entry.ts}] [${level}] ${message}`,
      extra ? JSON.stringify(extra) : ""
    );
  }
}

/**
 * Liest die aktuell installierte Version aus der .env-Datei.
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

  const value = line.substring(key.length + 1).trim();
  return value || null;
}


 //Schreibt eine Version in die .env-Datei (APP_VERSION=) -> Nach dem Update APP_VERSION aktualisieren, damit docker compose beim nächsten Start das richtige Image nutzt
 
function writeEnvVersion(config, version) {
  const envFile = config.target.envFile;
  const key = config.target.versionKey || "APP_VERSION";
// bestehende datei einlesen
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

//Führt ein Kommando (z. B. docker) aus, sammelt stdout/stderr


function runCommand(command, args, options = {}, config) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    log("info", `Prozess gestartet: ${command} ${args.join(" ")}`, config);

    const child = spawn(command, args, {
      shell: false,
      ...options,
    });

    let output = "";
    let errorOutput = "";

    child.stdout.on("data", (data) => {
      output += data.toString();
    });

    child.stderr.on("data", (data) => {
      errorOutput += data.toString();
    });

    child.on("error", (err) => {
      log("error", `Prozessfehler beim Start von ${command}`, config, {
        error: err.message,
      });
      reject(err);
    });

    child.on("close", (code) => {
      const durationMs = Date.now() - started;

      if (code === 0) {
        log("info", `Prozess erfolgreich beendet: ${command}`, config, {
          exitCode: code,
          durationMs,
          output: output.trim(),
        });
        resolve(output);
      } else {
        log("error", `Prozess mit Fehler beendet: ${command}`, config, {
          exitCode: code,
          durationMs,
          stderr: errorOutput.trim(),
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


 //Lädt ein Docker-Image (docker pull).
async function downloadImage(config, version) {
  const template = config.sources.github.imageTemplate;
  const image = template.replace("{version}", version);

  log("info", "Starte Download des Docker-Images", config, {
    image,
    version,
  });
 //docker image pullen 
  await runCommand("docker", ["pull", image], {}, config);

  log("info", "Docker-Image erfolgreich geladen", config, {
    image,
    version,
  });

  return image;
}

 // Stoppt das Dashboard via docker compose down (OHNE -v!) -> WICHTIG: -v darf NICHT verwendet werden (würde Volumes löschen -> Datenverlust).
 
async function stopDashboard(config) {
  const composeFile = config.target.composeFile;

  log("info", "Stoppe Dashboard (docker compose down)", config, { composeFile });

  await runCommand(
    "docker",
    ["compose", "-f", composeFile, "down"],
    {},
    config
  );
}


 // Startet das Dashboard via docker compose up -d
 
async function startDashboard(config) {
  const composeFile = config.target.composeFile;

  log("info", "Starte Dashboard (docker compose up -d)", config, { composeFile });

  await runCommand(
    "docker",
    ["compose", "-f", composeFile, "up", "-d"],
    {},
    config
  );
}

// Optional: zieht die Images neu (docker compose pull)
 
async function pullDashboard(config) {
  const composeFile = config.target.composeFile;

  log("info", "Ziehe Dashboard Images (docker compose pull)", config, { composeFile });

  await runCommand(
    "docker",
    ["compose", "-f", composeFile, "pull"],
    {},
    config
  );
}


// Startet das Dashboard via docker compose neu:garantiert Neustart mit neuem Image

async function restartDashboard(config) {
  const composeFile = config.target.composeFile;

  log("info", "Starte Docker-Restart des Dashboards", config, {
    composeFile,
  });

  await runCommand(
    "docker",
    ["compose", "-f", composeFile, "down"],
    {},
    config
  );

  await runCommand(
    "docker",
    ["compose", "-f", composeFile, "pull"],
    {},
    config
  );

  await runCommand(
    "docker",
    ["compose", "-f", composeFile, "up", "-d"],
    {},
    config
  );

  log("info", "Docker-Restart abgeschlossen", config, {
    composeFile,
  });
}


 // Healthcheck: /api/health des Dashboards prüfen .
// Versucht mehrfach (bis zu maxAttempts), mit Wartezeit dazwischen.
 
async function checkHealth(config, maxAttempts = 20, delayMs = 2000) {
  const url = config.target.healthUrl;
  if (!url) {
    // Wenn kein Healthcheck definiert ist, gehen wir von OK aus
    return true;
  }

  const http = url.startsWith("https") ? require("https") : require("http");

  log("info", "Starte Healthcheck für Dashboard", config, { url });

  return new Promise((resolve) => {
    const tryCheck = (attempt) => {
      const started = Date.now();

      const req = http.get(url, (res) => {
        res.resume(); 
        const ok = res.statusCode >= 200 && res.statusCode < 400;
        const durationMs = Date.now() - started;

        if (ok) {
          log(
            "info",
            "Healthcheck erfolgreich",
            config,
            { attempt, statusCode: res.statusCode, durationMs }
          );
          return resolve(true);
        }

        log(
          "warn",
          "Healthcheck nicht erfolgreich",
          config,
          { attempt, statusCode: res.statusCode, durationMs }
        );

        if (attempt >= maxAttempts) {
          log(
            "error",
            "Healthcheck endgültig fehlgeschlagen (Maximale Versuche erreicht)",
            config,
            { attempts: attempt }
          );
          return resolve(false);
        }

        setTimeout(() => tryCheck(attempt + 1), delayMs);
      });
      // Netzwerkfehler
      req.on("error", (err) => {
        const durationMs = Date.now() - started;

        log(
          "warn",
          "Healthcheck-Request fehlgeschlagen",
          config,
          { attempt, error: err.message, durationMs }
        );

        if (attempt >= maxAttempts) {
          log(
            "error",
            "Healthcheck endgültig fehlgeschlagen (Netzwerkfehler)",
            config,
            { attempts: attempt }
          );
          return resolve(false);
        }

        setTimeout(() => tryCheck(attempt + 1), delayMs);
      });

      req.setTimeout(5000, () => {
        req.destroy(new Error("Healthcheck Timeout"));
      });
    };

    tryCheck(1);
  });
}

module.exports = {
  log,
  readEnvVersion,
  writeEnvVersion,
  downloadImage,
  restartDashboard,
  stopDashboard,
  startDashboard,
  pullDashboard,
  checkHealth,
  runCommand, // optional, falls du es später im Daemon nutzen möchtest
};

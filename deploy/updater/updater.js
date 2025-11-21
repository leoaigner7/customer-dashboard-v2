import fetch from "node-fetch";
import fs from "fs";
import { execSync } from "child_process";

const ENV_PATH = "/app/.env";
const COMPOSE_FILE = "/app/docker-compose.yml";

// GitHub API für Latest Release
const GITHUB_LATEST =
  "https://api.github.com/repos/leoaigner7/customer-dashboard-v2/releases/latest";

function log(...args) {
  console.log(new Date().toISOString(), "-", ...args);
}

async function getLatestVersion() {
  const res = await fetch(GITHUB_LATEST, {
    headers: { "User-Agent": "CustomerDashboard-Updater" },
  });
  const json = await res.json();
  // z.B. tag_name = "v3.4.0" → "3.4.0"
  return json.tag_name.replace(/^v/, "").trim();
}

function getCurrentVersion() {
  const env = fs.readFileSync(ENV_PATH, "utf8");
  const line = env.split("\n").find(l => l.startsWith("APP_VERSION"));
  if (!line) return "unknown";
  return line.split("=")[1].trim();
}

function writeNewEnv(version) {
  let env = fs.readFileSync(ENV_PATH, "utf8");
  if (env.match(/APP_VERSION=.*/)) {
    env = env.replace(/APP_VERSION=.*/, `APP_VERSION=${version}`);
  } else {
    env += `\nAPP_VERSION=${version}\n`;
  }
  fs.writeFileSync(ENV_PATH, env);
}

async function runOnce() {
  try {
    const current = getCurrentVersion();
    const latest = await getLatestVersion();

    log("Aktuelle Version:", current);
    log("Neueste Version:", latest);

    if (current === latest) {
      log("✔ Kein Update notwendig.");
      return;
    }

    log("🚀 Update verfügbar →", `${current} → ${latest}`);

    // Version in .env überschreiben
    writeNewEnv(latest);

    // Nur den dashboard-Service pullen, NICHT den updater!
    log("📦 Pulle neues Dashboard-Image…");
    execSync(`docker compose -f ${COMPOSE_FILE} pull dashboard`, {
      stdio: "inherit",
    });

    // Nur dashboard neu starten
    log("♻ Starte Dashboard neu…");
    execSync(
      `docker compose -f ${COMPOSE_FILE} up -d --force-recreate dashboard`,
      { stdio: "inherit" }
    );

    log(`🎉 Update erfolgreich abgeschlossen: ${latest}`);
  } catch (err) {
    console.error("❌ Fehler beim Update:", err);
  }
}

log("=== Customer Dashboard Auto-Updater gestartet ===");
runOnce();

// alle 5 Minuten prüfen (kannst du anpassen)
setInterval(runOnce, 2 * 60 * 1000);

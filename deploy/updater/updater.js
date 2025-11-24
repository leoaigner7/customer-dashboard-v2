import fetch from "node-fetch";
import fs from "fs";
import { execSync } from "child_process";

// Pfad zur .env-Datei und Docker-Compose-Datei
const ENV_PATH = "/app/.env";
const COMPOSE_FILE = "/app/docker-compose.yml";

// GitHub API für neueste Version
const GITHUB_LATEST =
  "https://api.github.com/repos/leoaigner7/customer-dashboard-v2/releases/latest";

// Holt die neueste Version von GitHub Releases
async function getLatestVersion() {
  const res = await fetch(GITHUB_LATEST, {
    headers: { "User-Agent": "CustomerDashboard-Updater" },
  });
  const json = await res.json();
  return json.tag_name.replace(/^v/, "").trim();  // Entfernt 'v' aus Version
}

// Holt die aktuelle Version aus der .env
function getCurrentVersion() {
  const env = fs.readFileSync(ENV_PATH, "utf8");
  const line = env.split("\n").find(l => l.startsWith("APP_VERSION"));
  return line ? line.split("=")[1].trim() : "unknown";
}

// Schreibt die neue Version in die .env
function writeNewEnv(version) {
  let env = fs.readFileSync(ENV_PATH, "utf8");
  if (env.match(/APP_VERSION=.*/)) {
    env = env.replace(/APP_VERSION=.*/, `APP_VERSION=${version}`);
  } else {
    env += `\nAPP_VERSION=${version}\n`;
  }
  fs.writeFileSync(ENV_PATH, env);
}

// Alte Container stoppen und entfernen
function removeOldContainer(containerName) {
  try {
    console.log(`Stoppe und entferne alten Container: ${containerName}`);
    execSync(`docker stop ${containerName}`, { stdio: "inherit" });
    execSync(`docker rm ${containerName}`, { stdio: "inherit" });
  } catch (err) {
    console.log(`Kein alter Container gefunden oder Fehler beim Entfernen: ${err.message}`);
  }
}

// Docker-Image ziehen und neuen Container starten
function deployNewVersion(version) {
  console.log(`Ziehe neues Docker-Image für Version: ${version}`);
  execSync(`docker compose -f ${COMPOSE_FILE} pull --quiet dashboard`, { stdio: "inherit" });

  console.log(`Starte den neuen Container mit Version: ${version}`);
  execSync(`docker compose -f ${COMPOSE_FILE} up -d --force-recreate dashboard`, { stdio: "inherit" });
}

// Hauptlogik
async function runOnce() {
  try {
    const current = getCurrentVersion();
    const latest = await getLatestVersion();

    console.log("Aktuelle Version:", current);
    console.log("Neueste Version:", latest);

    if (current === latest) {
      console.log("✔ Kein Update notwendig.");
      return;
    }

    console.log("🚀 Update verfügbar →", `${current} → ${latest}`);

    // Neue Version in der .env setzen
    writeNewEnv(latest);

    // Alten Container stoppen und entfernen
    removeOldContainer('deploy-dashboard-1');

    // Neuer Container wird mit der neuen Version gestartet
    deployNewVersion(latest);

    console.log(`🎉 Update erfolgreich abgeschlossen: ${latest}`);
  } catch (err) {
    console.error("❌ Fehler beim Update:", err);
  }
}

// Initialer Update-Check
console.log("=== Customer Dashboard Auto-Updater gestartet ===");
runOnce();

// Alle 5 Minuten prüfen (optional anpassen)
setInterval(runOnce, 1 * 60 * 1000);

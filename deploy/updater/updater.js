import fetch from "node-fetch";
import fs from "fs";
import { execSync } from "child_process";

const ENV_PATH = "/app/../.env";
const COMPOSE_CMD = "docker compose";

// GitHub API für Latest Release
const GITHUB_LATEST =
  "https://api.github.com/repos/leoaigner7/customer-dashboard-v2/releases/latest";

async function getLatestVersion() {
  // Hole neueste Version aus GitHub
  const res = await fetch(GITHUB_LATEST);
  const json = await res.json();
  return json.tag_name.replace(/^v/, "").trim(); // v3.1.3 -> 3.1.3
}

function getCurrentVersion() {
  const env = fs.readFileSync(ENV_PATH, "utf8");
  const line = env.split("\n").find(l => l.startsWith("APP_VERSION"));
  return line.split("=")[1].trim();
}

function writeNewEnv(version) {
  let env = fs.readFileSync(ENV_PATH, "utf8");
  env = env.replace(/APP_VERSION=.*/, `APP_VERSION=${version}`);
  fs.writeFileSync(ENV_PATH, env);
}

async function run() {
  try {
    const current = getCurrentVersion();
    const latest = await getLatestVersion();

    console.log("Aktuelle Version:", current);
    console.log("Neueste Version:", latest);

    if (current === latest) {
      console.log("✔ Kein Update notwendig.");
      return;
    }

    console.log("🚀 Update verfügbar → bereite Pull vor…");

    // Version in .env überschreiben
    writeNewEnv(latest);

    console.log("📦 Pulle neues Image…");
    execSync(`${COMPOSE_CMD} pull`, { stdio: "inherit" });

    console.log("♻ Starte neuen Container…");
    execSync(`${COMPOSE_CMD} up -d --force-recreate --pull always`, { stdio: "inherit" });

    console.log(`🎉 Update erfolgreich abgeschlossen: ${latest}`);

  } catch (err) {
    console.error("❌ Fehler beim Update:", err);
  }
}

run();

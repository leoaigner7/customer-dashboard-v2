const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { execSync } = require("child_process");
const config = require("./config.json");

function log(msg) {
  const stamp = new Date().toISOString();
  const line = `[${stamp}] ${msg}`;
  console.log(line);
  fs.appendFileSync(path.join(__dirname, "updater.log"), line + "\n");
}

async function getLatestVersion() {
  log("Hole GitHub Release API…");

  try {
    const res = await axios.get(config.updateApi, {
      headers: { "User-Agent": "CustomerDashboard-Updater" },
      timeout: 10000
    });

    let version = res.data.tag_name || "";
    if (version.startsWith("v")) version = version.substring(1);

    log("Neueste GitHub-Version: " + version);
    return version;

  } catch (err) {
    log("FEHLER beim Abrufen der Version: " + err.message);
    return null;
  }
}

function readEnv() {
  const envPath = path.resolve(__dirname, "..", ".env");
  const raw = fs.readFileSync(envPath, "utf8");
  const env = {};

  raw.split("\n").forEach(line => {
    const t = line.trim();
    if (!t || t.startsWith("#")) return;
    const [k, ...rest] = t.split("=");
    env[k] = rest.join("=");
  });

  return { env, envPath };
}

function writeEnv(env, envPath) {
  const lines = Object.entries(env).map(([k, v]) => `${k}=${v}`);
  fs.writeFileSync(envPath, lines.join("\n") + "\n");
}

function runUpdate(version) {
  const composeDir = path.resolve(__dirname, "..");

  log("Starte Docker Update-Prozess…");

  execSync("docker compose pull", { cwd: composeDir, stdio: "inherit" });
  execSync("docker compose up -d", { cwd: composeDir, stdio: "inherit" });

  log("Update erfolgreich installiert auf Version " + version);
}

async function checkForUpdates() {
  log("Überprüfe Updates…");

  const { env, envPath } = readEnv();

  if (!env.APP_VERSION) {
    log("WARN: APP_VERSION nicht in .env gefunden!");
    return;
  }

  const current = env.APP_VERSION;
  const latest = await getLatestVersion();

  if (!latest) return;
  if (latest === current) {
    log("Keine neue Version verfügbar.");
    return;
  }

  log(`Update erforderlich: ${current} -> ${latest}`);

  // ENV aktualisieren
  env.APP_VERSION = latest;
  writeEnv(env, envPath);

  // Docker Update
  runUpdate(latest);
}

(async () => {
  log("======= AUTO-UPDATER STARTED =======");
  while (true) {
    await checkForUpdates();
    await new Promise(r => setTimeout(r, config.checkInterval));
  }
})();

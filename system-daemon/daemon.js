const fs = require("fs");
const path = require("path");
const axios = require("axios");
const {
  readEnvVersion,
  writeEnvVersion,
  downloadImage,
  restartDashboard,
  log,
  resolvePath
} = require("./targets/docker-dashboard");

const BASE_DIR = __dirname;
const CONFIG_PATH =
  process.env.AUTUPDATE_CONFIG ||
  path.join(BASE_DIR, "config.json");

// Config laden
if (!fs.existsSync(CONFIG_PATH)) {
  console.error(`Config-Datei nicht gefunden: ${CONFIG_PATH}`);
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
const interval = config.checkIntervalMs || 60000;

async function getLatestVersion() {
  const res = await axios.get(config.updateApi, {
    headers: { "User-Agent": "customer-dashboard-system-daemon" }
  });

  let tag = res.data.tag_name || "";
  tag = tag.replace(/^v/i, "");
  return tag;
}

async function checkOnce() {
  try {
    log("=== System-Daemon: Update-Check gestartet ===", config);

    const latest = await getLatestVersion();
    const current = readEnvVersion(
      BASE_DIR,
      config.target.envFile,
      config.target.versionKey
    );

    log(`Aktuelle Version: ${current || "(unbekannt)"}`, config);
    log(`Neueste Version:  ${latest}`, config);

    if (!latest) {
      log("Konnte keine gültige Remote-Version ermitteln.", config);
      return;
    }

    if (current === latest) {
      log("Keine neue Version verfügbar.", config);
      return;
    }

    log(`Neue Version erkannt: ${current || "(keine)"} → ${latest}`, config);

    const mode = config.mode || "auto-install";

    // Nur Hinweis
    if (mode === "notify-only") {
      log("Mode=notify-only → nur Benachrichtigung, keine Aktion.", config);
      return;
    }

    // Download
    log("Lade neues Image herunter …", config);
    downloadImage(config, latest);
    log("Image erfolgreich geladen.", config);

    if (mode === "download-only") {
      log("Mode=download-only → Update vorbereitet, nicht installiert.", config);
      return;
    }

    // Auto-Install
    log("Mode=auto-install → Installation wird durchgeführt.", config);

    writeEnvVersion(
      BASE_DIR,
      config.target.envFile,
      config.target.versionKey,
      latest
    );
    log("APP_VERSION in .env aktualisiert.", config);

    restartDashboard(
      BASE_DIR,
      config.target.composeFile,
      config.target.serviceName
    );
    log("Update abgeschlossen. Healthcheck übernimmt Docker.", config);

  } catch (err) {
    log(`❌ Fehler im Update-Durchlauf: ${err.message}`, config);
  }
}

async function main() {
  log("Systemweiter Auto-Update-Daemon gestartet.", config);
  await checkOnce();               // direkt beim Start prüfen
  setInterval(checkOnce, interval); // dann alle X ms
}

main();

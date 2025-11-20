import fs from "fs";
import { execSync } from "child_process";
import fetch from "node-fetch";

// Pfade
const COMPOSE_FILE = "/app/docker-compose.yml";
const ENV_FILE = "/app/.env";

// Alle 60 Sekunden prüfen
const CHECK_INTERVAL = 60 * 1000;

function log(msg) {
    console.log(`[${new Date().toISOString()}] ${msg}`);
}

// 👉 Lokale Version aus .env lesen
function getLocalVersion() {
    const env = fs.readFileSync(ENV_FILE, "utf8");
    const line = env.split("\n").find(l => l.startsWith("APP_VERSION="));
    return line?.split("=")[1].trim() || "0.0.0";
}

// 👉 Remote Version holen
async function getRemoteVersion() {
    try {
        const res = await fetch("https://raw.githubusercontent.com/leoaigner7/customer-dashboard-v2/main/latest.json");
        const json = await res.json();
        return json.version;
    } catch (err) {
        log("❌ Konnte Remote-Version nicht abrufen.");
        return null;
    }
}

// 👉 .env aktualisieren
function updateEnvVersion(newVersion) {
    let env = fs.readFileSync(ENV_FILE, "utf8");
    env = env.replace(/APP_VERSION=.*/, `APP_VERSION=${newVersion}`);
    fs.writeFileSync(ENV_FILE, env);
    log(`📝 APP_VERSION auf ${newVersion} aktualisiert.`);
}

// 👉 Docker aktualisieren
function performUpdate(newVersion) {
    log("📥 Lade neues Image…");
    execSync(`docker compose -f ${COMPOSE_FILE} pull dashboard`, { stdio: "inherit" });

    log("🔄 Recreate Container…");
    execSync(`docker compose -f ${COMPOSE_FILE} up -d --force-recreate dashboard`, { stdio: "inherit" });

    log(`✅ Update auf ${newVersion} abgeschlossen.`);
}

// 👉 Version numerisch vergleichen
function isNewerVersion(remote, local) {
    const r = remote.split(".").map(Number);
    const l = local.split(".").map(Number);

    for (let i = 0; i < 3; i++) {
        if (r[i] > l[i]) return true;
        if (r[i] < l[i]) return false;
    }
    return false;
}

// 👉 Hauptlogik
async function checkForUpdates() {
    log("🔍 Prüfe auf Updates…");

    const local = getLocalVersion();
    const remote = await getRemoteVersion();

    if (!remote) return;

    log(`📌 Lokale Version:  ${local}`);
    log(`📌 Remote Version: ${remote}`);

    if (!isNewerVersion(remote, local)) {
        log("👌 Keine neue Version vorhanden.");
        return;
    }

    log(`🚀 Neue Version gefunden: ${remote}`);

    updateEnvVersion(remote);
    performUpdate(remote);
}

// Endlosschleife
(async () => {
    while (true) {
        await checkForUpdates();
        await new Promise(r => setTimeout(r, CHECK_INTERVAL));
    }
})();

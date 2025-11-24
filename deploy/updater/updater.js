const fs = require("fs");
const axios = require("axios");
const path = require("path");
const { execSync } = require("child_process");
const config = require("./config.json");

function log(msg) {
    const stamp = new Date().toISOString();
    console.log(`[${stamp}] ${msg}`);
    fs.appendFileSync("/app/updater.log", `[${stamp}] ${msg}\n`);
}

function readEnvVersion(envPath, key) {
    const env = fs.readFileSync(envPath, "utf8").split("\n");
    const line = env.find(l => l.startsWith(key + "="));
    if (!line) return null;
    return line.split("=")[1].trim();
}

function writeEnvVersion(envPath, key, version) {
    const lines = fs.readFileSync(envPath, "utf8").split("\n");
    const out = lines.map(l => l.startsWith(key + "=") ? `${key}=${version}` : l);
    fs.writeFileSync(envPath, out.join("\n"));
}

async function checkForUpdates() {
    log("Prüfe GitHub Releases ...");

    // API
    const res = await axios.get(config.updateApi, {
        headers: { "User-Agent": "auto-updater" }
    });
    const latestTag = res.data.tag_name;
    const latest = latestTag.replace(/^v/, "");

    const envVersion = readEnvVersion(config.envFile, config.versionKey);
    log(`Aktuelle Version: ${envVersion}`);
    log(`Neueste Version: ${latest}`);

    if (envVersion === latest) {
        log("Keine neue Version gefunden.");
        return;
    }

    log(`UPDATE VERFÜGBAR: ${envVersion} -> ${latest}`);

    // Update .env
    writeEnvVersion(config.envFile, config.versionKey, latest);
    log("ENV-Version aktualisiert!");

    // Docker Update ausführen
    log("Führe docker compose pull aus …");
    execSync(`docker-compose -f ${config.composeFile} pull`, { stdio: "inherit" });

    log("Führe docker compose up -d aus …");
    execSync(`docker-compose -f ${config.composeFile} up -d`, { stdio: "inherit" });

    log("Update erfolgreich abgeschlossen.");
}

(async () => {
    log("Auto-Updater gestartet.");
    while (true) {
        try {
            await checkForUpdates();
        } catch (err) {
            log("Fehler: " + err.message);
        }
        await new Promise(r => setTimeout(r, config.checkInterval));
    }
})();

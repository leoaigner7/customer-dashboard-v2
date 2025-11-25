const fs = require("fs");
const axios = require("axios");
const { execSync } = require("child_process");
const config = require("./config.json");

function log(msg) {
    const stamp = new Date().toISOString();
    console.log(`[${stamp}] ${msg}`);
    fs.appendFileSync("/app/updater.log", `[${stamp}] ${msg}\n`);
}

function readEnvVersion(path, key) {
    const content = fs.readFileSync(path, "utf8");
    const line = content.split("\n").find(l => l.startsWith(key + "="));
    return line ? line.split("=")[1].trim() : null;
}

function writeEnvVersion(path, key, version) {
    let content = fs.readFileSync(path, "utf8").split("\n");
    content = content.map(l => l.startsWith(key + "=") ? `${key}=${version}` : l);
    fs.writeFileSync(path, content.join("\n"));
}

async function checkForUpdates() {
    try {
        log("Prüfe GitHub Releases ...");

        const res = await axios.get(config.updateApi, {
            headers: { "User-Agent": "dashboard-updater" }
        });

        const latest = res.data.tag_name.replace("v", "");
        const current = readEnvVersion(config.envFile, config.versionKey);

        log(`Aktuelle Version: ${current}`);
        log(`Neueste Version: ${latest}`);

        if (!current || current === latest) {
            log("Keine neue Version vorhanden.");
            return;
        }

        log(`⚡ Update erkannt: ${current} → ${latest}`);

        writeEnvVersion(config.envFile, config.versionKey, latest);
        log("ENV aktualisiert.");

        // Nur dashboard aktualisieren – niemals updater stoppen
        log("docker compose pull dashboard …");
        execSync(`docker compose -f ${config.composeFile} pull dashboard`, {
            stdio: "inherit"
        });

        log("docker compose up -d --force-recreate dashboard …");
        execSync(
            `docker compose -f ${config.composeFile} up -d --force-recreate dashboard`,
            { stdio: "inherit" }
        );

        log("Update erfolgreich abgeschlossen.");
    } catch (err) {
        log("❌ Fehler: " + err.toString());
    }
}

(async () => {
    log("Auto-Updater gestartet.");
    while (true) {
        await checkForUpdates();
        await new Promise(r => setTimeout(r, config.checkInterval));
    }
})();

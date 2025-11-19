const fs = require("fs");
const axios = require("axios");
const { execSync } = require("child_process");
const config = require("./config.json");

function log(msg) {
    const stamp = new Date().toISOString();
    console.log(`[${stamp}] ${msg}`);
    fs.appendFileSync("updater.log", `[${stamp}] ${msg}\n`);
}

async function checkForUpdates() {
    try {
        log("Prüfe Update-Server ...");

        // Lese .env
        const envPath = config.envFile;
        let envContent = fs.readFileSync(envPath, "utf8");

        const versionLine = envContent
            .split("\n")
            .find((line) => line.startsWith(config.versionKey + "="));

        const currentVersion = versionLine
            ? versionLine.split("=")[1].trim()
            : "unknown";

        log("Aktuelle Version: " + currentVersion);

        // GitHub Release abrufen
        const response = await axios.get(config.updateApi, {
            headers: { "User-Agent": "CustomerDashboard-Updater" }
        });

        const tag = response.data.tag_name;
        const latestVersion = tag.startsWith("v") ? tag.substring(1) : tag;

        log("Neueste Version laut Server: " + latestVersion);

        if (currentVersion === latestVersion) {
            log("Kein Update notwendig.");
            return;
        }

        log(`Update verfügbar: ${currentVersion} → ${latestVersion}`);
        log("Aktualisiere .env ...");

        // .env neu schreiben
        const newEnv = envContent.replace(
            new RegExp("^" + config.versionKey + "=.*", "m"),
            config.versionKey + "=" + latestVersion
        );

        fs.writeFileSync(envPath, newEnv);

        log("Starte docker compose pull ...");
        execSync(`docker compose -f ${config.composeFile} pull`, { stdio: "inherit" });

        log("Starte docker compose up -d ...");
        execSync(`docker compose -f ${config.composeFile} up -d`, { stdio: "inherit" });

        log("Update erfolgreich abgeschlossen.");
    } catch (err) {
        log("FEHLER: " + err.message);
    }
}

// Hauptloop
(async () => {
    log("=== Customer Dashboard Auto-Updater gestartet ===");

    while (true) {
        await checkForUpdates();
        await new Promise((resolve) => setTimeout(resolve, config.checkInterval));
    }
})();

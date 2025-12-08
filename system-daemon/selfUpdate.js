const fs = require("fs");
const path = require("path");
const axios = require("axios");
const AdmZip = require("adm-zip");

/**
 * Lädt eine Datei per HTTP/S herunter.
 * @param {string} url
 * @param {string} dest
 */
async function downloadFile(url, dest) {
  const writer = fs.createWriteStream(dest);

  const res = await axios.get(url, { responseType: "stream" });
  return new Promise((resolve, reject) => {
    res.data.pipe(writer);
    let finished = false;
    writer.on("finish", () => {
      if (!finished) {
        finished = true;
        resolve();
      }
    });
    writer.on("error", (err) => {
      if (!finished) {
        finished = true;
        reject(err);
      }
    });
  });
}

/**
 * Wendet ein Self-Update für den Daemon an, falls konfiguriert.
 * Diese Funktion ist bewusst defensiv: wenn etwas schief geht, wird nur geloggt.
 */
async function checkAndApplySelfUpdate(config, logger, security) {
  if (!config.selfUpdate || !config.selfUpdate.enabled) {
    return;
  }

  const { zipUrl, localZipPath } = config.selfUpdate;
  if (!zipUrl && !localZipPath) {
    return;
  }

  const baseDir = __dirname;
  const currentDir = baseDir;
  const stagingDir = path.join(baseDir, "..", "system-daemon.new");
  const backupDir = path.join(baseDir, "..", "system-daemon.bak");
  const zipPath =
    localZipPath || path.join(baseDir, "daemon-update.zip");

  try {
    logger("info", "Prüfe auf Self-Update des Daemons...");

    if (zipUrl) {
      logger("info", `Lade Daemon-Update von ${zipUrl}...`);
      await downloadFile(zipUrl, zipPath);
    } else if (!fs.existsSync(zipPath)) {
      logger("debug", "Kein Self-Update ZIP gefunden, überspringe.");
      return;
    }

    // Optional: Hash- / Signaturprüfung
    if (config.security && config.security.requireHash && config.selfUpdate.hashUrl) {
      const hashRes = await axios.get(config.selfUpdate.hashUrl, { responseType: "text" });
      const expectedHash = hashRes.data.trim().split(/\s+/)[0];
      const ok = await security.verifySha256(zipPath, expectedHash);
      if (!ok) {
        logger("error", "Self-Update Hashprüfung fehlgeschlagen, breche ab.");
        return;
      }
    }

    if (config.security && config.security.requireSignature && config.selfUpdate.signatureUrl) {
      const signaturePath = zipPath + ".sig";
      const sigRes = await axios.get(config.selfUpdate.signatureUrl, { responseType: "arraybuffer" });
      fs.writeFileSync(signaturePath, Buffer.from(sigRes.data));
      const ok = await security.verifySignature(
        zipPath,
        signaturePath,
        config.security.publicKeyFile
      );
      if (!ok) {
        logger("error", "Self-Update Signaturprüfung fehlgeschlagen, breche ab.");
        return;
      }
    }

    logger("info", "Entpacke Self-Update ZIP in Staging...");
    if (fs.existsSync(stagingDir)) {
      fs.rmSync(stagingDir, { recursive: true, force: true });
    }
    fs.mkdirSync(stagingDir, { recursive: true });

    const zip = new AdmZip(zipPath);
    zip.extractAllTo(stagingDir, true);

    // Atomic Swap: aktuelles system-daemon verschieben, neues an seine Stelle.
    logger("info", "Wende Self-Update atomar an...");

    if (fs.existsSync(backupDir)) {
      fs.rmSync(backupDir, { recursive: true, force: true });
    }

    fs.renameSync(currentDir, backupDir);
    fs.renameSync(stagingDir, currentDir);

    logger("info", "Self-Update des Daemons wurde vorbereitet. Neuer Code wird beim nächsten Start aktiv.");

  } catch (err) {
    logger("error", "Fehler beim Self-Update des Daemons", { error: err.message });
  }
}

module.exports = {
  checkAndApplySelfUpdate
};

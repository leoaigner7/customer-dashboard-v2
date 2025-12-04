// system-daemon/daemon.js
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const AdmZip = require("adm-zip");
const crypto = require("crypto");
const semver = require("semver");

const {
  readEnvVersion,
  writeEnvVersion,
  downloadImage,
  restartDashboard,
  log
} = require("./targets/docker-dashboard");

const BASE_DIR = __dirname;
const CONFIG_PATH =
  process.env.AUTUPDATE_CONFIG ||
  path.join(BASE_DIR, "config.json");

if (!fs.existsSync(CONFIG_PATH)) {
  console.error("Config nicht gefunden: " + CONFIG_PATH);
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
const interval = config.checkIntervalMs || 300000;

const OFFLINE_ZIP  = config.offlineZip;
const OFFLINE_HASH = config.offlineHash;
const INSTALL_ROOT = config.installRoot;
const BACKUP_DIR   = config.backup && config.backup.dir;
const BACKUP_ENABLED = !!(config.backup && config.backup.enabled);
const BACKUP_KEEP    = (config.backup && config.backup.keep) || 3;

const VERSION_FILE = INSTALL_ROOT
  ? path.join(INSTALL_ROOT, "VERSION.txt")
  : null;

// -------------------------------------------------------------
// Versionen lesen – GitHub
// -------------------------------------------------------------
async function getGithubVersion() {
  if (!config.updateApi) return null;

  try {
    const res = await axios.get(config.updateApi, {
      headers: { "User-Agent": "customer-dashboard-system-daemon" }
    });

    let tag = null;

    // Fall 1: /releases → Array
    if (Array.isArray(res.data)) {
      const releases = res.data;

      const valid = releases.filter(r => r && r.tag_name);
      if (valid.length === 0) return null;

      valid.sort((a, b) =>
        semver.rcompare(
          a.tag_name.replace(/^v/i, ""),
          b.tag_name.replace(/^v/i, "")
        )
      );

      tag = valid[0].tag_name;
    }
    // Fall 2: /releases/latest → einzelnes Objekt
    else if (res.data && typeof res.data === "object" && res.data.tag_name) {
      tag = res.data.tag_name;
    }

    if (!tag) return null;
    const normalized = tag.replace(/^v/i, "").trim();
    return normalized || null;

  } catch (err) {
    log("GitHub-Version konnte nicht gelesen werden: " + err.message, config);
    return null;
  }
}

// -------------------------------------------------------------
// Versionen lesen – Offline-ZIP
// -------------------------------------------------------------
function getOfflineVersion() {
  if (!OFFLINE_ZIP) {
    return null;
  }

  if (!fs.existsSync(OFFLINE_ZIP)) {
    log("Offline-ZIP-Pfad existiert nicht: " + OFFLINE_ZIP, config);
    return null;
  }

  try {
    const stat = fs.statSync(OFFLINE_ZIP);
    if (stat.isDirectory()) {
      log(
        "Offline-ZIP-Pfad ist ein Verzeichnis, erwarte Datei: " + OFFLINE_ZIP,
        config
      );
      return null;
    }

    const zip = new AdmZip(OFFLINE_ZIP);
    const entry = zip.getEntry("VERSION.txt");
    if (!entry) {
      log("Offline-ZIP enthält keine VERSION.txt", config);
      return null;
    }
    const v = zip.readAsText(entry).trim();
    return v || null;
  } catch (err) {
    log("Offline-Version konnte nicht gelesen werden: " + err.message, config);
    return null;
  }
}

// -------------------------------------------------------------
// Versionsvergleich (semver-fähig)
// -------------------------------------------------------------
function compareVersions(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);

  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return a;
    if (nb > na) return b;
  }
  return a;
}

async function resolveLatestVersion() {
  const online  = await getGithubVersion();
  const offline = getOfflineVersion();

  log(
    `Remote-Versionen – GitHub: ${online || "-"} / Offline: ${offline || "-"}`,
    config
  );

  if (!online && !offline) return { version: null, source: "none" };
  if (online && !offline)   return { version: online,  source: "github" };
  if (!online && offline)   return { version: offline, source: "offline" };

  const winner = compareVersions(online, offline);

  return {
    version: winner,
    source: winner === offline ? "offline" : "github"
  };
}

// -------------------------------------------------------------
// SHA-256 Validierung für Offline-ZIP
// -------------------------------------------------------------
function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  const data = fs.readFileSync(filePath);
  hash.update(data);
  return hash.digest("hex");
}

function verifyOfflineZip() {
  if (!OFFLINE_ZIP || !fs.existsSync(OFFLINE_ZIP)) {
    log("Offline-ZIP nicht vorhanden, überspringe Offline-Validierung.", config);
    return false;
  }
  if (!OFFLINE_HASH || !fs.existsSync(OFFLINE_HASH)) {
    log("Offline-Hash-Datei nicht vorhanden, Offline-Update NICHT erlaubt.", config);
    return false;
  }

  try {
    const expected = fs.readFileSync(OFFLINE_HASH, "utf8")
      .split(/\s+/)[0]
      .trim();

    const actual = sha256File(OFFLINE_ZIP);

    if (expected.toLowerCase() !== actual.toLowerCase()) {
      log(
        `SHA-256 Mismatch für Offline-ZIP. expected=${expected}, actual=${actual}. Abbruch.`,
        config
      );
      return false;
    }

    log("SHA-256 für Offline-ZIP erfolgreich verifiziert.", config);
    return true;
  } catch (err) {
    log("Fehler bei Offline-Hashprüfung: " + err.message, config);
    return false;
  }
}

// -------------------------------------------------------------
// Backup + Rollback
// -------------------------------------------------------------
function copyRecursive(src, dest) {
  if (!fs.existsSync(src)) return;
  const stat = fs.statSync(src);

  if (stat.isDirectory()) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src);
    for (const entry of entries) {
      copyRecursive(
        path.join(src, entry),
        path.join(dest, entry)
      );
    }
  } else {
    const dir = path.dirname(dest);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

function createBackup() {
  if (!BACKUP_ENABLED || !BACKUP_DIR) return null;

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(BACKUP_DIR, timestamp);

  try {
    if (!fs.existsSync(BACKUP_DIR)) {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }
    copyRecursive(INSTALL_ROOT, backupPath);
    log("Backup erstellt unter: " + backupPath, config);
    pruneBackups();
    return backupPath;
  } catch (err) {
    log("Backup fehlgeschlagen: " + err.message, config);
    return null;
  }
}

function pruneBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return;

  const entries = fs.readdirSync(BACKUP_DIR)
    .map(name => ({
      name,
      time: fs.statSync(path.join(BACKUP_DIR, name)).mtimeMs
    }))
    .sort((a, b) => b.time - a.time);

  if (entries.length <= BACKUP_KEEP) return;

  const toDelete = entries.slice(BACKUP_KEEP);
  for (const e of toDelete) {
    const full = path.join(BACKUP_DIR, e.name);
    try {
      fs.rmSync(full, { recursive: true, force: true });
      log("Altes Backup gelöscht: " + full, config);
    } catch (err) {
      log("Fehler beim Löschen von Backup: " + err.message, config);
    }
  }
}

function restoreBackup(backupPath) {
  if (!backupPath || !fs.existsSync(backupPath)) {
    log("Kein gültiges Backup für Rollback vorhanden.", config);
    return;
  }

  try {
    log("Rollback gestartet. Stelle Backup wieder her: " + backupPath, config);
    fs.rmSync(INSTALL_ROOT, { recursive: true, force: true });
    copyRecursive(backupPath, INSTALL_ROOT);
    log("Rollback abgeschlossen.", config);
  } catch (err) {
    log("Rollback fehlgeschlagen: " + err.message, config);
  }
}

// -------------------------------------------------------------
// Update anwenden
// -------------------------------------------------------------
function applyOfflineUpdate() {
  if (!verifyOfflineZip()) {
    throw new Error("Offline-Update verweigert (Hashprüfung fehlgeschlagen).");
  }

  const zip = new AdmZip(OFFLINE_ZIP);
  zip.extractAllTo(INSTALL_ROOT, true);
  log("Offline-Update aus ZIP extrahiert nach " + INSTALL_ROOT, config);
}

function applyGithubUpdate(version) {
  downloadImage(config, version);
  log("Docker-Image für Version " + version + " geladen.", config);
}

// -------------------------------------------------------------
// Healthcheck
// -------------------------------------------------------------
async function checkHealth() {
  if (!config.target || !config.target.healthUrl) {
    log("Kein Healthcheck konfiguriert – überspringe.", config);
    return true;
  }

  try {
    await axios.get(config.target.healthUrl, { timeout: 5000 });
    log("Healthcheck OK für " + config.target.healthUrl, config);
    return true;
  } catch (err) {
    log("Healthcheck FEHLER: " + err.message, config);
    return false;
  }
}

// -------------------------------------------------------------
// System-Validierung
// -------------------------------------------------------------
function validateSystem() {
  if (!INSTALL_ROOT) {
    log("INSTALL_ROOT nicht gesetzt, breche Update ab.", config);
    return false;
  }

  try {
    if (!fs.existsSync(INSTALL_ROOT)) {
      fs.mkdirSync(INSTALL_ROOT, { recursive: true });
    }
  } catch (err) {
    log(
      "INSTALL_ROOT kann nicht erstellt/geschrieben werden: " + err.message,
      config
    );
    return false;
  }

  return true;
}

// -------------------------------------------------------------
// Versionen lesen / schreiben (automatisch, docker-unabhängig)
// -------------------------------------------------------------
function readInstalledVersion() {
  let current = null;

  // 1) Prefer: VERSION.txt
  if (VERSION_FILE && fs.existsSync(VERSION_FILE)) {
    try {
      const v = fs.readFileSync(VERSION_FILE, "utf8").trim();
      if (v) return v;
    } catch (err) {
      log("VERSION.txt konnte nicht gelesen werden: " + err.message, config);
    }
  }

  // 2) Fallback: .env
  current = readEnvVersion(
    BASE_DIR,
    config.target.envFile,
    config.target.versionKey
  );

  return current || null;
}

function writeInstalledVersion(version) {
  // 1) .env aktualisieren
  writeEnvVersion(
    BASE_DIR,
    config.target.envFile,
    config.target.versionKey,
    version
  );

  // 2) VERSION.txt aktualisieren
  if (VERSION_FILE) {
    try {
      fs.writeFileSync(VERSION_FILE, version + "\n", "utf8");
      log("VERSION.txt auf " + version + " gesetzt.", config);
    } catch (err) {
      log("VERSION.txt konnte nicht geschrieben werden: " + err.message, config);
    }
  }
}

// -------------------------------------------------------------
// Update-Durchlauf
// -------------------------------------------------------------
async function checkOnce() {
  try {
    log("=== Update-Check gestartet ===", config);

    if (!validateSystem()) {
      log("System-Validierung fehlgeschlagen. Abbruch.", config);
      return;
    }

    const current = readInstalledVersion();

    log("Aktuell installierte Version: " + (current || "(unbekannt)"), config);

    const { version: latest, source } = await resolveLatestVersion();

    if (!latest) {
      log("Keine Remote-Version verfügbar.", config);
      return;
    }

    log(`Ermittelte Zielversion: ${latest} (Quelle: ${source})`, config);

    if (current === latest) {
      log("System ist bereits auf dem neuesten Stand.", config);
      return;
    }

    const backupPath = createBackup();

    if (source === "offline") {
      log("Wende OFFLINE-Update an.", config);
      applyOfflineUpdate();
    } else if (source === "github") {
      log("Wende GITHUB-Update an.", config);
      applyGithubUpdate(latest);
    } else {
      log("Unbekannte Quelle, breche Update ab.", config);
      return;
    }

    // Installierte Version nach Update setzen
    writeInstalledVersion(latest);

    restartDashboard(
      BASE_DIR,
      config.target.composeFile,
      config.target.serviceName
    );
    log("Dashboard nach Update neu gestartet.", config);

    const ok = await checkHealth();
    if (!ok && BACKUP_ENABLED) {
      log("Update fehlgeschlagen – starte Rollback.", config);
      restoreBackup(backupPath);
      restartDashboard(
        BASE_DIR,
        config.target.composeFile,
        config.target.serviceName
      );
    } else if (!ok) {
      log("Update fehlgeschlagen, aber Backup ist deaktiviert.", config);
    } else {
      log("Update erfolgreich abgeschlossen.", config);
    }

  } catch (err) {
    log("❌ Fehler im Update-Durchlauf: " + err.message, config);
  }
}

// -------------------------------------------------------------
// Start
// -------------------------------------------------------------
async function main() {
  log("Systemweiter Auto-Update-Daemon gestartet.", config);
  await checkOnce();
  setInterval(checkOnce, interval);
}

main();

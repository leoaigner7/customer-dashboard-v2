const fs = require("fs");
const path = require("path");
const axios = require("axios");
const AdmZip = require("adm-zip");
const semver = require("semver");
const crypto = require("crypto");

const {
  log,
  readEnvVersion,
  writeEnvVersion,
  downloadImage,
  restartDashboard,
  getRunningDockerVersion,
} = require("./targets/docker-dashboard");

const BASE_DIR = __dirname;
const CONFIG_PATH =
  process.env.AUTUPDATE_CONFIG || path.join(BASE_DIR, "config.json");

if (!fs.existsSync(CONFIG_PATH)) {
  console.error("Config nicht gefunden: " + CONFIG_PATH);
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
const interval = config.checkIntervalMs || 300000;

const INSTALL_ROOT = config.installRoot;
const OFFLINE_ZIP = config.offlineZip || "";
const OFFLINE_HASH = config.offlineHash || "";

// --------------------------------------------------
// Hilfsfunktionen
// --------------------------------------------------
function safeStat(p) {
  try {
    return fs.statSync(p);
  } catch {
    return null;
  }
}

// Installierte Version ermitteln:
// 1) VERSION.txt im installRoot
// 2) .env (APP_VERSION)
// 3) Docker-Image-Tag
function detectInstalledVersion() {
  // 1) VERSION.txt
  try {
    const vf = path.join(INSTALL_ROOT, "VERSION.txt");
    if (fs.existsSync(vf)) {
      const v = fs.readFileSync(vf, "utf8").trim();
      if (v) return v;
    }
  } catch {}

  // 2) .env
  try {
    const v = readEnvVersion(
      BASE_DIR,
      config.target.envFile,
      config.target.versionKey
    );
    if (v) return v;
  } catch {}

  // 3) Docker
  try {
    const v = getRunningDockerVersion(config.target.serviceName);
    if (v) return v;
  } catch {}

  return "(unbekannt)";
}

// GitHub-Version
async function getGithubVersion() {
  if (!config.updateApi) return null;
  try {
    const res = await axios.get(config.updateApi, {
      headers: { "User-Agent": "customer-dashboard-system-daemon" },
    });
    let tag = res.data.tag_name || "";
    tag = tag.replace(/^v/, "").trim();
    return tag || null;
  } catch (e) {
    return null;
  }
}

// Offline-Version aus ZIP (falls echte Datei)
function getOfflineVersion() {
  if (!OFFLINE_ZIP) return null;
  const st = safeStat(OFFLINE_ZIP);
  if (!st || !st.isFile()) return null;

  try {
    const zip = new AdmZip(OFFLINE_ZIP);
    const entry = zip.getEntry("VERSION.txt");
    if (!entry) return null;
    const v = zip.readAsText(entry).trim();
    return v || null;
  } catch {
    return null;
  }
}

// Offline-Hash prüfen (SHA256)
function verifyOfflineZip() {
  if (!OFFLINE_ZIP || !OFFLINE_HASH) return false;
  const st = safeStat(OFFLINE_ZIP);
  if (!st || !st.isFile()) return false;
  if (!fs.existsSync(OFFLINE_HASH)) return false;

  const expected = fs.readFileSync(OFFLINE_HASH, "utf8").split(/\s+/)[0].trim();
  const buf = fs.readFileSync(OFFLINE_ZIP);
  const actual = crypto.createHash("sha256").update(buf).digest("hex");

  return (
    expected &&
    actual &&
    expected.toLowerCase() === actual.toLowerCase()
  );
}

// Versionsvergleich online/offline
function resolveLatestVersion(online, offline) {
  if (online && !offline) return { version: online, source: "github" };
  if (!online && offline) return { version: offline, source: "offline" };
  if (!online && !offline) return null;

  try {
    // neueste via semver
    const newer = semver.gt(online, offline) ? online : offline;
    const source = newer === online ? "github" : "offline";
    return { version: newer, source };
  } catch {
    // Fallback: online gewinnt
    return { version: online, source: "github" };
  }
}

// Offline-Update anwenden (ZIP ins installRoot entpacken)
function applyOfflineUpdate() {
  if (!verifyOfflineZip()) {
    throw new Error("Offline ZIP SHA256 ungültig");
  }

  const zip = new AdmZip(OFFLINE_ZIP);
  zip.extractAllTo(INSTALL_ROOT, true);
}

// VERSION.txt aktualisieren
function saveVersionTxt(version) {
  try {
    const vf = path.join(INSTALL_ROOT, "VERSION.txt");
    fs.writeFileSync(vf, version, "utf8");
  } catch (e) {
    // bewusst nur loggen, nicht abbrechen
    console.error("Konnte VERSION.txt nicht schreiben:", e.message);
  }
}

// --------------------------------------------------
// Hauptlogik: Einmaliger Check
// --------------------------------------------------
async function checkOnce() {
  log("=== Update-Check gestartet ===", config);

  // aktuell installierte Version feststellen
  const current = detectInstalledVersion();
  log("Aktuell installierte Version: " + current, config);

  // Remote-Versionen
  const online = await getGithubVersion();
  const offline = getOfflineVersion();

  log(
    `Remote-Versionen – GitHub: ${online || "-"} / Offline: ${
      offline || "-"
    }`,
    config
  );

  const resolved = resolveLatestVersion(online, offline);
  if (!resolved) {
    log("Keine Remote-Version verfügbar.", config);
    return;
  }

  const latest = resolved.version;
  const source = resolved.source;

  log(
    `Ermittelte Zielversion: ${latest} (Quelle: ${source})`,
    config
  );

  if (current === latest) {
    log("System ist bereits auf dem neuesten Stand.", config);
    return;
  }

  // Update ausführen
  if (source === "offline") {
    log("Wende Offline-Update an…", config);
    applyOfflineUpdate();
  } else {
    log("Wende GitHub-Update an…", config);
    await downloadImage(config, latest);
  }

  // VERSION.txt & .env aktualisieren
  saveVersionTxt(latest);
  writeEnvVersion(
    BASE_DIR,
    config.target.envFile,
    config.target.versionKey,
    latest
  );

  // Dashboard neu starten (Docker Compose)
  await restartDashboard(
    BASE_DIR,
    config.target.composeFile,
    config.target.serviceName
  );

  log("Update erfolgreich abgeschlossen.", config);
}

// --------------------------------------------------
// main
// --------------------------------------------------
async function main() {
  log("Systemweiter Auto-Update-Daemon gestartet.", config);

  try {
    await checkOnce();
  } catch (e) {
    log("FEHLER im Update-Check: " + e.stack, config);
  }

  setInterval(async () => {
    try {
      await checkOnce();
    } catch (e) {
      log("FEHLER im periodischen Update-Check: " + e.stack, config);
    }
  }, interval);
}

main();

const fs = require("fs");
const path = require("path");
const axios = require("axios");
const AdmZip = require("adm-zip");
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

const OFFLINE_ZIP = config.offlineZip;
const INSTALL_ROOT = config.installRoot;
const BACKUP_DIR = config.backup && config.backup.dir;
const BACKUP_ENABLED = !!(config.backup && config.backup.enabled);
const BACKUP_KEEP = (config.backup && config.backup.keep) || 3;


// -------------------------------------------------------------
// Versionen lesen
// -------------------------------------------------------------
async function getGithubVersion() {
  if (!config.updateApi) return null;

  try {
    const res = await axios.get(config.updateApi, {
      headers: { "User-Agent": "customer-dashboard-system-daemon" }
    });

    let tag = res.data.tag_name || "";
    return tag.replace(/^v/i, "").trim();
  } catch {
    return null;
  }
}

function getOfflineVersion() {
  if (!OFFLINE_ZIP || !fs.existsSync(OFFLINE_ZIP)) return null;

  try {
    const zip = new AdmZip(OFFLINE_ZIP);
    const entry = zip.getEntry("VERSION.txt");
    if (!entry) return null;
    return zip.readAsText(entry).trim();
  } catch {
    return null;
  }
}

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
  const online = await getGithubVersion();
  const offline = getOfflineVersion();

  if (!online && !offline) return { version: null, source: "none" };
  if (online && !offline) return { version: online, source: "github" };
  if (!online && offline) return { version: offline, source: "offline" };

  const winner = compareVersions(online, offline);

  return {
    version: winner,
    source: winner === offline ? "offline" : "github"
  };
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
  if (!BACKUP_ENABLED) return null;

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(BACKUP_DIR, timestamp);

  try {
    if (!fs.existsSync(BACKUP_DIR)) {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }
    copyRecursive(INSTALL_ROOT, backupPath);
    pruneBackups();
    return backupPath;
  } catch {
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
    fs.rmSync(path.join(BACKUP_DIR, e.name), { recursive: true, force: true });
  }
}

function restoreBackup(backupPath) {
  if (!backupPath || !fs.existsSync(backupPath)) return;

  fs.rmSync(INSTALL_ROOT, { recursive: true, force: true });
  copyRecursive(backupPath, INSTALL_ROOT);
}


// -------------------------------------------------------------
// Update anwenden
// -------------------------------------------------------------
function applyOfflineUpdate() {
  const zip = new AdmZip(OFFLINE_ZIP);
  zip.extractAllTo(INSTALL_ROOT, true);
}

function applyGithubUpdate(version) {
  downloadImage(config, version);
}


// -------------------------------------------------------------
// Healthcheck
// -------------------------------------------------------------
async function checkHealth() {
  if (!config.target.healthUrl) return true;

  try {
    await axios.get(config.target.healthUrl, { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}


// -------------------------------------------------------------
// Update-Durchlauf
// -------------------------------------------------------------
async function checkOnce() {
  try {
    const current = readEnvVersion(
      BASE_DIR,
      config.target.envFile,
      config.target.versionKey
    );

    const { version: latest, source } = await resolveLatestVersion();

    if (!latest || latest === current) return;

    const backupPath = createBackup();

    if (source === "offline") applyOfflineUpdate();
    if (source === "github") applyGithubUpdate(latest);

    writeEnvVersion(
      BASE_DIR,
      config.target.envFile,
      config.target.versionKey,
      latest
    );

    restartDashboard(
      BASE_DIR,
      config.target.composeFile,
      config.target.serviceName
    );

    const ok = await checkHealth();
    if (!ok && BACKUP_ENABLED) {
      restoreBackup(backupPath);
      restartDashboard(
        BASE_DIR,
        config.target.composeFile,
        config.target.serviceName
      );
    }

  } catch (err) {
    log("Fehler: " + err.message, config);
  }
}


// -------------------------------------------------------------
// Start
// -------------------------------------------------------------
async function main() {
  await checkOnce();
  setInterval(checkOnce, interval);
}

main();

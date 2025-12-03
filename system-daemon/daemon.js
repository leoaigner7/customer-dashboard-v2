const fs = require("fs");
const path = require("path");
const axios = require("axios");
const AdmZip = require("adm-zip");
const crypto = require("crypto");
const { execSync } = require("child_process");

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
const OFFLINE_HASH = config.offlineHash;
const INSTALL_ROOT = config.installRoot;
// WICHTIG: Staging als Geschwister-Ordner, nicht als Unterordner!
const STAGING_DIR = INSTALL_ROOT + "_staging";

const BACKUP_DIR = config.backup && config.backup.dir;
const BACKUP_ENABLED = !!(config.backup && config.backup.enabled);
const BACKUP_KEEP = (config.backup && config.backup.keep) || 3;


// -------------------------------------------------------------
// SHA256 HASH
// -------------------------------------------------------------
function sha256File(filePath) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex");
}


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
      copyRecursive(path.join(src, entry), path.join(dest, entry));
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
  } catch (err) {
    log("Backup failed: " + err.message, config);
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
function applyOfflineUpdateToStaging() {
  if (fs.existsSync(STAGING_DIR)) {
    fs.rmSync(STAGING_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(STAGING_DIR, { recursive: true });

  const zip = new AdmZip(OFFLINE_ZIP);
  zip.extractAllTo(STAGING_DIR, true);
}

function applyGithubUpdate(version) {
  // Online-Update (Docker-Image ziehen, etc.)
  downloadImage(config, version);
}


// -------------------------------------------------------------
// Staging-Compose (override auf Port 18080)
// -------------------------------------------------------------
function writeStagingOverride() {
  const overridePath = path.join(STAGING_DIR, "compose.override.yml");
  const content = `
services:
  ${config.target.serviceName}:
    ports:
      - "18080:3000"
`;
  fs.writeFileSync(overridePath, content.trim());
  return overridePath;
}

function startStagingCompose() {
  const composeFile = config.target.composeFile;
  const override = path.join(STAGING_DIR, "compose.override.yml");

  const cmd = `docker compose -f "${composeFile}" -f "${override}" up -d ${config.target.serviceName}`;
  log("Starting staging compose: " + cmd, config);
  execSync(cmd, { stdio: "inherit" });
}

function stopStagingCompose() {
  const composeFile = config.target.composeFile;
  const override = path.join(STAGING_DIR, "compose.override.yml");

  const cmd = `docker compose -f "${composeFile}" -f "${override}" down`;
  log("Stopping staging compose: " + cmd, config);
  execSync(cmd, { stdio: "inherit" });
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

async function checkStagingHealth() {
  try {
    await axios.get("http://localhost:18080/", { timeout: 5000 });
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

    if (!latest || latest === current) {
      return;
    }

    log(`New version available: ${latest} (source=${source}), current=${current}`, config);

    // --------------------- OFFLINE UPDATE ---------------------
    if (source === "offline") {
      // 1) Hash prüfen
      if (!OFFLINE_HASH || !fs.existsSync(OFFLINE_HASH)) {
        log("Hash file missing: " + OFFLINE_HASH, config);
        return;
      }

      const expected = fs.readFileSync(OFFLINE_HASH, "utf8").trim();
      const actual = sha256File(OFFLINE_ZIP).trim();

      if (expected !== actual) {
        log("ZIP Hash mismatch – ABORTING offline update!", config);
        return;
      }

      log("Offline ZIP hash verified successfully", config);

      // 2) Backup
      const backupPath = createBackup();
      log("Backup created at: " + backupPath, config);

      // 3) Update nach STAGING
      applyOfflineUpdateToStaging();
      writeStagingOverride();

      // 4) Staging-Compose starten
      startStagingCompose();

      // kleine Wartezeit
      await new Promise(r => setTimeout(r, 5000));

      const stagingOk = await checkStagingHealth();

      // Staging wieder stoppen
      stopStagingCompose();

      if (!stagingOk) {
        log("Staging healthcheck failed – restoring backup and aborting update.", config);
        if (BACKUP_ENABLED) restoreBackup(backupPath);
        return;
      }

      log("Staging healthcheck OK – performing atomic swap.", config);

      // 5) Atomic Swap: STAGING → INSTALL_ROOT
      if (fs.existsSync(INSTALL_ROOT)) {
        fs.rmSync(INSTALL_ROOT, { recursive: true, force: true });
      }
      fs.renameSync(STAGING_DIR, INSTALL_ROOT);

      // 6) Version in .env schreiben
      writeEnvVersion(
        BASE_DIR,
        config.target.envFile,
        config.target.versionKey,
        latest
      );

      // 7) Produktiv-Dashboard neu starten
      restartDashboard(
        BASE_DIR,
        config.target.composeFile,
        config.target.serviceName
      );

      // 8) Healthcheck produktiv
      const ok = await checkHealth();
      if (!ok && BACKUP_ENABLED) {
        log("Production healthcheck failed – rolling back to backup.", config);
        restoreBackup(backupPath);

        restartDashboard(
          BASE_DIR,
          config.target.composeFile,
          config.target.serviceName
        );
      }

      return;
    }

    // --------------------- GITHUB / ONLINE UPDATE ---------------------
    if (source === "github") {
      const backupPath = createBackup();
      log("Backup created at: " + backupPath, config);

      applyGithubUpdate(latest);

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
        log("Online update healthcheck failed – rolling back to backup.", config);
        restoreBackup(backupPath);

        restartDashboard(
          BASE_DIR,
          config.target.composeFile,
          config.target.serviceName
        );
      }

      return;
    }

  } catch (err) {
    log("Fehler im Update-Durchlauf: " + err.message, config);
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

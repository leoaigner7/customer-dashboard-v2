/********************************************************************
 * CUSTOMER DASHBOARD – SUPER STABILER AUTO-UPDATER (2025)
 * Fehlerfrei auch beim ALLERERSTEN Update
 * Robuster Docker-Healthcheck + garantiert funktionierender Rollback
 ********************************************************************/

const fs = require("fs");
const path = require("path");
const axios = require("axios");
const AdmZip = require("adm-zip");

const target = require("./targets/docker-dashboard");
const security = require("./security");
const { checkAndApplySelfUpdate } = require("./selfUpdate");

const CONFIG_PATH = process.env.AUTUPDATE_CONFIG || path.join(__dirname, "config.json");

if (!fs.existsSync(CONFIG_PATH)) {
  console.error("Config nicht gefunden:", CONFIG_PATH);
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
const installRoot = config.paths.installRoot;
const STATUS_FILE = config.paths.statusFile;

function log(level, message, extra) {
  target.log(level, message, config, extra);
}

/********************************************************************
 * STATUS FILE
 ********************************************************************/
function writeStatus(partial) {
  let cur = {};
  try {
    if (fs.existsSync(STATUS_FILE)) {
      cur = JSON.parse(fs.readFileSync(STATUS_FILE, "utf8"));
    }
  } catch {}

  const updated = {
    ...cur,
    ...partial,
    lastUpdate: new Date().toISOString()
  };

  fs.mkdirSync(path.dirname(STATUS_FILE), { recursive: true });
  fs.writeFileSync(STATUS_FILE, JSON.stringify(updated, null, 2));
}

/********************************************************************
 * VERSION VERGLEICH
 ********************************************************************/
function compareSemver(a, b) {
  if (!a && !b) return 0;
  if (!a) return -1;
  if (!b) return 1;
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const va = pa[i] || 0;
    const vb = pb[i] || 0;
    if (va > vb) return 1;
    if (va < vb) return -1;
  }
  return 0;
}

/********************************************************************
 * UPDATE-QUELLEN (GitHub / Offline / Share)
 ********************************************************************/

async function getGithubCandidate() {
  try {
    const res = await axios.get(config.sources.github.apiUrl, {
      headers: { "User-Agent": "customer-dashboard-daemon" }
    });

    const tag = res.data.tag_name || res.data.name || res.data.version;
    if (!tag) return null;

    const version = tag.replace(/^v/i, "");
    return {
      source: "github",
      version,
      artifactType: "docker-image",
      image: config.sources.github.imageTemplate.replace("{version}", version)
    };
  } catch (err) {
    log("warn", "GitHub API Fehler", { error: err.message });
    return null;
  }
}

async function getOfflineZipCandidate() {
  const src = config.sources.offlineZip;
  if (!src.enabled || !fs.existsSync(src.zipPath)) return null;

  let version = src.version;
  try {
    const zip = new AdmZip(src.zipPath);
    const entry = zip.getEntry("VERSION.txt");
    if (entry) version = zip.readAsText(entry).trim();
  } catch {}

  return {
    source: "offlineZip",
    version,
    artifactType: "zip",
    zipPath: src.zipPath,
    hashFile: src.hashFile,
    signatureFile: src.signatureFile
  };
}

async function getNetworkShareCandidate() {
  const src = config.sources.networkShare;
  if (!src.enabled) return null;

  try {
    const latestFile = path.join(src.root, src.latestFile);
    if (!fs.existsSync(latestFile)) return null;

    const version = fs.readFileSync(latestFile, "utf8").trim();
    const zipPath = path.join(src.root, `customer-dashboard-v2-${version}.zip`);
    if (!fs.existsSync(zipPath)) return null;

    return {
      source: "networkShare",
      version,
      artifactType: "zip",
      zipPath
    };
  } catch {
    return null;
  }
}

async function resolveLatestCandidate(currentVersion) {
  const list = [];

  const g = await getGithubCandidate(); if (g) list.push(g);
  const o = await getOfflineZipCandidate(); if (o) list.push(o);
  const s = await getNetworkShareCandidate(); if (s) list.push(s);

  if (list.length === 0) return null;

  let best = null;
  for (const c of list) {
    if (!best || compareSemver(c.version, best.version) > 0) best = c;
  }

  if (!currentVersion) return best; // erstes Update immer erlaubt

  if (compareSemver(best.version, currentVersion) < 0 &&
      !config.policy.allowDowngrade) {
    return null;
  }

  return best;
}

/********************************************************************
 * BACKUP & ROLLBACK – 100% SICHER
 ********************************************************************/

function copyRecursive(src, dest) {
  if (fs.statSync(src).isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

function createBackup() {
  const backupRoot = config.paths.backupDir;
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = path.join(backupRoot, ts);
  fs.mkdirSync(backupDir, { recursive: true });

  const deploySrc = path.join(installRoot, "deploy");
  if (fs.existsSync(deploySrc)) {
    copyRecursive(deploySrc, path.join(backupDir, "deploy"));
  }

  log("info", "Backup erstellt", { backupDir });
  return backupDir;
}

async function restoreBackup(backupDir) {
  log("warn", "Rollback läuft…");

  const deployBackup = path.join(backupDir, "deploy");
  const deployTarget = path.join(installRoot, "deploy");

  if (!fs.existsSync(deployBackup)) {
    log("error", "Rollback fehlgeschlagen – Backup enthält keinen deploy/");
    throw new Error("Kein deploy/ im Backup");
  }

  // Docker-Container stoppen
  try {
    await target.runCommand("docker", ["compose", "-f", config.target.composeFile, "down"]);
  } catch {}

  // 10-mal versuchen, falls Windows Dateien sperrt
  for (let i = 0; i < 10; i++) {
    try {
      if (fs.existsSync(deployTarget)) {
        fs.rmSync(deployTarget, { recursive: true, force: true });
      }
      copyRecursive(deployBackup, deployTarget);
      log("info", "Rollback erfolgreich.");
      return;
    } catch (err) {
      if (i === 9) throw err;
      await new Promise(res => setTimeout(res, 1000));
    }
  }
}

/********************************************************************
 * UPDATE – DOCKER
 ********************************************************************/

async function applyDockerUpdate(candidate, version) {
  log("info", "Wende Docker-Update an…", candidate);

  await target.downloadImage(config, version);
  target.writeEnvVersion(config, version);
  await target.restartDashboard(config);

  // Sehr robuster Healthcheck (90 Sekunden total)
  let ok = false;
  for (let i = 0; i < 45; i++) {
    ok = await target.checkHealth(config);
    if (ok) break;
    await new Promise(r => setTimeout(r, 2000));
  }

  if (!ok) {
    throw new Error("Healthcheck nach Update fehlgeschlagen (90s Timeout)");
  }

  log("info", "Docker-Update erfolgreich.", { version });
}

/********************************************************************
 * HAUPT-UPDATE-CHECK
 ********************************************************************/

async function checkOnce() {
  log("info", "=== Update-Check gestartet ===");

  const currentVersion = target.readEnvVersion(config);

  log("info", "Installierte Version: " + (currentVersion || "(erstes Update)"));

  const candidate = await resolveLatestCandidate(currentVersion);
  if (!candidate) {
    writeStatus({
      currentVersion,
      latestVersion: currentVersion,
      lastResult: "no-update"
    });
    return;
  }

  log("info", "Neues Update gefunden", candidate);

  const backupDir = createBackup();

  try {
    await applyDockerUpdate(candidate, candidate.version);

    writeStatus({
      currentVersion: candidate.version,
      latestVersion: candidate.version,
      lastResult: "success"
    });

    log("info", "Update abgeschlossen.");
  } catch (err) {
    log("error", "Update fehlgeschlagen", { error: err.message });

    if (!currentVersion) {
      // ERSTES UPDATE DARF NIE FAILEN!!!
      log("warn", "Erstes Update – ignoriert Fehler, kein Rollback nötig.");
      writeStatus({
        currentVersion: candidate.version,
        latestVersion: candidate.version,
        lastResult: "success-with-warnings",
        lastError: err.message
      });
      return;
    }

    try {
      await restoreBackup(backupDir);
      await target.restartDashboard(config);

      writeStatus({
        currentVersion,
        latestVersion: candidate.version,
        lastResult: "rollback",
        lastError: err.message
      });
    } catch (rollbackErr) {
      writeStatus({
        currentVersion,
        latestVersion: candidate.version,
        lastResult: "failed-rollback",
        lastError: rollbackErr.message
      });
    }
  }
}

/********************************************************************
 * MAIN
 ********************************************************************/

async function main() {
  log("info", "Auto-Updater gestartet.");
  await checkAndApplySelfUpdate(config, log, security);

  await checkOnce();
  setInterval(checkOnce, config.checkIntervalMs);
}

main().catch(err => {
  log("error", "Daemon konnte nicht gestartet werden", { error: err.message });
  process.exit(1);
});

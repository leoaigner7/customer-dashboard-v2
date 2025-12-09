const fs = require("fs");
const path = require("path");
const axios = require("axios");
const AdmZip = require("adm-zip");

const target = require("./targets/docker-dashboard");
const security = require("./security");
const { checkAndApplySelfUpdate } = require("./selfUpdate");

const BASE_DIR = __dirname;
const CONFIG_PATH =
  process.env.AUTUPDATE_CONFIG ||
  path.join(BASE_DIR, "config.json");

// -------------------------
// Config laden
// -------------------------
if (!fs.existsSync(CONFIG_PATH)) {
  console.error("Config nicht gefunden: " + CONFIG_PATH);
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
const interval = config.checkIntervalMs || 5 * 60 * 1000;

// kurzer Logger-Wrapper (nutzt target.log)
function log(level, message, extra) {
  target.log(level, message, config, extra);
}

const installRoot =
  (config.paths && config.paths.installRoot) || "C:\\CustomerDashboard";
const STATUS_FILE =
  (config.paths && config.paths.statusFile) ||
  path.join(installRoot, "logs", "update-status.json");

// -------------------------
// Hilfsfunktionen
// -------------------------

function writeStatus(partial) {
  let current = {};
  try {
    if (fs.existsSync(STATUS_FILE)) {
      current = JSON.parse(fs.readFileSync(STATUS_FILE, "utf8"));
    }
  } catch {
    current = {};
  }

  const updated = {
    ...current,
    ...partial,
    lastUpdate: new Date().toISOString()
  };

  fs.mkdirSync(path.dirname(STATUS_FILE), { recursive: true });
  fs.writeFileSync(STATUS_FILE, JSON.stringify(updated, null, 2), "utf8");
}

function compareSemver(a, b) {
  if (!a && !b) return 0;
  if (!a) return -1;
  if (!b) return 1;
  const pa = a.split(".").map((n) => parseInt(n, 10));
  const pb = b.split(".").map((n) => parseInt(n, 10));
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const va = pa[i] || 0;
    const vb = pb[i] || 0;
    if (va > vb) return 1;
    if (va < vb) return -1;
  }
  return 0;
}

// -------------------------
// Quellen
// -------------------------

async function getGithubCandidate() {
  const src = config.sources && config.sources.github;
  if (!src || !src.enabled || !src.apiUrl) return null;

  try {
    const res = await axios.get(src.apiUrl, {
      headers: { "User-Agent": "customer-dashboard-daemon" }
    });

    const tag =
      res.data.tag_name ||
      res.data.name ||
      res.data.version ||
      null;

    if (!tag) {
      log("warn", "GitHub-Quelle liefert keine Version.");
      return null;
    }

    const version = tag.replace(/^v/i, "");
    const imageTemplate = src.imageTemplate;
    const image = imageTemplate
      ? imageTemplate.replace("{version}", version)
      : null;

    return {
      source: "github",
      version,
      artifactType: "docker-image",
      image
    };
  } catch (err) {
    log("warn", "GitHub-Quelle konnte nicht gelesen werden", {
      error: err.message
    });
    return null;
  }
}

async function getOfflineZipCandidate() {
  const src = config.sources && config.sources.offlineZip;
  if (!src || !src.enabled || !src.zipPath) return null;

  if (!fs.existsSync(src.zipPath)) {
    return null;
  }

  let version = src.version || null;

  if (!version) {
    try {
      const zip = new AdmZip(src.zipPath);
      const entry = zip.getEntry("VERSION.txt");
      if (entry) {
        version = zip.readAsText(entry).trim();
      }
    } catch (err) {
      log("warn", "VERSION.txt aus Offline-ZIP konnte nicht gelesen werden", {
        error: err.message
      });
    }
  }

  return {
    source: "offlineZip",
    version: version || null,
    artifactType: "zip",
    zipPath: src.zipPath,
    hashFile: src.hashFile || null,
    signatureFile: src.signatureFile || null
  };
}

async function getNetworkShareCandidate() {
  const src = config.sources && config.sources.networkShare;
  if (!src || !src.enabled || !src.root) return null;

  try {
    const latestFile = path.join(src.root, src.latestFile || "latest.txt");
    if (!fs.existsSync(latestFile)) {
      return null;
    }
    const version = fs.readFileSync(latestFile, "utf8").trim();
    const zipPath = path.join(
      src.root,
      `customer-dashboard-v2-${version}.zip`
    );
    if (!fs.existsSync(zipPath)) {
      log("warn", "Netzwerk-Share: ZIP zur Version nicht gefunden", {
        zipPath
      });
      return null;
    }

    return {
      source: "networkShare",
      version,
      artifactType: "zip",
      zipPath
    };
  } catch (err) {
    log("warn", "Netzwerk-Share konnte nicht gelesen werden", {
      error: err.message
    });
    return null;
  }
}

async function resolveLatestCandidate(currentVersion) {
  const candidates = [];

  const github = await getGithubCandidate();
  if (github) candidates.push(github);

  const offline = await getOfflineZipCandidate();
  if (offline) candidates.push(offline);

  const share = await getNetworkShareCandidate();
  if (share) candidates.push(share);

  if (candidates.length === 0) return null;

  const pinned = config.policy && config.policy.pinnedVersion;

  let best = null;
  for (const c of candidates) {
    let v = c.version || null;

    if (pinned && v && v !== pinned) {
      continue;
    }

    if (!best) {
      best = c;
      continue;
    }

    const cmp = compareSemver(c.version || "0.0.0", best.version || "0.0.0");
    if (cmp > 0) {
      best = c;
    }
  }

  if (!best) return null;

  if (
    currentVersion &&
    best.version &&
    compareSemver(best.version, currentVersion) < 0 &&
    !(config.policy && config.policy.allowDowngrade)
  ) {
    log("info", "Neue Version wäre Downgrade, aufgrund Policy abgelehnt", {
      currentVersion,
      candidate: best.version
    });
    return null;
  }

  return best;
}

// -------------------------
// Backup & Rollback
// -------------------------

function cleanupOldBackups(backupDir, keep) {
  if (!fs.existsSync(backupDir)) return;
  const entries = fs
    .readdirSync(backupDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .sort((a, b) => {
      const at = fs.statSync(path.join(backupDir, a.name)).mtimeMs;
      const bt = fs.statSync(path.join(backupDir, b.name)).mtimeMs;
      return bt - at;
    });

  const toDelete = entries.slice(keep);
  for (const e of toDelete) {
    fs.rmSync(path.join(backupDir, e.name), { recursive: true, force: true });
  }
}

function copyRecursive(src, dest) {
  if (!fs.existsSync(src)) return;
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

function createBackup() {
  if (!config.backup || !config.backup.enabled) {
    log("debug", "Backups sind deaktiviert.");
    return null;
  }

  const root =
    (config.paths && config.paths.installRoot) ||
    "C:\\CustomerDashboard";
  const backupRoot =
    (config.paths && config.paths.backupDir) ||
    path.join(root, "backup");

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = path.join(backupRoot, timestamp);

  fs.mkdirSync(backupDir, { recursive: true });

  const sourceDeploy = path.join(root, "deploy");
  const targetDeploy = path.join(backupDir, "deploy");

  if (fs.existsSync(sourceDeploy)) {
    copyRecursive(sourceDeploy, targetDeploy);
  }

  const keep = config.backup.keep || 5;
  cleanupOldBackups(backupRoot, keep);

  log("info", "Backup erstellt", { backupDir });
  return backupDir;
}

function restoreBackup(backupDir) {
  if (!backupDir || !fs.existsSync(backupDir)) {
    log("warn", "Kein Backup-Verzeichnis zum Wiederherstellen gefunden.", {
      backupDir
    });
    return;
  }

  const root =
    (config.paths && config.paths.installRoot) ||
    "C:\\CustomerDashboard";

  const sourceDeploy = path.join(backupDir, "deploy");
  const targetDeploy = path.join(root, "deploy");

  if (!fs.existsSync(sourceDeploy)) {
    log("warn", "Backup enthält keinen deploy-Ordner, nichts wiederherzustellen.", {
      sourceDeploy
    });
    return;
  }

  // Nur deploy löschen, niemals system-daemon etc. anfassen
  if (fs.existsSync(targetDeploy)) {
    fs.rmSync(targetDeploy, { recursive: true, force: true });
  }

  copyRecursive(sourceDeploy, targetDeploy);
  log("info", "Backup wiederhergestellt.", { backupDir });
}

// -------------------------
// Update-Anwendung
// -------------------------

async function applyZipUpdate(candidate) {
  const installRoot =
    (config.paths && config.paths.installRoot) ||
    "C:\\CustomerDashboard";
  const stagingDir =
    (config.paths && config.paths.stagingDir) ||
    path.join(installRoot, "staging");

  const zipPath = candidate.zipPath;

  if (config.security && config.security.requireHash && candidate.hashFile) {
    const expected = fs
      .readFileSync(candidate.hashFile, "utf8")
      .trim()
      .split(/\s+/)[0];
    const ok = await security.verifySha256(zipPath, expected);
    if (!ok) {
      throw new Error("Hashprüfung für ZIP fehlgeschlagen.");
    }
  }

  if (
    config.security &&
    config.security.requireSignature &&
    candidate.signatureFile &&
    config.security.publicKeyFile
  ) {
    const ok = await security.verifySignature(
      zipPath,
      candidate.signatureFile,
      config.security.publicKeyFile
    );
    if (!ok) {
      throw new Error("Signaturprüfung für ZIP fehlgeschlagen.");
    }
  }

  log("info", "Entpacke ZIP in Staging-Bereich...", { stagingDir });

  if (fs.existsSync(stagingDir)) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
  fs.mkdirSync(stagingDir, { recursive: true });

  const zip = new AdmZip(zipPath);
  zip.extractAllTo(stagingDir, true);

  const deployCurrent = path.join(installRoot, "deploy");
  const deployNew = path.join(stagingDir, "deploy");

  if (!fs.existsSync(deployNew)) {
    throw new Error("ZIP enthält keinen deploy-Ordner.");
  }

  const deployBackup = deployCurrent + ".old";
  if (fs.existsSync(deployBackup)) {
    fs.rmSync(deployBackup, { recursive: true, force: true });
  }

  if (fs.existsSync(deployCurrent)) {
    fs.renameSync(deployCurrent, deployBackup);
  }

  fs.renameSync(deployNew, deployCurrent);

  fs.rmSync(stagingDir, { recursive: true, force: true });
  if (fs.existsSync(deployBackup)) {
    fs.rmSync(deployBackup, { recursive: true, force: true });
  }

  log("info", "ZIP-Update angewendet (Atomic Swap).");
}

async function applyDockerUpdate(candidate, latestVersion) {
  log("info", "Wende Docker-Update an...", { candidate });

  await target.downloadImage(config, latestVersion);
  target.writeEnvVersion(config, latestVersion);
  await target.restartDashboard(config);

  let ok = false;
  for (let i = 0; i < 10; i++) {
    ok = await target.checkHealth(config);
    if (ok) break;
    await new Promise((res) => setTimeout(res, 2000));
  }

  if (!ok) {
    throw new Error(
      "Healthcheck nach Docker-Update fehlgeschlagen (extended timeout)."
    );
  }

  log("info", "Docker-Update erfolgreich angewendet.", {
    version: latestVersion
  });
}

// -------------------------
// Haupt-Update-Check
// -------------------------

async function checkOnce() {
  const startedAt = new Date().toISOString();
  log("info", "=== Update-Check gestartet ===");

  try {
    const currentVersion = target.readEnvVersion(config) || null;
    log(
      "info",
      "Aktuell installierte Version: " + (currentVersion || "(unbekannt)")
    );

    const candidate = await resolveLatestCandidate(currentVersion);

    if (!candidate || !candidate.version) {
      log("info", "Keine neuere Version gefunden.");
      writeStatus({
        currentVersion,
        latestVersion: currentVersion,
        lastResult: "no-update",
        lastSource: candidate ? candidate.source : null,
        lastError: null,
        lastCheckedAt: startedAt
      });
      return;
    }

    const cmp = compareSemver(candidate.version, currentVersion || "0.0.0");
    if (cmp <= 0 && !(config.policy && config.policy.allowDowngrade)) {
      log("info", "Kandidat ist nicht neuer als aktuelle Version.", {
        candidate: candidate.version,
        current: currentVersion
      });
      writeStatus({
        currentVersion,
        latestVersion: candidate.version,
        lastResult: "no-update",
        lastSource: candidate.source,
        lastError: null,
        lastCheckedAt: startedAt
      });
      return;
    }

    log("info", "Neues Update gefunden", {
      source: candidate.source,
      version: candidate.version,
      type: candidate.artifactType
    });

    const backupDir = createBackup();

    try {
      if (candidate.artifactType === "zip") {
        await applyZipUpdate(candidate);
        if (candidate.version) {
          target.writeEnvVersion(config, candidate.version);
        }
        await target.restartDashboard(config);
      } else if (candidate.artifactType === "docker-image") {
        await applyDockerUpdate(candidate, candidate.version);
      }

      const ok = await target.checkHealth(config);
      if (!ok) {
        log(
          "warn",
          "Healthcheck nach Update meldet noch nicht OK, Update aber bereits angewendet."
        );
      }

      log("info", "Update erfolgreich abgeschlossen.", {
        newVersion: candidate.version
      });

      writeStatus({
        currentVersion: candidate.version,
        latestVersion: candidate.version,
        lastResult: "success",
        lastSource: candidate.source,
        lastError: null,
        lastCheckedAt: startedAt
      });
    } catch (err) {
      log("error", "Fehler beim Anwenden des Updates", {
        error: err.message
      });

      if (config.backup && config.backup.enabled && backupDir) {
        log("warn", "Rolle auf Backup zurück...", { backupDir });
        try {
          restoreBackup(backupDir);
          await target.restartDashboard(config);
          writeStatus({
            currentVersion,
            latestVersion: candidate.version,
            lastResult: "rollback",
            lastSource: candidate.source,
            lastError: err.message,
            lastCheckedAt: startedAt
          });
        } catch (rollbackErr) {
          log("error", "Rollback ebenfalls fehlgeschlagen", {
            error: rollbackErr.message
          });
          writeStatus({
            currentVersion,
            latestVersion: candidate.version,
            lastResult: "failed-rollback",
            lastSource: candidate.source,
            lastError: rollbackErr.message,
            lastCheckedAt: startedAt
          });
        }
      } else {
        writeStatus({
          currentVersion,
          latestVersion: candidate.version,
          lastResult: "failed",
          lastSource: candidate.source,
          lastError: err.message,
          lastCheckedAt: startedAt
        });
      }
    }
  } catch (e) {
    log("error", "Unerwarteter Fehler beim Update-Check", {
      error: e.message
    });
  }
}

// -------------------------
// Main
// -------------------------

async function main() {
  log("info", "Systemweiter Auto-Update-Daemon gestartet.");

  await checkAndApplySelfUpdate(config, log, security);

  await checkOnce();

  setInterval(checkOnce, interval);
}

main().catch((err) => {
  log("error", "Daemon konnte nicht gestartet werden", { error: err.message });
  process.exit(1);
});

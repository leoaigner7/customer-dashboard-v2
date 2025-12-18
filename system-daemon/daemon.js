// ------------------------------------------------------------
// BOOT-SAFETY (entscheidend für SYSTEM + Task Scheduler)
// ------------------------------------------------------------
process.chdir(__dirname);

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
// system-daemon/daemon.js

/********************************************************************
 * CUSTOMER DASHBOARD – AUTO-UPDATER (Version 6.6.4)
 *
 * Aufgaben:
 *  - periodisch nach neuen Versionen suchen (GitHub / offline / Share)
 *  - bei neuer Version: Docker-Update durchführen
 *  - vor Update: Backup des deploy-Verzeichnisses
 *  - nach Fehler: Rollback auf letztes Backup (falls vorhanden)
 *  - Status in update-status.json pflegen
 ********************************************************************/

const fs = require("fs");
const path = require("path");
const axios = require("axios");
const AdmZip = require("adm-zip");

const target = require("./targets/docker-dashboard");
const security = require("./security");
const { checkAndApplySelfUpdate } = require("./selfUpdate");

// ------------------------------------------------------------
// KONFIGURATION LADEN
// ------------------------------------------------------------
const CONFIG_PATH =
  process.env.AUTUPDATE_CONFIG || path.join(__dirname, "config.json");

if (!fs.existsSync(CONFIG_PATH)) {
  console.error("Config nicht gefunden:", CONFIG_PATH);
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));

const installRoot = config.paths.installRoot || "C:\\CustomerDashboard";
const backupRoot = config.paths.backupDir || path.join(installRoot, "backup");
const statusFile =
  config.paths.statusFile ||
  path.join(installRoot, "logs", "update-status.json");

const intervalMs = config.checkIntervalMs || 5 * 60 * 1000;

// Wrapper um target.log
function log(level, message, extra) {
  target.log(level, message, config, extra);
}

// ------------------------------------------------------------
// STATUSDATEI
// ------------------------------------------------------------
function readStatus() {
  try {
    if (!fs.existsSync(statusFile)) return {};
    return JSON.parse(fs.readFileSync(statusFile, "utf8"));
  } catch {
    return {};
  }
}

function writeStatus(partial) {
  const current = readStatus();
  const updated = {
    ...current,
    ...partial,
    lastUpdate: new Date().toISOString(),
  };

  fs.mkdirSync(path.dirname(statusFile), { recursive: true });
  fs.writeFileSync(statusFile, JSON.stringify(updated, null, 2), "utf8");
}

// ------------------------------------------------------------
// VERSIONEN VERGLEICHEN
// ------------------------------------------------------------
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

// ------------------------------------------------------------
// UPDATE-QUELLEN
// ------------------------------------------------------------
async function getGithubCandidate() {
  const src = config.sources && config.sources.github;
  if (!src || !src.enabled || !src.apiUrl) return null;

  try {
    const res = await axios.get(src.apiUrl, {
      headers: { "User-Agent": "customer-dashboard-daemon" },
    });

    const tag =
      res.data.tag_name || res.data.name || res.data.version || null;

    if (!tag) {
      log("warn", "GitHub-Release ohne Versionsangabe erhalten.");
      return null;
    }

    const version = tag.replace(/^v/i, "");

    // 🔐 SECURITY: pinnedVersion erzwingen
    if (
      config.policy &&
      config.policy.pinnedVersion &&
      version !== config.policy.pinnedVersion
    ) {
      log("info", "GitHub-Version ignoriert (nicht gepinnt).", {
        found: version,
        pinned: config.policy.pinnedVersion,
      });
      return null;
    }

    const image = src.imageTemplate
      ? src.imageTemplate.replace("{version}", version)
      : null;

    if (!image) {
      log("warn", "Kein Docker-Image-Template konfiguriert.");
      return null;
    }

    return {
      source: "github",
      version,
      artifactType: "docker-image",
      image,
    };
  } catch (err) {
    log("warn", "GitHub-Quelle konnte nicht gelesen werden", {
      error: err.message,
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

  try {
    const zip = new AdmZip(src.zipPath);
    const entry = zip.getEntry("VERSION.txt");
    if (entry) {
      version = zip.readAsText(entry).trim();
    }
  } catch (err) {
    log("warn", "VERSION.txt aus Offline-ZIP konnte nicht gelesen werden", {
      error: err.message,
    });
  }

  return {
    source: "offlineZip",
    version,
    artifactType: "zip",
    zipPath: src.zipPath,
    hashFile: src.hashFile || null,
    signatureFile: src.signatureFile || null,
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
        zipPath,
      });
      return null;
    }

    return {
      source: "networkShare",
      version,
      artifactType: "zip",
      zipPath,
    };
  } catch (err) {
    log("warn", "Netzwerk-Share konnte nicht gelesen werden", {
      error: err.message,
    });
    return null;
  }
}

async function resolveLatestCandidate(currentVersion) {
  const candidates = [];

  const gh = await getGithubCandidate();
  if (gh) candidates.push(gh);

  const offline = await getOfflineZipCandidate();
  if (offline) candidates.push(offline);

  const share = await getNetworkShareCandidate();
  if (share) candidates.push(share);

  if (candidates.length === 0) return null;

  // Policy: pinnedVersion
  const pinned =
    config.policy && typeof config.policy.pinnedVersion === "string"
      ? config.policy.pinnedVersion
      : null;

  let best = null;

  for (const c of candidates) {
    if (!c.version) continue;

    if (pinned && c.version !== pinned) {
      // auf bestimmte Version gepinnt -> alles andere ignorieren
      continue;
    }

    if (!best) {
      best = c;
      continue;
    }

    if (compareSemver(c.version, best.version) > 0) {
      best = c;
    }
  }

  if (!best) return null;

  // Downgrade-Policy
  if (
    currentVersion &&
    best.version &&
    compareSemver(best.version, currentVersion) < 0 &&
    !(config.policy && config.policy.allowDowngrade)
  ) {
    log("info", "Gefundene Version wäre Downgrade – laut Policy verboten.", {
      currentVersion,
      candidate: best.version,
    });
    return null;
  }

  return best;
}

// ------------------------------------------------------------
// BACKUP & ROLLBACK
// ------------------------------------------------------------
function copyRecursive(src, dest) {
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

function cleanupOldBackups(keep) {
  if (!fs.existsSync(backupRoot)) return;

  const entries = fs
    .readdirSync(backupRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .sort((a, b) => {
      const at = fs.statSync(path.join(backupRoot, a.name)).mtimeMs;
      const bt = fs.statSync(path.join(backupRoot, b.name)).mtimeMs;
      return bt - at;
    });

  const toDelete = entries.slice(keep);

  for (const e of toDelete) {
    const dir = path.join(backupRoot, e.name);
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      log("info", "Altes Backup entfernt", { backupDir: dir });
    } catch (err) {
      log("warn", "Altes Backup konnte nicht entfernt werden", {
        backupDir: dir,
        error: err.message,
      });
    }
  }
}

function createBackup() {
  if (!config.backup || !config.backup.enabled) {
    log("info", "Backups sind laut Konfiguration deaktiviert.");
    return null;
  }

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = path.join(backupRoot, ts);

  fs.mkdirSync(backupDir, { recursive: true });

  const deploySrc = path.join(installRoot, "deploy");
  const deployDest = path.join(backupDir, "deploy");

  if (fs.existsSync(deploySrc)) {
    copyRecursive(deploySrc, deployDest);
    log("info", "Backup des deploy-Verzeichnisses erstellt", {
      backupDir,
    });
  } else {
    log("warn", "Kein deploy-Verzeichnis für Backup gefunden", {
      path: deploySrc,
    });
  }

  const keep = config.backup.keep || 5;
  cleanupOldBackups(keep);

  return backupDir;
}

function restoreBackup(backupDir) {
  if (!backupDir || !fs.existsSync(backupDir)) {
    log("warn", "Kein gültiges Backup für Rollback gefunden.", {
      backupDir,
    });
    throw new Error("Kein gültiges Backup-Verzeichnis.");
  }

  const deployBackup = path.join(backupDir, "deploy");
  const deployTarget = path.join(installRoot, "deploy");

  if (!fs.existsSync(deployBackup)) {
    log("error", "Backup enthält kein deploy-Verzeichnis.", {
      backupDir,
    });
    throw new Error("Backup enthält kein deploy-Verzeichnis.");
  }

  log("info", "Starte Rollback aus Backup.", { backupDir });

  // Versuche mehrfach, da Windows gelegentlich Dateien sperrt
  let lastError = null;
  for (let i = 0; i < 10; i++) {
    try {
      if (fs.existsSync(deployTarget)) {
        fs.rmSync(deployTarget, { recursive: true, force: true });
      }
      copyRecursive(deployBackup, deployTarget);

      log("info", "Rollback erfolgreich abgeschlossen.", {
        backupDir,
      });
      return;
    } catch (err) {
      lastError = err;
      log("warn", "Rollback-Versuch fehlgeschlagen, neuer Versuch folgt.", {
        attempt: i + 1,
        error: err.message,
      });
    }
  }

  throw lastError || new Error("Rollback fehlgeschlagen.");
}

// ------------------------------------------------------------
// UPDATE-ANWENDUNG
// ------------------------------------------------------------
async function applyDockerUpdate(candidate, latestVersion) {
  const started = Date.now();

  log("info", "Starte Docker-Update.", {
    candidate,
  });

  // Docker-Image laden
  await target.downloadImage(config, latestVersion);

  // Version direkt in .env schreiben
  target.writeEnvVersion(config, latestVersion);

  // Docker-Stack neu starten
  await target.restartDashboard(config);

  // Robuster Healthcheck (bis ca. 90 Sekunden)
  const ok = await target.checkHealth(config, 45, 2000);
  const durationMs = Date.now() - started;

  if (!ok) {
    log("error", "Healthcheck nach Docker-Update fehlgeschlagen.", {
      version: latestVersion,
      durationMs,
    });
    throw new Error(
      "Healthcheck nach Docker-Update fehlgeschlagen (erweitertes Timeout)."
    );
  }

  log("info", "Docker-Update erfolgreich angewendet.", {
    version: latestVersion,
    durationMs,
  });
}

// ------------------------------------------------------------
// HAUPT-UPDATE-LOGIK
// ------------------------------------------------------------
async function checkOnce() {
  const startedAt = new Date();
  const startedIso = startedAt.toISOString();

  log("info", "=== Update-Check gestartet ===", {
    startedAt: startedIso,
  });

  try {
    const currentVersion = target.readEnvVersion(config) || null;

    log("info", "Aktuell installierte Version ermittelt.", {
      currentVersion: currentVersion || "(unbekannt)",
    });

    const candidate = await resolveLatestCandidate(currentVersion);

    if (!candidate || !candidate.version) {
      log("info", "Keine neuere Version gefunden.", {
        currentVersion,
      });

      writeStatus({
        currentVersion,
        latestVersion: currentVersion,
        lastResult: "no-update",
        lastSource: candidate ? candidate.source : null,
        lastError: null,
        lastCheckedAt: startedIso,
      });
      return;
    }

    const cmp = compareSemver(candidate.version, currentVersion || "0.0.0");
    if (cmp <= 0 && !(config.policy && config.policy.allowDowngrade)) {
      log("info", "Gefundene Version ist nicht neuer als die installierte.", {
        currentVersion,
        candidateVersion: candidate.version,
      });

      writeStatus({
        currentVersion,
        latestVersion: candidate.version,
        lastResult: "no-update",
        lastSource: candidate.source,
        lastError: null,
        lastCheckedAt: startedIso,
      });
      return;
    }

    log("info", "Neues Update wird vorbereitet.", {
      currentVersion,
      newVersion: candidate.version,
      source: candidate.source,
      type: candidate.artifactType,
    });

    const backupDir = createBackup();

   try {
  if (candidate.artifactType === "docker-image") {
    await applyDockerUpdate(candidate, candidate.version);
  } 
  else if (candidate.artifactType === "zip") {
  // -----------------------------
  // STAGING DIR (immer zuerst)
  // -----------------------------
  const stagingDir = path.join(
    config.paths.stagingDir || path.join(installRoot, "staging"),
    `update-${Date.now()}`
  );
  fs.mkdirSync(stagingDir, { recursive: true });

  // stabile Kopien (Windows-safe)
  const stableZip = path.join(stagingDir, "package.zip");
  const stableHash = path.join(stagingDir, "package.zip.sha256");
  const stableSig = path.join(stagingDir, "package.zip.sig");

  log("info", "Kopiere Update-Artefakte in Staging (stabile Kopie)", {
    stagingDir,
    srcZip: candidate.zipPath,
  });

  fs.copyFileSync(candidate.zipPath, stableZip);

  if (candidate.hashFile) {
    fs.copyFileSync(candidate.hashFile, stableHash);
  }
  if (candidate.signatureFile) {
    fs.copyFileSync(candidate.signatureFile, stableSig);
  }

  // -----------------------------
  // SECURITY: HASH
  // -----------------------------
  if (config.security?.requireHash) {
    log("info", "Prüfe ZIP-Integrität (Hash)...", { zipPath: stableZip });

    // throws on mismatch
    await security.verifyZipHash(stableZip, stableHash);

    log("info", "ZIP-Integrität erfolgreich verifiziert.");
  }

  // -----------------------------
  // SECURITY: SIGNATURE
  // -----------------------------
  if (config.security?.requireSignature) {
    log("info", "Prüfe kryptografische Signatur des ZIPs", { sigPath: stableSig });

    // throws on invalid/missing
    security.verifySignatureOrThrow(stableZip, stableSig);

    log("info", "Signaturprüfung erfolgreich.");
  }

  // -----------------------------
  // ZIP INSTALLATION (ATOMIC SWAP)
  // -----------------------------
  log("info", "Entpacke ZIP in Staging-Verzeichnis", { stagingDir });

  const zip = new AdmZip(stableZip);
  zip.extractAllTo(stagingDir, true);

  const newDeploy = path.join(stagingDir, "deploy");
  const deployTarget = path.join(installRoot, "deploy");

  if (!fs.existsSync(newDeploy)) {
    throw new Error("ZIP enthält kein deploy-Verzeichnis.");
  }

  log("info", "Atomic Swap: deploy-Verzeichnis wird ersetzt");

  fs.rmSync(deployTarget, { recursive: true, force: true });
  fs.renameSync(newDeploy, deployTarget);

  // Version setzen
  target.writeEnvVersion(config, candidate.version);

  // Neustart
  await target.restartDashboard(config);

  // Healthcheck
  const ok = await target.checkHealth(config, 45, 2000);
  if (!ok) {
    throw new Error("Healthcheck nach ZIP-Update fehlgeschlagen.");
  }

  log("info", "ZIP-Update erfolgreich installiert", {
    version: candidate.version,
  });
}

      const durationMs = Date.now() - startedAt.getTime();

      log("info", "Update erfolgreich abgeschlossen.", {
        newVersion: candidate.version,
        durationMs,
      });

      writeStatus({
        currentVersion: candidate.version,
        latestVersion: candidate.version,
        lastResult: "success",
        lastSource: candidate.source,
        lastError: null,
        lastCheckedAt: startedIso,
      });
    } catch (err) {
      log("error", "Fehler beim Anwenden des Updates.", {
        error: err.message,
      });

      if (config.backup && config.backup.enabled && backupDir) {
        log("warn", "Update fehlgeschlagen – starte Rollback aus Backup.", {
          backupDir,
        });

        try {
          await restoreBackup(backupDir);
          await target.restartDashboard(config);

          writeStatus({
            currentVersion,
            latestVersion: candidate.version,
            lastResult: "rollback",
            lastSource: candidate.source,
            lastError: err.message,
            lastCheckedAt: startedIso,
          });
        } catch (rollbackErr) {
          log("error", "Rollback ist ebenfalls fehlgeschlagen.", {
            error: rollbackErr.message,
          });

          writeStatus({
            currentVersion,
            latestVersion: candidate.version,
            lastResult: "failed-rollback",
            lastSource: candidate.source,
            lastError: rollbackErr.message,
            lastCheckedAt: startedIso,
          });
        }
      } else {
        writeStatus({
          currentVersion,
          latestVersion: candidate.version,
          lastResult: "failed",
          lastSource: candidate.source,
          lastError: err.message,
          lastCheckedAt: startedIso,
        });
      }
    }
  } catch (e) {
    log("error", "Unerwarteter Fehler im Update-Check.", {
      error: e.message,
    });
  } finally {
    const durationMs = Date.now() - startedAt.getTime();
    log("info", "=== Update-Check beendet ===", {
      durationMs,
    });
  }
}

// ------------------------------------------------------------
// MAIN
// ------------------------------------------------------------
async function main() {
  log("info", "Systemweiter Auto-Update-Daemon gestartet.");

  // Optional: Self-Update des Daemons
  await checkAndApplySelfUpdate(config, log, security);

  // beim Systemstart warten (Docker / Netzwerk / localhost)
await sleep(60_000);

while (true) {
  await checkOnce();
  await sleep(intervalMs);
}
}

main().catch((err) => {
  log("error", "Daemon konnte nicht gestartet werden.", {
    error: err.message,
  });
  process.exit(1);
});

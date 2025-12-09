/**
 * CUSTOMER DASHBOARD – Auto-Update Daemon
 * --------------------------------------
 * Verantwortlich für:
 *  - Ermitteln der aktuell installierten Version (.env)
 *  - Prüfen neuer Versionen (GitHub, Offline-ZIP, Netzlaufwerk)
 *  - Anwenden von Docker-Updates
 *  - Optional: ZIP-Updates (offline / Netzwerk)
 *  - Backup & Rollback (nur deploy-Ordner!)
 *  - Self-Update (separates Modul)
 *  - Sauberes Logging & Status-Datei
 */

const fs = require("fs");
const path = require("path");
const axios = require("axios");
const AdmZip = require("adm-zip");

const target = require("./targets/docker-dashboard");
const security = require("./security");
const { checkAndApplySelfUpdate } = require("./selfUpdate");

// -----------------------------------------------------------------------------
// Konfiguration
// -----------------------------------------------------------------------------

const BASE_DIR = __dirname;
const CONFIG_PATH =
  process.env.AUTUPDATE_CONFIG || path.join(BASE_DIR, "config.json");

if (!fs.existsSync(CONFIG_PATH)) {
  console.error("Config nicht gefunden: " + CONFIG_PATH);
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
const interval = config.checkIntervalMs || 5 * 60 * 1000;

const installRoot =
  (config.paths && config.paths.installRoot) || "C:\\CustomerDashboard";

const STATUS_FILE =
  (config.paths && config.paths.statusFile) ||
  path.join(installRoot, "logs", "update-status.json");

// zentraler Logger, der das Target-Logging benutzt
function log(level, message, context) {
  target.log(level, message, config, context);
}

// kleine Hilfsfunktion zur Zeitmessung in ms
function durationMsFrom(startHrtime) {
  const diffNs = process.hrtime.bigint() - startHrtime;
  return Number(diffNs / 1000000n);
}

// -----------------------------------------------------------------------------
// Status-Datei
// -----------------------------------------------------------------------------

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

// -----------------------------------------------------------------------------
// Semver-Vergleich
// -----------------------------------------------------------------------------

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

// -----------------------------------------------------------------------------
// Update-Quellen
// -----------------------------------------------------------------------------

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
      log("warn", "GitHub-Quelle liefert keine Version.", {
        event: "source.github.no-version"
      });
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
      event: "source.github.error",
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

  // Optional: VERSION.txt aus dem ZIP lesen
  if (!version) {
    try {
      const zip = new AdmZip(src.zipPath);
      const entry = zip.getEntry("VERSION.txt");
      if (entry) {
        version = zip.readAsText(entry).trim();
      }
    } catch (err) {
      log("warn", "VERSION.txt aus Offline-ZIP konnte nicht gelesen werden", {
        event: "source.offlineZip.version-error",
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
        event: "source.networkShare.zip-missing",
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
      event: "source.networkShare.error",
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

  if (candidates.length === 0) {
    return null;
  }

  const pinned = config.policy && config.policy.pinnedVersion;

  let best = null;
  for (const c of candidates) {
    if (pinned && c.version && c.version !== pinned) {
      // Kandidat ignorieren, wenn auf bestimmte Version gepinnt ist
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

  if (!best) {
    return null;
  }

  // Downgrade-Policy
  if (
    currentVersion &&
    best.version &&
    compareSemver(best.version, currentVersion) < 0 &&
    !(config.policy && config.policy.allowDowngrade)
  ) {
    log("info", "Potentielles Downgrade gemäß Policy abgelehnt", {
      event: "policy.downgrade.blocked",
      currentVersion,
      candidateVersion: best.version
    });
    return null;
  }

  return best;
}

// -----------------------------------------------------------------------------
// Backup & Rollback – nur deploy-Ordner
// -----------------------------------------------------------------------------

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

function createBackup() {
  if (!config.backup || !config.backup.enabled) {
    log("debug", "Backups sind deaktiviert.", {
      event: "backup.disabled"
    });
    return null;
  }

  const backupRoot =
    (config.paths && config.paths.backupDir) ||
    path.join(installRoot, "backup");

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = path.join(backupRoot, timestamp);

  fs.mkdirSync(backupDir, { recursive: true });

  const sourceDeploy = path.join(installRoot, "deploy");
  const targetDeploy = path.join(backupDir, "deploy");

  if (fs.existsSync(sourceDeploy)) {
    copyRecursive(sourceDeploy, targetDeploy);
  }

  const keep = config.backup.keep || 5;
  cleanupOldBackups(backupRoot, keep);

  log("info", "Backup erstellt", {
    event: "backup.created",
    backupDir
  });

  return backupDir;
}

async function restoreBackup(backupDir) {
  if (!backupDir || !fs.existsSync(backupDir)) {
    const msg = "Kein Backup-Verzeichnis zum Wiederherstellen gefunden.";
    log("error", msg, {
      event: "backup.restore.missing",
      backupDir
    });
    throw new Error(msg);
  }

  const sourceDeploy = path.join(backupDir, "deploy");
  const targetDeploy = path.join(installRoot, "deploy");

  if (!fs.existsSync(sourceDeploy)) {
    const msg = "Backup enthält keinen deploy-Ordner.";
    log("error", msg, {
      event: "backup.restore.no-deploy",
      backupDir
    });
    throw new Error(msg);
  }

  log("warn", "Rollback wird durchgeführt…", {
    event: "backup.restore.start",
    backupDir
  });

  // Wir versuchen mehrfach, um Windows-Sperren (Virenscanner, Docker) zu umschiffen
  const maxAttempts = 10;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      if (fs.existsSync(targetDeploy)) {
        fs.rmSync(targetDeploy, { recursive: true, force: true });
      }
      copyRecursive(sourceDeploy, targetDeploy);

      log("info", "Rollback erfolgreich abgeschlossen.", {
        event: "backup.restore.success",
        backupDir
      });

      return;
    } catch (err) {
      if (attempt === maxAttempts) {
        log("error", "Rollback endgültig fehlgeschlagen.", {
          event: "backup.restore.failed",
          backupDir,
          error: err.message
        });
        throw err;
      }

      log("warn", "Rollback-Versuch fehlgeschlagen, erneuter Versuch folgt…", {
        event: "backup.restore.retry",
        backupDir,
        attempt,
        error: err.message
      });

      await new Promise((res) => setTimeout(res, 1000));
    }
  }
}

// -----------------------------------------------------------------------------
// ZIP-Update (Offline / Netzwerk)
// -----------------------------------------------------------------------------

async function applyZipUpdate(candidate) {
  const stagingDir =
    (config.paths && config.paths.stagingDir) ||
    path.join(installRoot, "staging");

  const zipPath = candidate.zipPath;

  // Sicherheitsprüfungen
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

  log("info", "Entpacke ZIP in Staging-Bereich…", {
    event: "update.zip.extract",
    stagingDir
  });

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

  log("info", "ZIP-Update angewendet (Atomic Swap).", {
    event: "update.zip.applied",
    version: candidate.version || null
  });
}

// -----------------------------------------------------------------------------
// Docker-Update
// -----------------------------------------------------------------------------

async function applyDockerUpdate(candidate, latestVersion) {
  const startedAt = process.hrtime.bigint();

  log("info", "Wende Docker-Update an…", {
    event: "update.docker.start",
    version: latestVersion,
    source: candidate.source,
    image: candidate.image
  });

  // Image ziehen
  await target.downloadImage(config, latestVersion);

  // Version direkt ins .env schreiben
  target.writeEnvVersion(config, latestVersion);

  // docker compose down / pull / up -d
  await target.restartDashboard(config);

  // Healthcheck: 45 Versuche, alle 2 Sekunden (~90 Sekunden)
  const maxAttempts = 45;
  let ok = false;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    ok = await target.checkHealth(config);
    if (ok) {
      log("info", "Healthcheck erfolgreich.", {
        event: "update.docker.health.ok",
        attempt
      });
      break;
    }

    if (attempt === maxAttempts) {
      break;
    }

    log("warn", "Healthcheck noch nicht erfolgreich, erneuter Versuch…", {
      event: "update.docker.health.retry",
      attempt
    });
    await new Promise((res) => setTimeout(res, 2000));
  }

  const durationMs = durationMsFrom(startedAt);

  if (!ok) {
    throw new Error(
      `Healthcheck nach Docker-Update fehlgeschlagen (Timeout ~${durationMs} ms).`
    );
  }

  log("info", "Docker-Update erfolgreich angewendet.", {
    event: "update.docker.success",
    version: latestVersion,
    durationMs
  });
}

// -----------------------------------------------------------------------------
// Haupt-Update-Check
// -----------------------------------------------------------------------------

async function checkOnce() {
  const startedAt = process.hrtime.bigint();
  const startedIso = new Date().toISOString();

  // einfache Run-ID für diesen Check
  const runId =
    Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);

  log("info", "=== Update-Check gestartet ===", {
    event: "update.check.start",
    runId
  });

  try {
    const currentVersion = target.readEnvVersion(config) || null;

    log("info", "Aktuell installierte Version ermittelt.", {
      event: "update.check.current-version",
      runId,
      currentVersion: currentVersion || "(unbekannt)"
    });

    const candidate = await resolveLatestCandidate(currentVersion);

    if (!candidate || !candidate.version) {
      log("info", "Keine neuere Version gefunden.", {
        event: "update.check.no-update",
        runId,
        currentVersion
      });

      writeStatus({
        currentVersion,
        latestVersion: currentVersion,
        lastResult: "no-update",
        lastSource: candidate ? candidate.source : null,
        lastError: null,
        lastCheckedAt: startedIso
      });

      const durationMs = durationMsFrom(startedAt);
      log("info", "Update-Check abgeschlossen (kein Update).", {
        event: "update.check.end",
        runId,
        result: "no-update",
        durationMs
      });
      return;
    }

    const cmp = compareSemver(candidate.version, currentVersion || "0.0.0");
    if (cmp <= 0 && !(config.policy && config.policy.allowDowngrade)) {
      log("info", "Gefundener Kandidat ist nicht neuer als aktuelle Version.", {
        event: "update.check.not-newer",
        runId,
        candidateVersion: candidate.version,
        currentVersion
      });

      writeStatus({
        currentVersion,
        latestVersion: candidate.version,
        lastResult: "no-update",
        lastSource: candidate.source,
        lastError: null,
        lastCheckedAt: startedIso
      });

      const durationMs = durationMsFrom(startedAt);
      log("info", "Update-Check abgeschlossen (kein Update angewendet).", {
        event: "update.check.end",
        runId,
        result: "no-update",
        durationMs
      });
      return;
    }

    log("info", "Neues Update gefunden.", {
      event: "update.check.candidate",
      runId,
      source: candidate.source,
      version: candidate.version,
      type: candidate.artifactType
    });

    const backupDir = createBackup();

    try {
      // ZIP oder Docker?
      if (candidate.artifactType === "zip") {
        await applyZipUpdate(candidate);
        if (candidate.version) {
          target.writeEnvVersion(config, candidate.version);
        }
        await target.restartDashboard(config);
      } else if (candidate.artifactType === "docker-image") {
        await applyDockerUpdate(candidate, candidate.version);
      }

      // Monitoring Health nach erfolgreichem Apply – nicht mehr kritisch
      const finalHealthOk = await target.checkHealth(config);
      if (!finalHealthOk) {
        log("warn", "Healthcheck nach Update meldet (noch) kein OK.", {
          event: "update.post.health.warn",
          runId,
          version: candidate.version
        });
      }

      writeStatus({
        currentVersion: candidate.version,
        latestVersion: candidate.version,
        lastResult: "success",
        lastSource: candidate.source,
        lastError: null,
        lastCheckedAt: startedIso
      });

      const durationMs = durationMsFrom(startedAt);

      log("info", "Update erfolgreich abgeschlossen.", {
        event: "update.check.end",
        runId,
        result: "success",
        newVersion: candidate.version,
        durationMs
      });
    } catch (err) {
      log("error", "Fehler beim Anwenden des Updates.", {
        event: "update.apply.error",
        runId,
        error: err.message
      });

      if (config.backup && config.backup.enabled && backupDir) {
        try {
          await restoreBackup(backupDir);
          await target.restartDashboard(config);

          writeStatus({
            currentVersion,
            latestVersion: candidate.version,
            lastResult: "rollback",
            lastSource: candidate.source,
            lastError: err.message,
            lastCheckedAt: startedIso
          });

          const durationMs = durationMsFrom(startedAt);
          log("warn", "Update fehlgeschlagen, Rollback durchgeführt.", {
            event: "update.check.end",
            runId,
            result: "rollback",
            rolledBackTo: currentVersion,
            failedVersion: candidate.version,
            durationMs
          });
        } catch (rollbackErr) {
          writeStatus({
            currentVersion,
            latestVersion: candidate.version,
            lastResult: "failed-rollback",
            lastSource: candidate.source,
            lastError: rollbackErr.message,
            lastCheckedAt: startedIso
          });

          const durationMs = durationMsFrom(startedAt);
          log("error", "Rollback ebenfalls fehlgeschlagen.", {
            event: "update.check.end",
            runId,
            result: "failed-rollback",
            originalError: err.message,
            rollbackError: rollbackErr.message,
            durationMs
          });
        }
      } else {
        writeStatus({
          currentVersion,
          latestVersion: candidate.version,
          lastResult: "failed",
          lastSource: candidate.source,
          lastError: err.message,
          lastCheckedAt: startedIso
        });

        const durationMs = durationMsFrom(startedAt);
        log("error", "Update fehlgeschlagen (kein Backup vorhanden).", {
          event: "update.check.end",
          runId,
          result: "failed",
          error: err.message,
          durationMs
        });
      }
    }
  } catch (e) {
    const durationMs = durationMsFrom(startedAt);
    log("error", "Unerwarteter Fehler beim Update-Check.", {
      event: "update.check.unhandled-error",
      error: e.message,
      durationMs
    });
  }
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

async function main() {
  log("info", "Systemweiter Auto-Update-Daemon gestartet.", {
    event: "daemon.start",
    mode: config.mode || "auto-install",
    intervalMs: interval
  });

  // Optional: Self-Update des Daemons
  await checkAndApplySelfUpdate(config, log, security);

  await checkOnce();

  setInterval(checkOnce, interval);
}

main().catch((err) => {
  log("error", "Daemon konnte nicht gestartet werden.", {
    event: "daemon.fatal",
    error: err.message
  });
  process.exit(1);
});

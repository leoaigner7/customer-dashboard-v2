
process.chdir(__dirname);

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const AdmZip = require("adm-zip");



function rmDirRetry(dir, tries = 15, delayMs = 250) {
  let last = null;
  for (let i = 0; i < tries; i++) {
    try {
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
      return;
    } catch (err) {
      last = err;
      if (err.code === "EPERM" || err.code === "EBUSY") {
        // Windows File Lock – kurz warten und erneut versuchen
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
        delayMs = Math.min(Math.floor(delayMs * 1.4), 3000);
        continue;
      }
      throw err;
    }
  }
  throw last || new Error("rmDirRetry failed");
}

function renameRetry(from, to, tries = 15, delayMs = 250) {
  let last = null;
  for (let i = 0; i < tries; i++) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (err) {
      last = err;
      if (err.code === "EPERM" || err.code === "EBUSY") {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
        delayMs = Math.min(Math.floor(delayMs * 1.4), 3000);
        continue;
      }
      throw err;
    }
  }
  throw last || new Error("renameRetry failed");
}

const target = require("./targets/docker-dashboard");
const security = require("./security");
const { checkAndApplySelfUpdate } = require("./selfUpdate");


const CONFIG_PATH =
  process.env.AUTUPDATE_CONFIG || path.join(__dirname, "config.json");

if (!fs.existsSync(CONFIG_PATH)) {
  console.error("Config nicht gefunden:", CONFIG_PATH);
  process.exit(1);
}

function resolveInstallRoot() {
  if (process.env.INSTALL_ROOT) return process.env.INSTALL_ROOT;
  return process.platform === "win32" ? "C:\\CustomerDashboard" : "/opt/customer-dashboard";
}

const INSTALL_ROOT = resolveInstallRoot();

// ersetzt __INSTALL_ROOT__ / __NETWORK_ROOT__ in config.json
function resolvePaths(obj) {
  if (typeof obj === "string") {
    return obj
      .replace(/__INSTALL_ROOT__/g, INSTALL_ROOT)
      .replace(
        /__NETWORK_ROOT__/g,
        process.platform === "win32"
          ? "\\\\fileserver\\releases\\customer-dashboard-v2"
          : "/mnt/releases/customer-dashboard-v2"
      );
  }
  if (Array.isArray(obj)) return obj.map(resolvePaths);
  if (obj && typeof obj === "object") {
    const out = {};
    for (const k of Object.keys(obj)) out[k] = resolvePaths(obj[k]);
    return out;
  }
  return obj;
}

const rawConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
const config = resolvePaths(rawConfig);

// Jetzt ERST Pfade ableiten
const installRoot = config.paths?.installRoot || INSTALL_ROOT;
const backupRoot = config.paths?.backupDir || path.join(installRoot, "backup");
const statusFile =
  config.paths?.statusFile || path.join(installRoot, "logs", "update-status.json");

const intervalMs = config.checkIntervalMs || 5 * 60 * 1000;

// Logging über target
function log(level, message, extra) {
  target.log(level, message, config, extra);
}


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
// SemVer Vergleich
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

// UPDATE-QUELLEN
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

    // SECURITY: pinnedVersion  -> nur exakt diese Version erlauben
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
// wählt die "beste Version" aus allen Quellen unter berüücksichtigung der Policy
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

// BACKUP & ROLLBACK
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

// Update anwenden: Docker
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
function safeExtractZip(zipPath, targetDir) {
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();

  const root = path.resolve(targetDir) + path.sep;

  for (const e of entries) {
    const name = e.entryName.replace(/\\/g, "/");

    const outPath = path.resolve(targetDir, name);

    // verhindert "../ ../" Attacken im Zip
    if (!outPath.startsWith(root)) {
      throw new Error(`ZipSlip detected: ${e.entryName}`);
    }

    if (e.isDirectory) {
      fs.mkdirSync(outPath, { recursive: true });
      continue;
    }

    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, e.getData());
  }
}

// Update check
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
    //kein Update
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
// nur Updaten wenn wirklich neue Version oder Downgrade erlaubt ist
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

  const stagingDir = path.join(
    config.paths.stagingDir || path.join(installRoot, "staging"),
    `update-${Date.now()}`
  );
  fs.mkdirSync(stagingDir, { recursive: true });

// Update Dateien zuerst lokal kopieren, damit netzwerk/Usb abbrüche das Update nicht zerstören
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

 // Integrität (Hash)
  if (config.security?.requireHash) {
    log("info", "Prüfe ZIP-Integrität (Hash)...", { zipPath: stableZip });

    await security.verifyZipHash(stableZip, stableHash);

    log("info", "ZIP-Integrität erfolgreich verifiziert.");
  }

  //Signatur
  if (config.security?.requireSignature) {
    log("info", "Prüfe kryptografische Signatur des ZIPs", { sigPath: stableSig });

    security.verifySignatureOrThrow(stableZip, stableSig);

    log("info", "Signaturprüfung erfolgreich.");
  }

// entpacken
log("info", "Entpacke ZIP sicher (ZipSlip Schutz)", { stagingDir });

const extractDir = path.join(stagingDir, "extract");
fs.mkdirSync(extractDir, { recursive: true });

// SAFE statt extractAllTo()
safeExtractZip(stableZip, extractDir);

const newDeploy = path.join(extractDir, "deploy");
const deployTarget = path.join(installRoot, "deploy");

if (!fs.existsSync(newDeploy)) {
  throw new Error("ZIP enthält kein deploy-Verzeichnis.");
}

// docker stoppen -> verhindert Windows locks auf deploy datein
log("info", "Stoppe Docker vor Atomic Swap (Windows File Locks vermeiden)");
await target.stopDashboard(config);


// atomic swap deploy 
log("info", "Atomic Swap: deploy-Verzeichnis wird ersetzt (mit Retry)");
rmDirRetry(deployTarget);
renameRetry(newDeploy, deployTarget);


// erwartete Persistenzordner sicherstellen
fs.mkdirSync(path.join(deployTarget, "data"), { recursive: true });
fs.mkdirSync(path.join(deployTarget, "logs"), { recursive: true });

// neue Version persistieren
target.writeEnvVersion(config, candidate.version);

// docker wieder hochfahren + prüfen
await target.startDashboard(config);

// 4) Healthcheck
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

      // Rollback nzur wenn Backup existiert und Backups aktiv sind
      if (config.backup && config.backup.enabled && backupDir) {
        log("warn", "Update fehlgeschlagen – starte Rollback aus Backup.", {
          backupDir,
        });

        try {
          await target.stopDashboard(config);
          await restoreBackup(backupDir);
          await target.startDashboard(config);
          const okRb = await target.checkHealth(config, 45, 2000);
          if (!okRb) {
           throw new Error("Rollback durchgeführt, aber Healthcheck ist weiterhin rot.");
        }

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
        // kein Backup nur status "Failed"
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

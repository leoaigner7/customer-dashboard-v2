// ------------------------------------------------------------
// BOOT-SAFETY (entscheidend für SYSTEM + Task Scheduler)
// ------------------------------------------------------------
process.chdir(__dirname);

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/********************************************************************
 * CUSTOMER DASHBOARD – AUTO-UPDATER
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

const installRoot = config.paths.installRoot;
const backupRoot = config.paths.backupDir;
const statusFile = config.paths.statusFile;
const intervalMs = config.checkIntervalMs || 300000;

// ------------------------------------------------------------
// LOGGING
// ------------------------------------------------------------
function log(level, msg, extra) {
  target.log(level, msg, config, extra);
}

// ------------------------------------------------------------
// STATUS
// ------------------------------------------------------------
function readStatus() {
  if (!fs.existsSync(statusFile)) return {};
  return JSON.parse(fs.readFileSync(statusFile, "utf8"));
}

function writeStatus(data) {
  fs.mkdirSync(path.dirname(statusFile), { recursive: true });
  fs.writeFileSync(
    statusFile,
    JSON.stringify(
      { ...readStatus(), ...data, lastUpdate: new Date().toISOString() },
      null,
      2
    )
  );
}

// ------------------------------------------------------------
// SEMVER
// ------------------------------------------------------------
function compareSemver(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

// ------------------------------------------------------------
// UPDATE-QUELLEN
// ------------------------------------------------------------
async function getGithubCandidate() {
  const src = config.sources.github;
  if (!src?.enabled) return null;

  const res = await axios.get(src.apiUrl, {
    headers: { "User-Agent": "customer-dashboard-daemon" }
  });

  const tag = res.data.tag_name;
  if (!tag) return null;

  const version = tag.replace(/^v/, "");

  if (
    config.policy?.pinnedVersion &&
    version !== config.policy.pinnedVersion
  ) {
    return null;
  }

  const zipAsset = res.data.assets.find(a => a.name.endsWith(".zip"));
  const hashAsset = res.data.assets.find(a => a.name.endsWith(".sha256"));

  if (!zipAsset || !hashAsset) return null;

  return {
    source: "github",
    artifactType: "zip",
    version,
    zipUrl: zipAsset.browser_download_url,
    hashUrl: hashAsset.browser_download_url
  };
}

async function getOfflineZipCandidate() {
  const src = config.sources.offlineZip;
  if (!src?.enabled || !fs.existsSync(src.zipPath)) return null;

  let version = null;
  try {
    const zip = new AdmZip(src.zipPath);
    const v = zip.getEntry("VERSION.txt");
    if (v) version = zip.readAsText(v).trim();
  } catch {}

  return {
    source: "offlineZip",
    artifactType: "zip",
    version,
    zipPath: src.zipPath,
    hashFile: src.hashFile
  };
}

async function resolveLatestCandidate(currentVersion) {
  const candidates = [];

  const gh = await getGithubCandidate();
  if (gh) candidates.push(gh);

  const off = await getOfflineZipCandidate();
  if (off) candidates.push(off);

  if (!candidates.length) return null;

  return candidates
    .filter(c => c.version)
    .sort((a, b) => compareSemver(b.version, a.version))[0];
}

// ------------------------------------------------------------
// BACKUP
// ------------------------------------------------------------
function createBackup() {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = path.join(backupRoot, ts);
  fs.mkdirSync(dir, { recursive: true });

  const src = path.join(installRoot, "deploy");
  const dest = path.join(dir, "deploy");

  fs.cpSync(src, dest, { recursive: true });
  return dir;
}

function restoreBackup(dir) {
  fs.rmSync(path.join(installRoot, "deploy"), { recursive: true, force: true });
  fs.cpSync(path.join(dir, "deploy"), path.join(installRoot, "deploy"), {
    recursive: true
  });
}

// ------------------------------------------------------------
// UPDATE APPLY (ZIP)
// ------------------------------------------------------------
async function applyZipUpdate(candidate) {
  // --- GITHUB → DOWNLOAD ---
  if (candidate.source === "github") {
    const staging = config.paths.stagingDir;
    fs.mkdirSync(staging, { recursive: true });

    const zipPath = path.join(staging, `github-${candidate.version}.zip`);
    const hashPath = zipPath + ".sha256";

    const zipRes = await axios.get(candidate.zipUrl, { responseType: "stream" });
    await new Promise((r, e) =>
      zipRes.data.pipe(fs.createWriteStream(zipPath)).on("finish", r).on("error", e)
    );

    const hashRes = await axios.get(candidate.hashUrl);
    fs.writeFileSync(hashPath, hashRes.data, "utf8");

    candidate.zipPath = zipPath;
    candidate.hashFile = hashPath;
  }

  // --- HASH PRÜFUNG ---
  if (config.security.requireHash) {
    const ok = await security.verifyZipHash(
      candidate.zipPath,
      candidate.hashFile
    );
    if (!ok) throw new Error("ZIP-Hash ungültig");
  }

  // --- ATOMIC SWAP ---
  const staging = path.join(
    config.paths.stagingDir,
    `update-${Date.now()}`
  );
  fs.mkdirSync(staging, { recursive: true });

  new AdmZip(candidate.zipPath).extractAllTo(staging, true);

  const newDeploy = path.join(staging, "deploy");
  if (!fs.existsSync(newDeploy)) {
    throw new Error("ZIP enthält kein deploy-Verzeichnis");
  }

  fs.rmSync(path.join(installRoot, "deploy"), { recursive: true, force: true });
  fs.renameSync(newDeploy, path.join(installRoot, "deploy"));

  target.writeEnvVersion(config, candidate.version);
  await target.restartDashboard(config);

  const ok = await target.checkHealth(config, 45, 2000);
  if (!ok) throw new Error("Healthcheck fehlgeschlagen");
}

// ------------------------------------------------------------
// MAIN LOOP
// ------------------------------------------------------------
async function checkOnce() {
  const currentVersion = target.readEnvVersion(config);

  const candidate = await resolveLatestCandidate(currentVersion);
  if (!candidate) return;

  if (compareSemver(candidate.version, currentVersion) <= 0) return;

  const backup = createBackup();

  try {
    await applyZipUpdate(candidate);
    writeStatus({
      currentVersion: candidate.version,
      latestVersion: candidate.version,
      lastResult: "success",
      lastSource: candidate.source
    });
  } catch (e) {
    restoreBackup(backup);
    await target.restartDashboard(config);
    writeStatus({
      currentVersion,
      latestVersion: candidate.version,
      lastResult: "rollback",
      lastError: e.message
    });
  }
}

// ------------------------------------------------------------
// START
// ------------------------------------------------------------
async function main() {
  log("info", "Auto-Update-Daemon gestartet");
  await checkAndApplySelfUpdate(config, log, security);

  await sleep(60000);

  while (true) {
    await checkOnce();
    await sleep(intervalMs);
  }
}

main().catch(err => {
  log("error", "Daemon-Absturz", { error: err.message });
  process.exit(1);
});

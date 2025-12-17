const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PUBLIC_KEY_PATH = path.join(__dirname, "trust", "updater-public.pem");

/**
 * Erzwingt eine gültige Ed25519-Signatur.
 * Wirft Error, wenn:
 * - Signatur fehlt
 * - Signatur ungültig ist
 */
function verifySignatureOrThrow(filePath, sigPath) {
  if (!fs.existsSync(sigPath)) {
    throw new Error("Signaturdatei fehlt: " + sigPath);
  }

  const publicKey = fs.readFileSync(PUBLIC_KEY_PATH);
  const data = fs.readFileSync(filePath);
  const sig = fs.readFileSync(sigPath);

  const ok = crypto.verify(null, data, publicKey, sig); // Ed25519
  if (!ok) {
    throw new Error("Signatur ungültig – Update wird abgelehnt");
  }
}

/**
 * Berechnet SHA256-Hash einer Datei.
 */
function sha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);

    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

/**
 * Prüft ZIP gegen eine Hash-Datei.
 */
async function verifyZipHash(zipPath, hashFile) {
  if (!fs.existsSync(hashFile)) {
    throw new Error("Hash-Datei fehlt: " + hashFile);
  }

  const expected = fs
    .readFileSync(hashFile, "utf8")
    .trim()
    .split(/\s+/)[0];

  const actual = await sha256(zipPath);

  if (actual.toLowerCase() !== expected.toLowerCase()) {
    throw new Error("ZIP-Hash stimmt nicht überein");
  }
}

module.exports = {
  verifySignatureOrThrow,
  verifyZipHash,
  sha256
};

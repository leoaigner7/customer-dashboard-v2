const fs = require("fs");
const crypto = require("crypto");

/**
 * Berechnet SHA256-Hash einer Datei.
 * @param {string} filePath
 * @returns {Promise<string>} hex-Hash
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
 * Prüft, ob der SHA256-Hash einer Datei dem erwarteten Hash entspricht.
 * @param {string} filePath
 * @param {string} expectedHash
 * @returns {Promise<boolean>}
 */
async function verifySha256(filePath, expectedHash) {
  const actual = await sha256(filePath);
  return actual.toLowerCase() === expectedHash.toLowerCase();
}

/**
 * Prüft eine RSA-Signatur für eine Datei.
 * @param {string} filePath
 * @param {string} signatureFile
 * @param {string} publicKeyFile
 * @returns {Promise<boolean>}
 */
async function verifySignature(filePath, signatureFile, publicKeyFile) {
  const publicKey = fs.readFileSync(publicKeyFile, "utf8");
  const signature = fs.readFileSync(signatureFile);

  const verify = crypto.createVerify("RSA-SHA256");
  const stream = fs.createReadStream(filePath);

  return new Promise((resolve, reject) => {
    stream.on("error", reject);
    stream.on("data", (chunk) => verify.update(chunk));
    stream.on("end", () => {
      try {
        const ok = verify.verify(publicKey, signature);
        resolve(ok);
      } catch (err) {
        reject(err);
      }
    });
  });
}

module.exports = {
  sha256,
  verifySha256,
  verifySignature
};

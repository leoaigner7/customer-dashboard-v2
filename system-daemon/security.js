const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
// pfad zum öffentlichen schlüssel des Update-Herstellers -> prüfen ob ein Update wirklich autorisiert ist
const PUBLIC_KEY_PATH = path.join(__dirname, "trust", "updater-public.pem");

// prüft die kryptografische Signatur eines Updates -> error wenn eine signatur fehlt oder ungültig ist
function verifySignatureOrThrow(filePath, sigPath) {
  // ohne signaturdatein kein Vertrauen -> sofort abbruch
  if (!fs.existsSync(sigPath)) {
    throw new Error("Signaturdatei fehlt: " + sigPath);
  }

  const publicKey = fs.readFileSync(PUBLIC_KEY_PATH);
  const data = fs.readFileSync(filePath);
  const sig = fs.readFileSync(sigPath);

  const ok = crypto.verify(null, data, publicKey, sig); // Signatur prüfen Ed25519
  if (!ok) {
    throw new Error("Signatur ungültig – Update wird abgelehnt");
  }
}


 // Berechnet SHA256-Hash einer Datei.
 
function sha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);

    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}


//Prüft ob der Hash einer Zip-Datei mit dem erwarteten hash übereinstimmt -> erkennt beschädigte Downloads oder Manipulationen einer datei
 
async function verifyZipHash(zipPath, hashFile) {
  // ohne Hash-Datei keine Integritätsprüfung -> abbrechen
  if (!fs.existsSync(hashFile)) {
    throw new Error("Hash-Datei fehlt: " + hashFile);
  }

 const expected = fs
  .readFileSync(hashFile, "utf8")
  .replace(/^\uFEFF/, "") // <-- BOM entfernen
  .trim() // trimmen
  .split(/\s+/)[0]; // nur Hash nehmen


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

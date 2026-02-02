const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const db = require("./db");
const crypto = require("crypto");
// Gütigkeitsdauer des tokens
const TOKEN_EXPIRES = process.env.JWT_EXPIRES_IN || "8h";

// SECRET BESTIMMEN 
let jwtSecret = process.env.JWT_SECRET;

// FALLBACK: Wenn kein Secret da ist, eins generieren (damit der Server nicht crasht)
if (!jwtSecret) {
  console.warn("WARNUNG: JWT_SECRET fehlt! Generiere ein temporäres Secret.");
  jwtSecret = crypto.randomBytes(32).toString("hex");
}
// erstellt ein JWT für einen Nutzer

function signUser(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
    },
    jwtSecret, 
    { expiresIn: TOKEN_EXPIRES }
  );
}

function authMiddleware(requiredRole = null) {
  return (req, res, next) => {
    const auth = req.headers.authorization;
    // prüfen ob ein token vorhanden ist
    if (!auth || !auth.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Token fehlt" });
    }

    const token = auth.replace("Bearer ", "");

    try {
      // token prüfen (Signatur + Ablaufzeit)
      const decoded = jwt.verify(token, jwtSecret);
      req.user = decoded;

//Falls eine Rolle gefordert ist diese prüfen
      if (requiredRole && decoded.role !== requiredRole) {
        return res.status(403).json({ error: "Keine Berechtigung" });
      }

      next();
    } catch (err) {
      return res.status(401).json({ error: "Ungültiger Token" });
    }
  };
}
 // Prüft mail + PW erfolg -> JWT zurückgeben
async function handleLogin(req, res) {
  const { email, password } = req.body || {};
// Validierung
  if (typeof email !== "string" || typeof password !== "string" || !email || !password) {
    return res.status(400).json({ error: "Email und Passwort erforderlich" });
  }

  try {
    const user = db
      .prepare("SELECT * FROM users WHERE email = ?")
      .get(email);

    if (!user) {
      return res.status(401).json({ error: "Ungültige Login-Daten" });
    }
//PW prüfen hash vs klartext
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: "Ungültige Login-Daten" });
    }

    const token = signUser(user);

    res.json({
      token,
      user: {
        email: user.email,
        role: user.role,
      },
    });
  } catch (err) {
    console.error("Login Fehler:", err);
    res.status(500).json({
      error: "Login fehlgeschlagen",
      detail: err.message,
    });
  }
}
// Funktionen exportieren, damit server.js etc. nutzen kann
module.exports = {
  handleLogin,
  authMiddleware,
  signUser,
};
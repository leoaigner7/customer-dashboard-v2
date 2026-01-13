const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const db = require("./db");
const crypto = require("crypto");

const TOKEN_EXPIRES = process.env.JWT_EXPIRES_IN || "8h";

// --- SECRET BESTIMMEN ---
// Wir nennen die Variable hier 'jwtSecret' und bleiben dabei.
let jwtSecret = process.env.JWT_SECRET;

// FALLBACK: Wenn kein Secret da ist, generiere eins (damit der Server nicht crasht)
if (!jwtSecret) {
  console.warn("WARNUNG: JWT_SECRET fehlt! Generiere ein temporäres Secret.");
  jwtSecret = crypto.randomBytes(32).toString("hex");
}
// ------------------------

function signUser(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
    },
    jwtSecret, // KORRIGIERT: Variable existiert jetzt
    { expiresIn: TOKEN_EXPIRES }
  );
}

function authMiddleware(requiredRole = null) {
  return (req, res, next) => {
    const auth = req.headers.authorization;

    if (!auth || !auth.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Token fehlt" });
    }

    const token = auth.replace("Bearer ", "");

    try {
      // KORRIGIERT: Hier auch 'jwtSecret' nutzen
      const decoded = jwt.verify(token, jwtSecret);
      req.user = decoded;

      if (requiredRole && decoded.role !== requiredRole) {
        return res.status(403).json({ error: "Keine Berechtigung" });
      }

      next();
    } catch (err) {
      return res.status(401).json({ error: "Ungültiger Token" });
    }
  };
}

// LOGIN ENDPOINT
async function handleLogin(req, res) {
  const { email, password } = req.body || {};

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

module.exports = {
  handleLogin,
  authMiddleware,
  signUser,
};
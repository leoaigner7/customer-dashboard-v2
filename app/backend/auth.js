const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const db = require("./db");

const jwt = require("jsonwebtoken");
const { jwtSecret } = require("./auth");
const crypto = require("crypto");

let jwtSecret = process.env.JWT_SECRET;

// Nur für DEV / CI automatisch erlauben
if (!jwtSecret) {
  if (
    process.env.NODE_ENV === "development" ||
    process.env.NODE_ENV === "test" ||
    process.env.CI === "true"
  ) {
    jwtSecret = crypto.randomBytes(32).toString("hex");
    console.warn("[WARN] JWT_SECRET not set – using ephemeral secret (dev/ci only)");
  } else {
    throw new Error(
      "JWT_SECRET is required. Refusing to start without a secret."
    );
  }
}

module.exports = {
  jwtSecret,
};


const TOKEN_EXPIRES = process.env.JWT_EXPIRES_IN || "8h";


function signUser(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
    },
    JWT_SECRET,
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
      const decoded = jwt.verify(token, JWT_SECRET);
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

// LOGIN ENDPOINT — wird jetzt in server.js eingebunden
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

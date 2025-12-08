const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const db = require("./db");

const JWT_SECRET = process.env.JWT_SECRET || "super-secret-key";
const TOKEN_EXPIRES = "8h";

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
    } catch {
      return res.status(401).json({ error: "Ungültiger Token" });
    }
  };
}

// Login-Handler
async function handleLogin(req, res) {
  const { email, password } = req.body;

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
    res.status(500).json({ error: "Login fehlgeschlagen", detail: err.message });
  }
}

module.exports = {
  signUser,
  authMiddleware,
  handleLogin,
};

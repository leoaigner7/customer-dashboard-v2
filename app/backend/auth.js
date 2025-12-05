const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { db } = require("./db.js");

// -----------------------------------------
// Token erstellen
// -----------------------------------------
function signUser(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    process.env.JWT_SECRET || "default_secret",
    { expiresIn: "7d" }
  );
}

// -----------------------------------------
// Middleware für geschützte Routen
// -----------------------------------------
function authMiddleware() {
  return (req, res, next) => {
    const header = req.headers.authorization;
    if (!header) return res.status(401).json({ error: "Missing token" });

    const token = header.split(" ")[1];
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || "default_secret");
      req.user = decoded;
      next();
    } catch (e) {
      return res.status(401).json({ error: "Invalid token" });
    }
  };
}

// -----------------------------------------
// Admin-Benutzer automatisch erstellen
// -----------------------------------------
function seedAdmin() {
  const admin = db.prepare("SELECT * FROM users WHERE email = ?").get("admin@example.com");
  if (!admin) {
    const hash = bcrypt.hashSync("admin123", 10);
    db.prepare(
      "INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)"
    ).run("admin@example.com", hash, "admin");
    console.log("[INIT] Admin erstellt: admin@example.com / admin123");
  }
}

seedAdmin();

// -----------------------------------------
// LOGIN ROUTE
// -----------------------------------------
router.post("/login", (req, res) => {
  const { email, password } = req.body;

  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);

  if (!user) return res.status(401).json({ error: "Invalid credentials" });

  const valid = bcrypt.compareSync(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: "Invalid credentials" });

  const token = signUser(user);
  res.json({ token });
});

// -----------------------------------------
// CURRENT USER / TOKEN CHECK
// -----------------------------------------
router.get("/me", authMiddleware(), (req, res) => {
  res.json({ user: req.user });
});

// -----------------------------------------
// EXPORT: Router (für server.js) + Funktionen (falls benötigt)
// -----------------------------------------
module.exports = router;
module.exports.signUser = signUser;
module.exports.authMiddleware = authMiddleware;
module.exports.seedAdmin = seedAdmin;

const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { db } = require("./db");

// ===== Admin erzeugen =====
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

// ===== Token =====
function signUser(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    process.env.JWT_SECRET || "default_secret",
    { expiresIn: "7d" }
  );
}

// ===== Middleware =====
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

// ===== ROUTES =====
router.post("/login", (req, res) => {
  const { email, password } = req.body;

  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  if (!user) return res.status(401).json({ error: "Invalid credentials" });

  const valid = bcrypt.compareSync(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: "Invalid credentials" });

  return res.json({ token: signUser(user) });
});

router.get("/me", authMiddleware(), (req, res) => {
  res.json({ user: req.user });
});

module.exports = {
  router,
  signUser,
  authMiddleware,
  seedAdmin
};

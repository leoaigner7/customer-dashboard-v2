import express from "express";
import bcrypt from "bcryptjs";
import { db } from "../db.js";
import { authMiddleware, signUser } from "../auth.js";

export function createUserRouter() {
  const router = express.Router();

  router.post("/login", async (req, res) => {
    const { email, password } = req.body;

    const user = db
      .prepare("SELECT * FROM users WHERE email = ?")
      .get(email);
    if (!user) return res.status(401).json({ error: "Invalid credentials" });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });

    const token = signUser(user);

    res.json({
      token,
      user: { id: user.id, email: user.email, role: user.role }
    });
  });

  router.get("/me", authMiddleware(), (req, res) => {
    const user = db
      .prepare("SELECT id, email, role FROM users WHERE id = ?")
      .get(req.user.id);
    res.json(user);
  });

  router.get("/", authMiddleware("admin"), (_req, res) => {
    const users = db
      .prepare("SELECT id, email, role FROM users")
      .all();
    res.json(users);
  });

  return router;
}

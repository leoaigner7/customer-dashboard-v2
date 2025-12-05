import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";

export default function LoginPage() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("admin@example.com");
  const [password, setPassword] = useState("admin123");
  const [error, setError] = useState("");

  const submit = async e => {
    e.preventDefault();
    setError("");
    try {
      await login(email, password);
      nav("/");
    } catch (err) {
      setError("Login fehlgeschlagen");
    }
  };

  return (
    <div className="center">
      <form className="card" onSubmit={submit}>
        <h1>Login</h1>
        <label>E-Mail
          <input value={email} onChange={e => setEmail(e.target.value)} />
        </label>
        <label>Passwort
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
          />
        </label>
        {error && <div className="error">{error}</div>}
        <button type="submit">Anmelden</button>
      </form>
    </div>
  );
}

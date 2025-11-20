import { useAuth } from "../context/AuthContext.jsx";
import useVersion from "../hooks/useVersion.js";

export default function Topbar({ user }) {
  const { logout } = useAuth();
  const version = useVersion();

  return (
    <header className="topbar">
      <div>
        Willkommen, {user?.email}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
        <span className="muted">Version {version}</span>
        <button onClick={logout}>Logout</button>
      </div>
    </header>
  );
}

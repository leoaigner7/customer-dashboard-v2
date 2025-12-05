import { useAuth } from "../context/AuthContext.jsx";

export default function Topbar({ user }) {
  const { logout } = useAuth();
  return (
    <header className="topbar">
      <div>Willkommen, {user?.email}</div>
      <button onClick={logout}>Logout</button>
    </header>
  );
}

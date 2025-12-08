import { Link, useLocation } from "react-router-dom";

export default function Sidebar() {
  const location = useLocation();
  const link = (to, label) => (
    <Link
      to={to}
      className={
        "nav-link" + (location.pathname === to ? " nav-link-active" : "")
      }
    >
      {label}
    </Link>
  );

  return (
    <aside className="sidebar">
      <h2>Customer Dashboard</h2>
      {link("/", "Dashboard")}
      {link("/status", "Update-Status")} {/* NEU */}
      {link("/logs", "Logs")}
      {link("/reports", "Reports")}
      {link("/settings", "Einstellungen")}
    </aside>
  );
}

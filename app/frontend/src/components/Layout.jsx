import { useAuth } from "../context/AuthContext.jsx";
import Sidebar from "./Sidebar.jsx";
import Topbar from "./Topbar.jsx";

export default function Layout({ children }) {
  const { user } = useAuth();

  return (
    <div className="layout">
      <Sidebar />
      <div className="main">
        <Topbar user={user} />
        <div className="content">{children}</div>
      </div>
    </div>
  );
}

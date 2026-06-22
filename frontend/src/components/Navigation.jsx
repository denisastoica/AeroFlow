import React from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const Navigation = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  if (!user) return null;

  const navItems = {
    customer: [
      { to: "/dashboard", label: "My Deliveries" },
      { to: "/map", label: "Map" },
    ],
    dispatcher: [
      { to: "/dashboard", label: "Operations" },
      { to: "/map", label: "Operational Map" },
      { to: "/deliveries", label: "Deliveries" },
      { to: "/missions", label: "Live Missions" },
      { to: "/analytics", label: "Performance" },
    ],
    admin: [
      { to: "/dashboard", label: "Admin Console" },
      { to: "/users", label: "Users" },
      { to: "/drones", label: "Fleet" },
      { to: "/audit", label: "Audit Log" },
      { to: "/alerts", label: "System Health" },
      { to: "/analytics", label: "Global Reports" },
      { to: "/settings", label: "Configuration" },
      { to: "/map", label: "System Map" },
    ],
  };

  const items = navItems[user.role] || navItems.customer;

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  return (
    <nav className="navbar">
      <div style={{ display: "flex", alignItems: "center", gap: "20px" }}>
        <div className="nav-brand">AeroFlow</div>
        <div className="nav-links">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}
            >
              {item.label}
            </NavLink>
          ))}
        </div>
      </div>

      <div className="nav-user">
        <span><strong>{user.name}</strong></span>
        <span className="nav-role">{user.role.toUpperCase()}</span>
        <button onClick={handleLogout} className="nav-logout">Logout</button>
      </div>
    </nav>
  );
};

export default Navigation;

import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { ShieldAlert } from "lucide-react";

export default function ProtectedRoute({ children, requiredRoles }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex-center" style={{ height: "100vh", background: "#0f172a" }}>
        <div className="spinner" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (requiredRoles && !requiredRoles.includes(user.role)) {
    return (
      <div className="stack theme-admin" style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", padding: 40 }}>
        <div className="card animate-pop" style={{ maxWidth: 450, padding: 40 }}>
          <div style={{ 
            width: 80, height: 80, borderRadius: "50%", background: "rgba(255, 77, 109, 0.1)",
            color: "#ff4d6d", display: "flex", alignItems: "center", justifyContent: "center",
            margin: "0 auto 24px auto"
          }}>
            <ShieldAlert size={40} />
          </div>
          <h2 style={{ marginBottom: 12 }}>Access Restricted</h2>
          <p className="subtle" style={{ fontSize: 15, lineHeight: 1.6, marginBottom: 32 }}>
            Your account ({user.role}) does not have the necessary permissions to access this administrative module.
          </p>
          <button className="btn btn-primary" onClick={() => window.history.back()}>
            Go Back
          </button>
        </div>
      </div>
    );
  }

  return children;
}

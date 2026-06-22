import React, { useState, useEffect } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import Navigation from "./components/Navigation";
import Login from "./components/Login";
import Register from "./components/Register";
import ForgotPassword from "./components/ForgotPassword";
import CustomerDashboard from "./components/CustomerDashboard";
import DispatcherDashboard from "./components/DispatcherDashboard";
import DroneMap from "./components/DroneMap";
import CustomerMap from "./components/CustomerMap";
import MissionList from "./components/MissionList";
import AnalyticsDashboard from "./components/AnalyticsDashboard";
import DronesPage from "./components/DronesPage";
import UserManagement from "./components/UserManagement";
import AuditLog from "./components/AuditLog";
import AdminDashboard from "./components/AdminDashboard";
import SystemAlertsPage from "./components/SystemAlertsPage";
import SettingsPage from "./components/SettingsPage";
import DeliveryHistory from "./components/DeliveryHistory";
import { ToastContainer } from "./components/Toast";
import { useToast, ToastProvider } from "./hooks/useToast";
import ErrorBoundary, { PageErrorBoundary } from "./components/ErrorBoundary";
import ProtectedRoute from "./components/ProtectedRoute";
import "./App.css";

function AppContent() {
  const { isAuthenticated, user, loading } = useAuth();
  const { toasts, removeToast, warning } = useToast();
  const location = useLocation();

    useEffect(() => {
    const sessionExpired = localStorage.getItem("session_expired");
    if (sessionExpired) {
      warning("Your session has expired. Please sign in again.");
      localStorage.removeItem("session_expired");
    }
  }, [location.pathname, warning]);

  if (loading) {
    return (
      <div style={{ position: "fixed", inset: 0, zIndex: 2000, background: "rgba(255,255,255,0.85)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center" }}>
          <div className="spinner" style={{ width: 48, height: 48, margin: "0 auto 18px", border: "6px solid #eee", borderTop: "6px solid #33d69f", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
          <div style={{ fontSize: 20, fontWeight: 700, color: "#333" }}>Loading application...</div>
        </div>
        <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  const isAuthPage = location.pathname === "/login" || location.pathname === "/register" || location.pathname === "/forgot-password";

    if (isAuthenticated && localStorage.getItem("session_expired")) {
    localStorage.removeItem("session_expired");
  }

  return (
    <div className="app-bg" style={{ fontFamily: "'Inter', 'Segoe UI', sans-serif" }}>
      <ToastContainer toasts={toasts} onClose={removeToast} />
      
      {isAuthenticated && !isAuthPage && <Navigation />}

      <Routes>
                <Route path="/login" element={!isAuthenticated ? <Login /> : <Navigate to="/dashboard" replace />} />
        <Route path="/register" element={!isAuthenticated ? <Register /> : <Navigate to="/dashboard" replace />} />
        <Route path="/forgot-password" element={!isAuthenticated ? <ForgotPassword /> : <Navigate to="/dashboard" replace />} />

                <Route path="/dashboard" element={
          <ProtectedRoute>
            <PageErrorBoundary key="dashboard">
              {user?.role === "customer" ? (
                <CustomerDashboard />
              ) : user?.role === "admin" ? (
                <AdminDashboard />
              ) : (
                <DispatcherDashboard />
              )}
            </PageErrorBoundary>
          </ProtectedRoute>
        } />

        <Route path="/map" element={
          <ProtectedRoute>
            <PageErrorBoundary key="map">
              {user?.role === "customer" ? <CustomerMap /> : <DroneMap />}
            </PageErrorBoundary>
          </ProtectedRoute>
        } />

        <Route path="/deliveries" element={
          <ProtectedRoute requiredRoles={["admin", "dispatcher"]}>
            <PageErrorBoundary key="deliveries">
              <DeliveryHistory />
            </PageErrorBoundary>
          </ProtectedRoute>
        } />

        <Route path="/drones" element={
          <ProtectedRoute requiredRoles={["admin", "dispatcher"]}>
            <PageErrorBoundary key="drones">
              <DronesPage />
            </PageErrorBoundary>
          </ProtectedRoute>
        } />

        <Route path="/missions" element={
          <ProtectedRoute requiredRoles={["admin", "dispatcher"]}>
            <PageErrorBoundary key="missions">
              <div className="stack">
                <header className="page-header">
                  <div>
                    <h1>Mission Control</h1>
                    <p className="subtle">Monitor active flights, telemetry, and mission replay.</p>
                  </div>
                </header>
                <MissionList />
              </div>
            </PageErrorBoundary>
          </ProtectedRoute>
        } />

        <Route path="/analytics" element={
          <ProtectedRoute requiredRoles={["admin", "dispatcher"]}>
            <PageErrorBoundary key="analytics">
              <AnalyticsDashboard />
            </PageErrorBoundary>
          </ProtectedRoute>
        } />

        <Route path="/users" element={
          <ProtectedRoute requiredRoles={["admin"]}>
            <PageErrorBoundary key="users">
              <UserManagement />
            </PageErrorBoundary>
          </ProtectedRoute>
        } />

        <Route path="/audit" element={
          <ProtectedRoute requiredRoles={["admin"]}>
            <PageErrorBoundary key="audit">
              <AuditLog />
            </PageErrorBoundary>
          </ProtectedRoute>
        } />

        <Route path="/alerts" element={
          <ProtectedRoute requiredRoles={["admin", "dispatcher"]}>
            <PageErrorBoundary key="alerts">
              <SystemAlertsPage />
            </PageErrorBoundary>
          </ProtectedRoute>
        } />

        <Route path="/settings" element={
          <ProtectedRoute requiredRoles={["admin"]}>
            <PageErrorBoundary key="settings">
              <SettingsPage />
            </PageErrorBoundary>
          </ProtectedRoute>
        } />

                <Route path="/" element={<Navigate to={isAuthenticated ? "/dashboard" : "/login"} replace />} />
        <Route path="*" element={
          <div style={{ padding: 40, textAlign: "center" }}>
            <h2>404 - Page Not Found</h2>
            <p className="subtle" style={{ marginBottom: 20 }}>The page you are looking for doesn't exist or has been moved.</p>
            <button className="btn btn-primary" onClick={() => window.location.href = "/"}>Back to Dashboard</button>
          </div>
        } />
      </Routes>
    </div>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <ToastProvider>
          <AppContent />
        </ToastProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}

export default App;

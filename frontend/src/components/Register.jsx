import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const Register = () => {
  const [formData, setFormData] = useState({
    email: "",
    password: "",
    name: "",
    phone: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const { register } = useAuth();
  const navigate = useNavigate();

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      await register(
        formData.email,
        formData.password,
        formData.name,
        formData.phone,
        "customer"
      );
      setSuccess(true);
      setFormData({ email: "", password: "", name: "", phone: "" });
      setTimeout(() => navigate("/dashboard"), 1500);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-shell" style={{ position: "relative", overflow: "hidden" }}>
            <svg
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          zIndex: 0,
          pointerEvents: "none",
        }}
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <pattern id="hexGrid" width="60" height="103.92" patternUnits="userSpaceOnUse" patternTransform="scale(0.8)">
            <path d="M30 0 L60 17.32 L60 51.96 L30 69.28 L0 51.96 L0 17.32 Z" fill="none" stroke="rgba(255,255,255,0.02)" strokeWidth="1"/>
            <path d="M30 69.28 L60 86.6 L60 121.24 L30 138.56 L0 121.24 L0 86.6 Z" fill="none" stroke="rgba(255,255,255,0.02)" strokeWidth="1"/>
          </pattern>
          <radialGradient id="maskFade" cx="50%" cy="50%" r="50%">
            <stop offset="35%" stopColor="black" />
            <stop offset="90%" stopColor="white" />
          </radialGradient>
        </defs>

                <rect width="100%" height="100%" fill="url(#hexGrid)" mask="url(#bgMask)" />
        <mask id="bgMask">
          <rect width="100%" height="100%" fill="url(#maskFade)" />
        </mask>

                <circle cx="10%" cy="20%" r="250" fill="rgba(124, 92, 255, 0.12)" filter="blur(80px)" />
        <circle cx="90%" cy="80%" r="300" fill="rgba(106, 228, 255, 0.1)" filter="blur(80px)" />
      </svg>

            <svg 
        viewBox="0 0 100 100" 
        preserveAspectRatio="none" 
        style={{ 
          position: "absolute", 
          inset: 0, 
          width: "100%", 
          height: "100%", 
          zIndex: 0, 
          pointerEvents: "none",
          overflow: "visible"
        }}
      >
        <defs>
          <g id="drone-icon" fill="currentColor">
                        <rect x="-0.8" y="-0.8" width="1.6" height="1.6" rx="0.3" />
                        <line x1="-0.8" y1="-0.8" x2="-1.6" y2="-1.6" stroke="currentColor" strokeWidth="0.25" />
            <line x1="0.8" y1="-0.8" x2="1.6" y2="-1.6" stroke="currentColor" strokeWidth="0.25" />
            <line x1="-0.8" y1="0.8" x2="-1.6" y2="1.6" stroke="currentColor" strokeWidth="0.25" />
            <line x1="0.8" y1="0.8" x2="1.6" y2="1.6" stroke="currentColor" strokeWidth="0.25" />
                        <circle cx="-1.6" cy="-1.6" r="0.6" fill="none" stroke="currentColor" strokeWidth="0.2" opacity="0.8" />
            <circle cx="1.6" cy="-1.6" r="0.6" fill="none" stroke="currentColor" strokeWidth="0.2" opacity="0.8" />
            <circle cx="-1.6" cy="1.6" r="0.6" fill="none" stroke="currentColor" strokeWidth="0.2" opacity="0.8" />
            <circle cx="1.6" cy="1.6" r="0.6" fill="none" stroke="currentColor" strokeWidth="0.2" opacity="0.8" />
                        <circle cx="0" cy="-0.6" r="0.2" fill="var(--bg0)" />
          </g>
        </defs>

        <g stroke="rgba(106, 228, 255, 0.2)" strokeWidth="0.15" fill="none" strokeDasharray="1 2">
          <path d="M -10 20 Q 25 5 50 30 T 110 20" />
          <path d="M 110 80 Q 75 95 50 70 T -10 80" stroke="rgba(124, 92, 255, 0.2)" />
        </g>
        
                <circle cx="25" cy="12.5" r="0.4" fill="rgba(106, 228, 255, 0.4)" />
        <circle cx="75" cy="25" r="0.4" fill="rgba(106, 228, 255, 0.4)" />
        
        <circle cx="75" cy="87.5" r="0.4" fill="rgba(124, 92, 255, 0.4)" />
        <circle cx="25" cy="75" r="0.4" fill="rgba(124, 92, 255, 0.4)" />
        
                <g style={{ color: "var(--accent)" }} opacity="0.4" filter="drop-shadow(0 0 2px var(--accent))">
          <animateMotion 
            dur="15s" 
            repeatCount="indefinite" 
            path="M -10 20 Q 25 5 50 30 T 110 20"
            rotate="auto"
          />
          <use href="#drone-icon" />
        </g>
        <g style={{ color: "var(--accent2)" }} opacity="0.4" filter="drop-shadow(0 0 2px var(--accent2))">
          <animateMotion 
            dur="20s" 
            repeatCount="indefinite" 
            path="M 110 80 Q 75 95 50 70 T -10 80"
            rotate="auto"
          />
          <use href="#drone-icon" />
        </g>
      </svg>

      <div className="card auth-card fade-in" style={{ zIndex: 1, position: "relative" }}>
        <div className="card-body">
          <div className="brand" style={{ justifyContent: "space-between", marginBottom: 16 }}>
            <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
              <div style={{
                width: 52,
                height: 52,
                borderRadius: 14,
                background: "linear-gradient(135deg, rgba(106, 228, 255, 0.15) 0%, rgba(124, 92, 255, 0.15) 100%)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 8px 16px rgba(0,0,0,0.2), inset 0 1px 1px rgba(255,255,255,0.2)",
                border: "1px solid rgba(255,255,255,0.1)",
                flexShrink: 0
              }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="url(#logo-grad)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <defs>
                    <linearGradient id="logo-grad" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0%" stopColor="var(--accent)" />
                      <stop offset="100%" stopColor="var(--accent2)" />
                    </linearGradient>
                  </defs>
                  <rect x="9.5" y="9.5" width="5" height="5" rx="1.5" />
                  <path d="M10 10l-3.5 -3.5" />
                  <path d="M14 10l3.5 -3.5" />
                  <path d="M10 14l-3.5 3.5" />
                  <path d="M14 14l3.5 3.5" />
                  <circle cx="5" cy="5" r="2" />
                  <circle cx="19" cy="5" r="2" />
                  <circle cx="5" cy="19" r="2" />
                  <circle cx="19" cy="19" r="2" />
                </svg>
              </div>

              <div className="brand-title">
                <h1 style={{ fontSize: 26, letterSpacing: "-0.03em", marginBottom: 2 }}>AeroFlow</h1>
                <p style={{ color: "rgba(255,255,255,0.75)", fontSize: 12, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase" }}>
                  Drone Delivery Platform
                </p>
              </div>
            </div>
            
            <span className="badge" style={{ background: "var(--accent2-dim)", borderColor: "rgba(124,92,255,0.3)", color: "var(--accent2)" }}>
              New Account
            </span>
          </div>

          <div className="divider" />

          <h2 className="card-title" style={{ marginBottom: 4, fontSize: 24 }}>
            Create Account
          </h2>
          <p className="subtle" style={{ fontSize: 14, marginBottom: 16, marginTop: 0 }}>
            Register as a <strong style={{ color: "var(--accent)" }}>customer</strong>
          </p>

          {error && <div className="alert alert-danger">{error}</div>}

          {success && (
            <div className="alert alert-success">
              Account created successfully! Redirecting to dashboard...
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div className="field">
              <label className="label">Full Name</label>
              <input
                className="input"
                type="text"
                name="name"
                value={formData.name}
                onChange={handleChange}
                required
                placeholder="John Doe"
                autoComplete="name"
              />
            </div>

            <div className="field">
              <label className="label">Email</label>
              <input
                className="input"
                type="email"
                name="email"
                value={formData.email}
                onChange={handleChange}
                required
                placeholder="email@example.com"
                autoComplete="email"
              />
            </div>

            <div className="field">
              <label className="label">Phone <span style={{ fontWeight: 400, color: "var(--muted2)" }}>(optional)</span></label>
              <input
                className="input"
                type="tel"
                name="phone"
                value={formData.phone}
                onChange={handleChange}
                placeholder="+4070..."
                autoComplete="tel"
              />
            </div>

            <div className="field" style={{ marginBottom: 8 }}>
              <label className="label">Password</label>
              <input
                className="input"
                type="password"
                name="password"
                value={formData.password}
                onChange={handleChange}
                required
                placeholder="••••••••"
                autoComplete="new-password"
              />
              <div style={{ fontSize: 12, color: "var(--muted2)", display: "flex", gap: 12, flexWrap: "wrap" }}>
                <span style={{ color: formData.password.length >= 8 ? "var(--success)" : "inherit" }}>
                  {formData.password.length >= 8 ? "✓" : "○"} Min. 8 characters
                </span>
                <span style={{ color: /[A-Z]/.test(formData.password) ? "var(--success)" : "inherit" }}>
                  {/[A-Z]/.test(formData.password) ? "✓" : "○"} Uppercase letter
                </span>
                <span style={{ color: /\d/.test(formData.password) ? "var(--success)" : "inherit" }}>
                  {/\d/.test(formData.password) ? "✓" : "○"} Number
                </span>
              </div>
            </div>

            <button className="btn btn-primary" type="submit" disabled={loading} style={{ width: "100%", padding: "12px 16px", fontSize: 14, marginTop: 8, display: "flex", justifyContent: "center", gap: 8 }}>
              {loading ? (
                <><span className="spinner spinner-sm" /> Creating account...</>
              ) : (
                <>
                  Create Account
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12h14" />
                    <path d="M12 5l7 7-7 7" />
                  </svg>
                </>
              )}
            </button>
          </form>

          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", marginTop: 12, gap: 8 }}>
            <span className="subtle" style={{ fontSize: 13 }}>Already have an account?</span>
            <Link
              className="btn-ghost"
              to="/login"
              style={{ fontSize: 13, textDecoration: "none" }}
            >
              Sign In →
            </Link>
          </div>

          <div className="divider" />

          <p className="subtle" style={{ fontSize: 12, lineHeight: 1.6, margin: 0, textAlign: "center" }}>
            The <strong>dispatcher</strong> role can only be created by an administrator.
          </p>
        </div>
      </div>
    </div>
  );
};

export default Register;

import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { authAPI, getErrorMessage } from "../services/api";

const STEPS = { EMAIL: "email", CODE: "code", DONE: "done" };

const ForgotPassword = () => {
  const [step, setStep] = useState(STEPS.EMAIL);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const navigate = useNavigate();

  const handleRequestCode = async (e) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setLoading(true);

    try {
      const res = await authAPI.forgotPassword({ email });
      setMessage(res.data.message);
      setStep(STEPS.CODE);
    } catch (err) {
      if (err.response?.status === 429) {
        setError("Too many requests. Please wait a moment and try again.");
      } else {
        setError(getErrorMessage(err, "Failed to send reset code."));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    setError(null);
    setMessage(null);

    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      const res = await authAPI.resetPassword({
        email,
        code,
        new_password: newPassword,
      });
      setMessage(res.data.message);
      setStep(STEPS.DONE);
    } catch (err) {
      if (err.response?.status === 429) {
        setError("Too many requests. Please wait a moment and try again.");
      } else {
        setError(getErrorMessage(err, "Failed to reset password."));
      }
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
            
            <span className="badge" style={{ background: "rgba(255, 179, 64, 0.15)", borderColor: "rgba(255, 179, 64, 0.3)", color: "#ffb340" }}>
              Recovery
            </span>
          </div>

          <div className="divider" />

          <h2 className="card-title" style={{ marginBottom: 4, fontSize: 24 }}>
            {step === STEPS.DONE ? "Password Reset" : "Forgot Password"}
          </h2>
          <p className="subtle" style={{ fontSize: 14, marginBottom: 16, marginTop: 0 }}>
            {step === STEPS.EMAIL && "Enter your email to receive a reset code"}
            {step === STEPS.CODE && "Enter the 6-digit code and your new password"}
            {step === STEPS.DONE && "Your password has been changed successfully"}
          </p>

          {error && <div className="alert alert-danger">{error}</div>}
          {message && !error && (
            <div className="alert" style={{
              background: "rgba(51, 214, 159, 0.1)",
              border: "1px solid rgba(51, 214, 159, 0.3)",
              color: "#33d69f",
              borderRadius: "var(--radius2)",
              padding: "10px 14px",
              fontSize: 13,
              marginBottom: 16,
            }}>
              {message}
            </div>
          )}

                    {step === STEPS.EMAIL && (
            <form onSubmit={handleRequestCode}>
              <div className="field">
                <label className="label">Email</label>
                <input
                  className="input"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  placeholder="your@email.com"
                  autoComplete="email"
                />
              </div>

              <button
                className="btn btn-primary"
                type="submit"
                disabled={loading}
                style={{ width: "100%", padding: "12px 16px", fontSize: 14, marginTop: 8, display: "flex", justifyContent: "center", gap: 8 }}
              >
                {loading ? (
                  <><span className="spinner spinner-sm" /> Sending...</>
                ) : (
                  <>
                    Send Reset Code
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 12h14" />
                      <path d="M12 5l7 7-7 7" />
                    </svg>
                  </>
                )}
              </button>
            </form>
          )}

                    {step === STEPS.CODE && (
            <form onSubmit={handleResetPassword}>
              <div className="field">
                <label className="label">Reset Code</label>
                <input
                  className="input"
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  required
                  placeholder="123456"
                  style={{
                    textAlign: "center",
                    fontSize: 24,
                    fontWeight: 800,
                    letterSpacing: "8px",
                    fontFamily: "'Courier New', monospace",
                  }}
                />
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                  Check your email for the 6-digit code
                </div>
              </div>

              <div className="field">
                <label className="label">New Password</label>
                <input
                  className="input"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  placeholder="••••••••"
                  autoComplete="new-password"
                  minLength={8}
                />
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                  Min 8 chars, uppercase, lowercase, digit
                </div>
              </div>

              <div className="field" style={{ marginBottom: 20 }}>
                <label className="label">Confirm Password</label>
                <input
                  className="input"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  placeholder="••••••••"
                  autoComplete="new-password"
                  minLength={8}
                />
              </div>

              <button
                className="btn btn-primary"
                type="submit"
                disabled={loading || code.length !== 6}
                style={{ width: "100%", padding: "12px 16px", fontSize: 14, marginTop: 8, display: "flex", justifyContent: "center", gap: 8 }}
              >
                {loading ? (
                  <><span className="spinner spinner-sm" /> Resetting...</>
                ) : (
                  <>
                    Reset Password
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 12h14" />
                      <path d="M12 5l7 7-7 7" />
                    </svg>
                  </>
                )}
              </button>

              <button
                type="button"
                className="btn-ghost"
                style={{ width: "100%", marginTop: 10, fontSize: 13, textAlign: "center" }}
                onClick={() => {
                  setStep(STEPS.EMAIL);
                  setCode("");
                  setNewPassword("");
                  setConfirmPassword("");
                  setError(null);
                  setMessage(null);
                }}
              >
                ← Request a new code
              </button>
            </form>
          )}

                    {step === STEPS.DONE && (
            <button
              className="btn btn-primary"
              style={{ width: "100%", padding: "13px 16px", fontSize: 14 }}
              onClick={() => navigate("/login")}
            >
              Go to Login →
            </button>
          )}

          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", marginTop: 16, gap: 8 }}>
            <span className="subtle" style={{ fontSize: 13 }}>Remember your password?</span>
            <Link
              className="btn-ghost"
              to="/login"
              style={{ fontSize: 13, textDecoration: "none" }}
            >
              Sign in →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ForgotPassword;

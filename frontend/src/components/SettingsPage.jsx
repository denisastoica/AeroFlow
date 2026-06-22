import React, { useState, useEffect, useCallback } from "react";
import { simulatorAPI, alertsAPI, settingsAPI, getErrorMessage } from "../services/api";
import { useToast } from "../hooks/useToast";
import { useNavigate } from "react-router-dom";
import {
  Settings, RefreshCw, CloudOff, ShieldAlert,
  Shield, CloudRain, ScrollText, ChevronRight,
  AlertTriangle, CheckCircle, Zap, PlayCircle,
  Activity, ArrowRight, ToggleLeft, ToggleRight,
  Battery, Wind, Gauge, Info, Server, Cpu
} from "lucide-react";

const STORAGE_KEY = "platform_thresholds";
const THRESHOLDS = [
  {
    id: "critical_battery",
    label: "Critical Battery Level",
    defaultVal: 15,
    min: 5, max: 25, step: 1, unit: "%",
    desc: "Drones will abort missions and return to charge below this level.",
    icon: <Battery size={16} />, color: "#ff4d6d",
  },
  {
    id: "max_wind",
    label: "Max Allowed Wind Speed",
    defaultVal: 45,
    min: 10, max: 100, step: 5, unit: "km/h",
    desc: "Mission dispatch is suspended in zones exceeding this wind speed.",
    icon: <Wind size={16} />, color: "#6ae4ff",
  },
  {
    id: "maintenance_interval",
    label: "Maintenance Interval",
    defaultVal: 500,
    min: 100, max: 2000, step: 50, unit: "km",
    desc: "Drones are flagged for inspection after accumulating this flight distance.",
    icon: <Gauge size={16} />, color: "#ffd166",
  },
];

function loadThresholds() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return Object.fromEntries(THRESHOLDS.map(t => [t.id, parsed[t.id] ?? t.defaultVal]));
    }
  } catch {}
  return Object.fromEntries(THRESHOLDS.map(t => [t.id, t.defaultVal]));
}

export default function SettingsPage() {
  const [actionLoading, setActionLoading] = useState(null);
  const [showConfirmReset, setShowConfirmReset] = useState(false);
  const [showConfirmWeather, setShowConfirmWeather] = useState(false);
  const [showConfirmDefaults, setShowConfirmDefaults] = useState(false);
  const [thresholds, setThresholds] = useState(loadThresholds);
  const [savedThresholds, setSavedThresholds] = useState(loadThresholds);
  const [simStatus, setSimStatus] = useState("running");
  const toast = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    simulatorAPI.getStatus().then(res => {
      setSimStatus(res.data.status);
    }).catch(err => console.error("Failed to fetch simulator status", err));

    settingsAPI.get().then(res => {
      setThresholds(res.data);
      setSavedThresholds(res.data);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(res.data));
    }).catch(err => console.error("Failed to fetch settings", err));
  }, []);

  const isDirty = THRESHOLDS.some(t => thresholds[t.id] !== savedThresholds[t.id]);

  const handleSaveThresholds = async () => {
    try {
      await settingsAPI.update(thresholds);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(thresholds));
      setSavedThresholds(thresholds);
      toast.success("Thresholds saved successfully.");
    } catch {
      toast.error("Failed to save thresholds to server.");
    }
  };

  const handleResetThresholds = async () => {
    const defaults = Object.fromEntries(THRESHOLDS.map(t => [t.id, t.defaultVal]));
    try {
      await settingsAPI.update(defaults);
      setThresholds(defaults);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(defaults));
      setSavedThresholds(defaults);
      toast.success("Thresholds reset to defaults.");
    } catch {
      toast.error("Failed to reset thresholds.");
    }
    setShowConfirmDefaults(false);
  };

    const handleAction = useCallback(async (label, fn, successMsg) => {
    setActionLoading(label);
    try {
      await fn();
      toast.success(successMsg);
    } catch (err) {
      toast.error(getErrorMessage(err, `Failed: ${label}`));
    } finally {
      setActionLoading(null);
    }
  }, [toast]);

  const handleResetFleet = async () => {
    await handleAction("reset", simulatorAPI.resetFleet, "Fleet reset successfully — all drones returned to base.");
    setShowConfirmReset(false);
  };

  const handleClearWeather = async () => {
    await handleAction("weather", simulatorAPI.clearWeather, "Weather cleared — all zones reset to clear sky.");
    setShowConfirmWeather(false);
  };

  const handlePauseResume = async () => {
    if (simStatus === "running") {
      await handleAction("pause", simulatorAPI.pause, "Simulator paused.");
      setSimStatus("paused");
    } else {
      await handleAction("resume", simulatorAPI.resume, "Simulator resumed.");
      setSimStatus("running");
    }
  };

  return (
    <div className="scfg-root stack theme-admin">

            <header className="page-header">
        <div>
          <div className="scfg-eyebrow">PLATFORM · CONFIGURATION · SYSTEM</div>
          <h1 style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 4 }}>
            <span className="scfg-title-icon"><Settings size={24} /></span>
            System Configuration
          </h1>
          <p className="subtle" style={{ marginTop: 6, fontSize: 14 }}>
            Manage platform-wide settings, simulator controls, and operational thresholds.
          </p>
        </div>

                <div className="scfg-status-badge" style={{
          color: simStatus === "running" ? "#33d69f" : "#ffd166",
          background: simStatus === "running" ? "rgba(51,214,159,0.08)" : "rgba(255,209,102,0.08)",
          border: `1px solid ${simStatus === "running" ? "rgba(51,214,159,0.2)" : "rgba(255,209,102,0.2)"}`,
        }}>
          <span className={`scfg-pulse ${simStatus === "running" ? "green" : "yellow"}`} />
          SIM: {simStatus === "running" ? "RUNNING" : "PAUSED"}
        </div>
      </header>

            <div className="scfg-quick-row">
        <QuickAction
          icon={<RefreshCw size={20} />}
          label="Reset Drone Fleet"
          desc="Return all drones to base and clear active missions."
          color="#ff4d6d"
          btnLabel="Reset Fleet"
          danger
          loading={actionLoading === "reset"}
          onClick={() => setShowConfirmReset(true)}
        />
        <QuickAction
          icon={<CloudOff size={20} />}
          label="Reset Simulated Weather"
          desc="Reset every zone to clear sky conditions."
          color="#6ae4ff"
          btnLabel="Reset Weather"
          loading={actionLoading === "weather"}
          onClick={() => setShowConfirmWeather(true)}
        />
        <QuickAction
          icon={simStatus === "running" ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
          label={simStatus === "running" ? "Pause Simulator" : "Resume Simulator"}
          desc={simStatus === "running" ? "Freeze all drone movements and mission progress." : "Resume drone movements and mission execution."}
          color={simStatus === "running" ? "#ffd166" : "#33d69f"}
          btnLabel={simStatus === "running" ? "Pause" : "Resume"}
          loading={actionLoading === "pause" || actionLoading === "resume"}
          onClick={handlePauseResume}
        />
      </div>

            <div className="scfg-main-grid">

                <div className="card scfg-card">
          <div className="scfg-card-head">
            <span className="scfg-card-icon" style={{ color: "#ffd166", background: "rgba(255,209,102,0.1)" }}>
              <ShieldAlert size={18} />
            </span>
            <div>
              <div className="scfg-card-title">Safety Thresholds</div>
              <div className="scfg-card-sub">Operational limits for fleet management</div>
            </div>
          </div>
          <div className="scfg-card-body">
            <div className="scfg-threshold-list">
              {THRESHOLDS.map(t => (
                <ThresholdRow
                  key={t.id}
                  config={t}
                  value={thresholds[t.id]}
                  onChange={v => setThresholds(prev => ({ ...prev, [t.id]: v }))}
                />
              ))}
            </div>
            <div className="scfg-threshold-actions">
              <button
                className="scfg-threshold-reset"
                onClick={() => setShowConfirmDefaults(true)}
                title="Reset all thresholds to factory defaults"
              >
                <RefreshCw size={13} /> Reset Defaults
              </button>
              <button
                className={`scfg-threshold-save ${isDirty ? "dirty" : ""}`}
                onClick={handleSaveThresholds}
                disabled={!isDirty}
              >
                <CheckCircle size={14} />
                {isDirty ? "Save Changes" : "Up to date"}
              </button>
            </div>
          </div>
        </div>

                <div className="scfg-links-col">
          <LinkCard
            title="Restricted Zones"
            desc="Define and manage no-fly zones across the operational area."
            icon={<Shield size={22} />}
            color="#ff4d6d"
            onClick={() => navigate("/map")}
          />
            <LinkCard
              title="Charging Stations"
              desc="Manage charging infrastructure and station availability."
              icon={<Zap size={22} />}
              color="#00e5ff"
              onClick={() => navigate("/map")}
            />
          <LinkCard
            title="System Alerts"
            desc="Review live atmospheric conditions and configure alert thresholds."
            icon={<CloudRain size={22} />}
            color="#6ae4ff"
            onClick={() => navigate("/alerts")}
          />
          <LinkCard
            title="Audit Log"
            desc="Review compliance records, event history, and system mutations."
            icon={<ScrollText size={22} />}
            color="#a78bfa"
            onClick={() => navigate("/audit")}
            ctaLabel="OPEN"
          />
        </div>
      </div>

      
            {showConfirmReset && (
        <div className="scfg-overlay" onClick={() => setShowConfirmReset(false)}>
          <div className="scfg-modal animate-pop" onClick={e => e.stopPropagation()}>
            <div className="scfg-modal-icon danger">
              <ShieldAlert size={36} />
            </div>
            <h3 className="scfg-modal-title">Are you sure you want to reset the fleet?</h3>
            <p className="scfg-modal-body">
              Active missions may be cancelled and all drones will return to base. This action cannot be undone.
            </p>
            <div className="scfg-modal-actions">
              <button className="btn" onClick={() => setShowConfirmReset(false)}>Cancel</button>
              <button
                className="btn btn-danger"
                onClick={handleResetFleet}
                disabled={actionLoading === "reset"}
              >
                {actionLoading === "reset" ? (
                  <><RefreshCw size={14} className="spin" /> Resetting...</>
                ) : "Confirm Reset"}
              </button>
            </div>
          </div>
        </div>
      )}

            {showConfirmWeather && (
        <div className="scfg-overlay" onClick={() => setShowConfirmWeather(false)}>
          <div className="scfg-modal animate-pop" onClick={e => e.stopPropagation()}>
            <div className="scfg-modal-icon" style={{ background: "rgba(106,228,255,0.1)", color: "#6ae4ff", border: "1px solid rgba(106,228,255,0.2)" }}>
              <CloudOff size={36} />
            </div>
            <h3 className="scfg-modal-title">Reset Simulated Weather?</h3>
            <p className="scfg-modal-body">
              This will remove all active weather zones and restore clear conditions across the operational area.
            </p>
            <div className="scfg-modal-actions">
              <button className="btn" onClick={() => setShowConfirmWeather(false)}>Cancel</button>
              <button
                className="btn btn-primary"
                style={{ background: '#6ae4ff', color: '#000' }}
                onClick={handleClearWeather}
                disabled={actionLoading === "weather"}
              >
                {actionLoading === "weather" ? (
                  <><RefreshCw size={14} className="spin" /> Resetting...</>
                ) : "Confirm Reset"}
              </button>
            </div>
          </div>
        </div>
      )}

            {showConfirmDefaults && (
        <div className="scfg-overlay" onClick={() => setShowConfirmDefaults(false)}>
          <div className="scfg-modal animate-pop" onClick={e => e.stopPropagation()}>
            <div className="scfg-modal-icon" style={{ background: "rgba(255,209,102,0.1)", color: "#ffd166", border: "1px solid rgba(255,209,102,0.2)" }}>
              <RefreshCw size={36} />
            </div>
            <h3 className="scfg-modal-title">Reset Thresholds to Defaults?</h3>
            <p className="scfg-modal-body">
              This will revert all safety and operational thresholds (Battery, Wind, Maintenance) to their factory defaults.
            </p>
            <div className="scfg-modal-actions">
              <button className="btn" onClick={() => setShowConfirmDefaults(false)}>Cancel</button>
              <button
                className="btn btn-primary"
                style={{ background: '#ffd166', color: '#000' }}
                onClick={handleResetThresholds}
              >
                Confirm Reset
              </button>
            </div>
          </div>
        </div>
      )}

            <style>{`
        .scfg-root { max-width: 1400px; }
        .scfg-eyebrow { font-size: 10px; font-weight: 800; letter-spacing: 0.12em; color: rgba(255,255,255,0.2); }
        .scfg-title-icon {
          width: 46px; height: 46px; border-radius: 14px;
          background: rgba(167,139,250,0.1); border: 1px solid rgba(167,139,250,0.2);
          display: inline-flex; align-items: center; justify-content: center;
          color: #a78bfa; flex-shrink: 0;
        }
        .scfg-status-badge {
          display: flex; align-items: center; gap: 10px;
          padding: 10px 18px; border-radius: 12px;
          font-size: 11px; font-weight: 900; letter-spacing: 0.08em;
          align-self: flex-start;
        }
        .scfg-pulse {
          width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
        }
        .scfg-pulse.green { background: #33d69f; box-shadow: 0 0 10px #33d69f; animation: pulse 2s infinite; }
        .scfg-pulse.yellow { background: #ffd166; box-shadow: 0 0 10px #ffd166; }
        @keyframes pulse { 0%,100% { opacity: 0.5; } 50% { opacity: 1; } }

        /* Quick Actions */
        .scfg-quick-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; }
        .scfg-quick-card {
          background: var(--bg1); border: 1px solid rgba(255,255,255,0.06);
          border-radius: 18px; padding: 22px; display: flex; flex-direction: column; gap: 16px;
          transition: 0.25s;
        }
        .scfg-quick-card:hover { transform: translateY(-2px); border-color: rgba(255,255,255,0.12); box-shadow: 0 10px 30px rgba(0,0,0,0.25); }
        .scfg-quick-top { display: flex; align-items: center; gap: 14px; }
        .scfg-quick-icon { width: 44px; height: 44px; border-radius: 12px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .scfg-quick-label { font-size: 15px; font-weight: 800; color: #fff; }
        .scfg-quick-desc { font-size: 12px; color: rgba(255,255,255,0.4); line-height: 1.5; }
        .scfg-quick-btn {
          align-self: flex-start; padding: 8px 18px; border-radius: 10px;
          font-size: 12px; font-weight: 800; cursor: pointer; transition: 0.2s;
          display: flex; align-items: center; gap: 8px;
        }
        .scfg-quick-btn.normal { background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); color: #fff; }
        .scfg-quick-btn.normal:hover { background: rgba(255,255,255,0.1); }
        .scfg-quick-btn.danger-btn { background: rgba(255,77,109,0.12); border: 1px solid rgba(255,77,109,0.3); color: #ff4d6d; }
        .scfg-quick-btn.danger-btn:hover { background: rgba(255,77,109,0.22); }
        .scfg-quick-btn:disabled { opacity: 0.4; cursor: not-allowed; }

        /* Main Grid */
        .scfg-main-grid { display: grid; grid-template-columns: 1fr 340px; gap: 24px; }
        .scfg-links-col { display: flex; flex-direction: column; gap: 16px; }

        /* Card internals */
        .scfg-card { overflow: hidden; }
        .scfg-card-head {
          display: flex; align-items: center; gap: 14px;
          padding: 20px 24px; border-bottom: 1px solid rgba(255,255,255,0.05);
        }
        .scfg-card-icon { width: 36px; height: 36px; border-radius: 10px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .scfg-card-title { font-size: 15px; font-weight: 800; color: #fff; }
        .scfg-card-sub { font-size: 11px; color: rgba(255,255,255,0.35); margin-top: 2px; }
        .scfg-card-body { padding: 24px; }

        /* Threshold Rows */
        .scfg-threshold-list { display: flex; flex-direction: column; gap: 28px; }
        .scfg-threshold-row {}
        .scfg-threshold-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
        .scfg-threshold-label { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 700; color: rgba(255,255,255,0.8); }
        .scfg-threshold-val { font-size: 15px; font-weight: 900; }
        .scfg-slider {
          -webkit-appearance: none; appearance: none;
          width: 100%; height: 5px; border-radius: 5px;
          background: rgba(255,255,255,0.08); outline: none; cursor: pointer;
        }
        .scfg-slider::-webkit-slider-thumb {
          -webkit-appearance: none; appearance: none;
          width: 18px; height: 18px; border-radius: 50%;
          background: var(--thumb-color, var(--primary)); cursor: pointer;
          border: 2px solid rgba(0,0,0,0.4); box-shadow: 0 2px 8px rgba(0,0,0,0.4);
          transition: transform 0.15s;
        }
        .scfg-slider::-webkit-slider-thumb:hover { transform: scale(1.2); }
        .scfg-threshold-desc { font-size: 11px; color: rgba(255,255,255,0.3); margin-top: 6px; }

        /* Threshold action buttons */
        .scfg-threshold-actions {
          display: flex; align-items: center; justify-content: flex-end; gap: 10px; margin-top: 28px;
          padding-top: 20px; border-top: 1px solid rgba(255,255,255,0.05);
        }
        .scfg-threshold-reset {
          display: flex; align-items: center; gap: 6px;
          padding: 8px 16px; border-radius: 10px;
          background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08);
          color: rgba(255,255,255,0.4); font-size: 12px; font-weight: 700; cursor: pointer;
          transition: 0.2s;
        }
        .scfg-threshold-reset:hover { color: #fff; border-color: rgba(255,255,255,0.18); background: rgba(255,255,255,0.08); }
        .scfg-threshold-save {
          display: flex; align-items: center; gap: 7px;
          padding: 8px 20px; border-radius: 10px;
          background: rgba(51,214,159,0.08); border: 1px solid rgba(51,214,159,0.2);
          color: rgba(51,214,159,0.5); font-size: 12px; font-weight: 800; cursor: not-allowed;
          transition: 0.2s;
        }
        .scfg-threshold-save.dirty {
          background: rgba(51,214,159,0.14); border-color: rgba(51,214,159,0.4);
          color: #33d69f; cursor: pointer;
          box-shadow: 0 0 16px rgba(51,214,159,0.15);
        }
        .scfg-threshold-save.dirty:hover { background: rgba(51,214,159,0.22); box-shadow: 0 0 24px rgba(51,214,159,0.25); }

        /* Link Cards */
        .scfg-link-card {
          background: var(--bg1); border: 1px solid rgba(255,255,255,0.06);
          border-radius: 16px; padding: 20px; display: flex; flex-direction: column; gap: 12px;
          transition: 0.2s; cursor: pointer;
        }
        .scfg-link-card:hover { border-color: rgba(255,255,255,0.14); transform: translateX(3px); }
        .scfg-link-icon { width: 42px; height: 42px; border-radius: 12px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .scfg-link-title { font-size: 14px; font-weight: 800; color: #fff; }
        .scfg-link-desc { font-size: 11.5px; color: rgba(255,255,255,0.4); line-height: 1.4; }
        .scfg-link-footer { display: flex; align-items: center; gap: 8px; margin-top: 4px; }
        .scfg-link-cta { font-size: 11px; font-weight: 800; letter-spacing: 0.04em; }

        /* Scenario Section */
        .scfg-scenario-section { overflow: hidden; }

        /* Modal */
        .scfg-overlay {
          position: fixed; inset: 0; background: rgba(0,0,0,0.55);
          backdrop-filter: blur(10px); display: flex; align-items: center;
          justify-content: center; z-index: 4000;
        }
        .scfg-modal {
          background: linear-gradient(180deg, #141a2e, #0d1221);
          border: 1px solid rgba(255,255,255,0.1); border-radius: 24px;
          padding: 40px; width: 100%; max-width: 440px;
          box-shadow: 0 30px 80px rgba(0,0,0,0.6); text-align: center;
        }
        .scfg-modal-icon {
          width: 72px; height: 72px; border-radius: 50%;
          display: flex; align-items: center; justify-content: center; margin: 0 auto 20px;
        }
        .scfg-modal-icon.danger { background: rgba(255,77,109,0.1); color: #ff4d6d; border: 1px solid rgba(255,77,109,0.2); }
        .scfg-modal-title { margin: 0 0 12px 0; font-size: 22px; font-weight: 900; }
        .scfg-modal-body { font-size: 14px; color: rgba(255,255,255,0.6); line-height: 1.6; margin-bottom: 32px; }
        .scfg-modal-actions { display: flex; gap: 12px; }
        .scfg-modal-actions .btn { flex: 1; }

        .animate-pop { animation: scfgPop 0.3s cubic-bezier(0.34,1.56,0.64,1); }
        @keyframes scfgPop { from { transform: scale(0.88); opacity: 0; } to { transform: scale(1); opacity: 1; } }

        .spin { animation: scfgSpin 1s linear infinite; }
        @keyframes scfgSpin { to { transform: rotate(360deg); } }

        @media (max-width: 1100px) {
          .scfg-quick-row { grid-template-columns: 1fr 1fr; }
          .scfg-main-grid { grid-template-columns: 1fr; }
          .scfg-links-col { flex-direction: row; flex-wrap: wrap; }
          .scfg-links-col > * { flex: 1; min-width: 200px; }
        }
        @media (max-width: 700px) {
          .scfg-quick-row { grid-template-columns: 1fr; }
        }
      `}</style>
    </div>
  );
}

function QuickAction({ icon, label, desc, color, btnLabel, danger, loading, onClick }) {
  return (
    <div className="scfg-quick-card">
      <div className="scfg-quick-top">
        <div className="scfg-quick-icon" style={{ background: `${color}15`, color }}>
          {icon}
        </div>
        <div>
          <div className="scfg-quick-label">{label}</div>
        </div>
      </div>
      <div className="scfg-quick-desc">{desc}</div>
      <button
        className={`scfg-quick-btn ${danger ? "danger-btn" : "normal"}`}
        onClick={onClick}
        disabled={loading}
      >
        {loading ? <><RefreshCw size={13} className="spin" /> Processing...</> : btnLabel}
      </button>
    </div>
  );
}

function ThresholdRow({ config, value, onChange }) {
  const pct = ((value - config.min) / (config.max - config.min)) * 100;
  const trackStyle = {
    background: `linear-gradient(to right, ${config.color} ${pct}%, rgba(255,255,255,0.08) ${pct}%)`,
  };

  return (
    <div className="scfg-threshold-row">
      <div className="scfg-threshold-header">
        <div className="scfg-threshold-label">
          <span style={{ color: config.color }}>{config.icon}</span>
          {config.label}
        </div>
        <div className="scfg-threshold-val" style={{ color: config.color }}>
          {value}{config.unit}
        </div>
      </div>
      <input
        type="range"
        className="scfg-slider"
        min={config.min}
        max={config.max}
        step={config.step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        style={{ "--thumb-color": config.color, ...trackStyle }}
      />
      <div className="scfg-threshold-desc">{config.desc}</div>
    </div>
  );
}

function LinkCard({ title, desc, icon, color, onClick, ctaLabel = "CONFIGURE" }) {
  return (
    <div className="scfg-link-card" onClick={onClick}>
      <div className="scfg-link-icon" style={{ background: `${color}12`, color }}>
        {icon}
      </div>
      <div>
        <div className="scfg-link-title">{title}</div>
        <div className="scfg-link-desc">{desc}</div>
      </div>
      <div className="scfg-link-footer" style={{ color }}>
        <span className="scfg-link-cta">{ctaLabel}</span>
        <ArrowRight size={14} />
      </div>
    </div>
  );
}

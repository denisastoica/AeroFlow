import React, { useCallback, useEffect, useState } from "react";
import { simulatorAPI, getErrorMessage } from "../services/api";
import { useToast } from "../hooks/useToast";
import { 
  CheckCircle2, AlertCircle, XCircle, Ban, 
  Clock, Lightbulb, PlayCircle, Cloud,
  ChevronRight, Info
} from "lucide-react";

const SCENARIO_COLORS = {
  bad_weather:     "#6366f1",
  nfz_conflict:    "#f59e0b",
  low_battery:     "#ef4444",
  auto_reassign:   "#8b5cf6",
  urgent_delivery: "#10b981",
  fleet_stress:    "#06b6d4",
  freeze_thaw:     "#64748b",
};

const STATUS_STYLE = {
  ok:      { bg: "rgba(51,214,159,0.12)",  border: "rgba(51,214,159,0.3)",  color: "#33d69f",  label: "Success", icon: <CheckCircle2 size={12} /> },
  partial: { bg: "rgba(255,209,102,0.12)", border: "rgba(255,209,102,0.3)", color: "#ffd166",  label: "Partial", icon: <AlertCircle size={12} /> },
  skip:    { bg: "rgba(255,209,102,0.1)",  border: "rgba(255,209,102,0.25)",color: "#ffd166",  label: "Skipped", icon: <Ban size={12} />  },
  error:   { bg: "rgba(255,77,109,0.12)",  border: "rgba(255,77,109,0.3)",  color: "#ff6b8a",  label: "Error", icon: <XCircle size={12} />    },
};

function ScenarioCard({ scenario, onRun, running, lastResult }) {
  const color = SCENARIO_COLORS[scenario.id] || "#6ae4ff";
  const isRunning = running === scenario.id;
  const status = lastResult?.status;
  const st = STATUS_STYLE[status];

  return (
    <div
      className="scenario-card"
      style={{
        borderColor: status ? st.border : "rgba(255,255,255,0.1)",
        background: status
          ? st.bg
          : "linear-gradient(145deg, rgba(18,28,48,0.88) 0%, rgba(12,18,32,0.84) 100%)",
      }}
    >
            <div className="scenario-card__head">
        <div className="scenario-card__icon-box" style={{ background: `${color}15`, color }}>
                      <Info size={18} />
        </div>
        <div className="scenario-card__title-wrap">
          <div className="scenario-card__title" style={{ color }}>{scenario.title}</div>
          <div className="scenario-card__subtitle">{scenario.subtitle}</div>
        </div>
        {status && (
          <span className="scenario-card__badge" style={{ color: st.color, border: `1px solid ${st.border}`, display: 'flex', alignItems: 'center', gap: 4 }}>
            {st.icon} {st.label}
          </span>
        )}
      </div>

            <p className="scenario-card__desc">{scenario.description}</p>

            <div className="scenario-card__tags">
        {(scenario.tags || []).map(t => (
          <span key={t} className="scenario-card__tag" style={{ borderColor: `${color}44`, color: `${color}cc` }}>
            #{t}
          </span>
        ))}
        {scenario.duration_hint && (
          <span className="scenario-card__tag scenario-card__tag--time" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Clock size={10} /> {scenario.duration_hint}
          </span>
        )}
      </div>

            {lastResult && (
        <div className="scenario-card__result" style={{ borderColor: st.border, color: st.color }}>
          <div className="scenario-card__result-msg">{lastResult.message}</div>
          {lastResult.tip && (
            <div className="scenario-card__tip" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Lightbulb size={12} /> {lastResult.tip}
            </div>
          )}
          {lastResult.details && (
            <details className="scenario-card__details">
              <summary>Technical details</summary>
              <pre>{JSON.stringify(lastResult.details, null, 2)}</pre>
            </details>
          )}
        </div>
      )}

            <button
        type="button"
        className="scenario-card__btn"
        style={{
          marginTop: "auto",
          background: isRunning ? "rgba(255,255,255,0.06)" : (!!running ? "rgba(255,255,255,0.02)" : `${color}22`),
          borderColor: isRunning ? "rgba(255,255,255,0.15)" : (!!running ? "rgba(255,255,255,0.05)" : `${color}55`),
          color: isRunning ? "rgba(255,255,255,0.5)" : (!!running ? "rgba(255,255,255,0.3)" : color),
        }}
        onClick={() => onRun(scenario.id)}
        disabled={!!running}
        title={!!running && !isRunning ? "Another scenario is currently running." : ""}
      >
        {isRunning ? (
          <span className="scenario-card__spinner" />
        ) : (
          <PlayCircle size={16} />
        )}
        {isRunning ? "Executing..." : (!!running ? "Wait..." : "Run Scenario")}
      </button>
    </div>
  );
}

export default function ScenarioPanel() {
  const [scenarios, setScenarios] = useState([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(null);
  const [results, setResults] = useState({});
  const [clearingWeather, setClearingWeather] = useState(false);
  const [resettingFleet, setResettingFleet] = useState(false);
  const toast = useToast();

  const fetchScenarios = useCallback(async () => {
    try {
      const res = await simulatorAPI.listScenarios();
      setScenarios(res.data.scenarios || []);
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not load scenarios"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchScenarios();
  }, [fetchScenarios]);

  const handleRun = async (scenarioId) => {
    try {
      setRunning(scenarioId);
      const res = await simulatorAPI.runScenario(scenarioId);
      const result = res.data;
      setResults(prev => ({ ...prev, [scenarioId]: result }));

      if (result.status === "ok") {
        toast.success(`Scenario executed successfully.`);
      } else if (result.status === "partial" || result.status === "skip") {
        toast.warning(result.message || "Scenario partially executed.");
      } else {
        toast.error(result.message || "Scenario failed.");
      }
    } catch (err) {
      const msg = getErrorMessage(err, "Error running scenario");
      toast.error(msg);
      setResults(prev => ({ ...prev, [scenarioId]: { status: "error", message: msg } }));
    } finally {
      setRunning(null);
    }
  };

  const handleClearWeather = async () => {
    try {
      setClearingWeather(true);
      await simulatorAPI.clearWeather();
      toast.success("Weather overrides cleared — conditions returning to real values.");
    } catch (err) {
      toast.error(getErrorMessage(err, "Error clearing weather overrides"));
    } finally {
      setClearingWeather(false);
    }
  };

  const handleClearResults = () => setResults({});

  const handleResetFleet = async () => {
    try {
      setResettingFleet(true);
      await simulatorAPI.resetFleet();
      toast.success("Fleet reset successfully — all drones returned to base, NFZs and weather cleared.");
    } catch (err) {
      toast.error(getErrorMessage(err, "Error resetting fleet"));
    } finally {
      setResettingFleet(false);
    }
  };

  if (loading) {
    return (
      <div className="stack">
        <div className="scenario-header">
          <h3>Operational Scenarios</h3>
        </div>
        <div className="scenario-grid">
          {[1, 2, 3, 4, 5, 6, 7].map(i => (
            <div key={i} className="skeleton" style={{ height: 200, borderRadius: 16 }} />
          ))}
        </div>
      </div>
    );
  }

  const hasResults = Object.keys(results).length > 0;

  return (
    <div className="stack">
            <div className="scenario-header">
        <div style={{ textAlign: "left" }}>
          <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 10, fontSize: "20px", fontWeight: 700, justifyContent: "flex-start" }}>
            <PlayCircle size={24} color="var(--primary)" /> 
            Operational Scenarios
          </h3>
          <p className="subtle" style={{ marginTop: 8, fontSize: "14px", lineHeight: 1.5, opacity: 0.85, textAlign: "left" }}>
            Run predefined operational scenarios to test routing, weather, battery, and reassignment logic.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexShrink: 0, alignItems: "flex-start" }}>
          {hasResults && (
            <button
              type="button"
              className="btn"
              onClick={handleClearResults}
              style={{ fontSize: "0.8rem", padding: "6px 12px" }}
            >
              Clear Results
            </button>
          )}
          <button
            type="button"
            className="btn btn-outline"
            onClick={handleClearWeather}
            disabled={clearingWeather}
            style={{
              fontSize: "0.8rem",
              padding: "6px 12px",
              opacity: clearingWeather ? 0.7 : 1,
              background: "rgba(99,102,241,0.12)",
              borderColor: "rgba(99,102,241,0.3)",
              color: "#a5b4fc",
            }}
          >
            {clearingWeather ? "Clearing..." : <><Cloud size={14} /> Reset Weather</>}
          </button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={handleResetFleet}
            disabled={resettingFleet}
            style={{
              fontSize: "0.8rem",
              padding: "6px 12px",
              opacity: resettingFleet ? 0.7 : 1,
            }}
          >
            {resettingFleet ? "Resetting..." : "Reset Fleet"}
          </button>
        </div>
      </div>

            <div className="scenario-tip-banner" style={{ display: 'flex', alignItems: 'flex-start', gap: 14, padding: "16px 20px" }}>
        <Lightbulb size={20} color="#ffd166" style={{ marginTop: 1, flexShrink: 0 }} />
        <div style={{ fontSize: "14px", lineHeight: "1.6", color: "rgba(255,255,255,0.85)" }}>
          <strong style={{ color: "#ffd166", fontWeight: 700, marginRight: 6 }}>How it works:</strong>
          Each scenario updates the database or simulator state. 
          The simulator detects the changes in real time and reacts according to the operational rules.
        </div>
      </div>

            <div className="scenario-grid">
        {scenarios.map(sc => (
          <ScenarioCard
            key={sc.id}
            scenario={sc}
            onRun={handleRun}
            running={running}
            lastResult={results[sc.id] || null}
          />
        ))}
      </div>
    </div>
  );
}

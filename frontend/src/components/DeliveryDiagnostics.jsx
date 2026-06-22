import React, { useState, useEffect } from "react";
import { deliveriesAPI, getErrorMessage } from "../services/api";
import { useToast } from "../hooks/useToast";
import { formatBackendDateTime } from "../utils/datetime";

const REJECTION_REASONS = {
  BATTERY_LOW: "Insufficient battery for the full route.",
  WEIGHT_EXCEEDED: "Package exceeds drone weight capacity.",
  IN_MAINTENANCE: "Drone is currently in maintenance.",
  ALREADY_ASSIGNED: "Drone already has an active mission.",
  NO_ROUTE_FOUND: "Could not find a safe route (possible restricted zones).",
  WEATHER_UNSAFE: "Unfavorable weather conditions for this model.",
  OUT_OF_RANGE: "Destination is outside operational range.",
};

export default function DeliveryDiagnostics({ deliveryId, onClose, mode = "assignment" }) {
  const [diagnostics, setDiagnostics] = useState(null);
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  const isFailureMode = mode === "failure";
  const modalTitle = isFailureMode ? "Failure Diagnostics" : "Assignment Diagnostics";
  const modalSubtitle = `Order #${deliveryId}`;
  const primaryReason = diagnostics?.primary_reason || diagnostics?.failure_reason;
  const diagnosticsStatus = diagnostics?.status || "pending";
  const assignmentRequirements = diagnostics?.delivery_requirements || null;
  const fleetAnalysis = diagnostics?.fleet_analysis || diagnostics?.rejected_drones || [];
  const primaryRecommendation = diagnostics?.recommendations?.[0] || null;
  const headerStatus = isFailureMode ? (diagnostics?.status || "failed") : diagnosticsStatus;
  const headerBadgeTone = getStatusTone(headerStatus);
  const failureContext = diagnostics?.mission_context || diagnostics?.timeline || [];
  const failureReason = diagnostics?.failure_reason || diagnostics?.primary_reason || "No explicit failure reason was recorded for this delivery.";
  const failedStep = diagnostics?.failed_step || "The exact mission step could not be determined.";
  const affectedDrone = diagnostics?.affected_drone || null;
  const operationalImpact = diagnostics?.operational_impact || [];
  const whatHappened = diagnostics?.what_happened || "No human-readable failure summary is available for this delivery yet.";

  useEffect(() => {
    let ignore = false;

    setLoading(true);
    setDiagnostics(null);

    const loadDiagnostics = async () => {
      try {
        const response = await deliveriesAPI.diagnostics(deliveryId);
        if (!ignore) {
          setDiagnostics(response.data);
        }
      } catch (err) {
        if (!ignore) {
          toast.error(getErrorMessage(err, "Error during diagnostics"));
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    };

    loadDiagnostics();

    return () => {
      ignore = true;
    };
  }, [deliveryId, isFailureMode]);

  return (
    <div className="modal-overlay app-modal-overlay" onClick={onClose} style={{ zIndex: 3500 }}>
      <div
        className="modal-content app-modal"
        style={{ maxWidth: 720 }}
        onClick={e => e.stopPropagation()}
        aria-label={`${modalTitle} modal`}
      >
        <div className="app-modal__header">
          <div style={{ display: "grid", gap: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <h2 className="app-modal__title" style={{ margin: 0 }}>{modalTitle}</h2>
              <span className="badge" style={getStatusBadgeStyle(headerBadgeTone)}>
                {formatStatusLabel(headerStatus)}
              </span>
            </div>
            <p className="app-modal__subtitle">{modalSubtitle}</p>
          </div>
          <button className="app-modal__close" onClick={onClose} aria-label="Close diagnostics modal">&times;</button>
        </div>
        
        <div className="app-modal__body" style={{ overflowY: "auto" }}>
          {loading ? (
            <div style={{ textAlign: "center", padding: 40 }}>
              <div className="spinner" style={{ margin: "0 auto 16px" }}></div>
              <p className="subtle">{isFailureMode ? "Collecting failure context..." : "Analyzing drone fleet..."}</p>
            </div>
          ) : isFailureMode ? (
            <>
              <div className="card" style={{ background: "rgba(255,159,67,0.06)", border: "1px solid rgba(255,159,67,0.16)", marginBottom: 24, padding: 16 }}>
                <div style={{ fontWeight: 700, marginBottom: 12 }}>Failure Summary</div>
                <div style={{ display: "grid", gap: 12 }}>
                  <FailureFact
                    label="Delivery Status"
                    value={formatTitleCase(diagnostics?.status || "failed")}
                  />
                  <FailureFact
                    label="Failure Reason"
                    value={failureReason}
                  />
                  <FailureFact
                    label="Failed Step"
                    value={failedStep}
                  />
                  <FailureFact
                    label="Affected Drone"
                    value={affectedDrone?.name || (affectedDrone?.id ? formatDroneName(affectedDrone.id) : "No drone was attached to this failure.")}
                  />
                </div>
              </div>

              <div className="card" style={{ padding: 16, marginBottom: 24, background: "rgba(255,255,255,0.02)" }}>
                <div style={{ fontWeight: 700, marginBottom: 10 }}>What Happened</div>
                <div style={{ fontSize: 14, color: "rgba(255,255,255,0.86)", lineHeight: 1.5 }}>{whatHappened}</div>
              </div>

              <div style={{ marginBottom: 24 }}>
                <h4 style={{ marginBottom: 12, fontSize: 14, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Mission Context
                </h4>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {failureContext.length > 0 ? (
                    failureContext.map((event, index) => (
                      <div
                        key={`${event.event_type}-${event.timestamp}-${index}`}
                        className="card"
                        style={{
                          padding: 12,
                          background: event.is_failure_event ? "rgba(255,77,109,0.08)" : "rgba(255,255,255,0.02)",
                          border: event.is_failure_event ? "1px solid rgba(255,77,109,0.2)" : undefined,
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                          <div style={{ fontWeight: 600 }}>{event.label || formatTitleCase(event.event_type)}</div>
                          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                            {event.is_failure_event && (
                              <span className="badge" style={{ background: "rgba(255,77,109,0.16)", color: "#ff6b8a", borderColor: "rgba(255,77,109,0.28)" }}>
                                Failure event
                              </span>
                            )}
                            <div className="subtle" style={{ fontSize: 12 }}>{formatDateTime(event.timestamp)}</div>
                          </div>
                        </div>
                        <div style={{ marginTop: 8, fontSize: 13, color: "rgba(255,255,255,0.78)" }}>
                          {event.details || "No additional event details were recorded."}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div style={{ textAlign: "center", padding: 20 }} className="subtle">
                      No detailed mission events were recorded for this delivery.
                    </div>
                  )}
                </div>
              </div>

              {operationalImpact.length > 0 && (
                <div className="card" style={{ padding: 16, marginBottom: 24, background: "rgba(255,255,255,0.02)" }}>
                  <div style={{ fontWeight: 700, marginBottom: 10 }}>Operational Impact</div>
                  <ul style={{ paddingLeft: 20, margin: 0 }}>
                    {operationalImpact.map((item, index) => (
                      <li key={`${item}-${index}`} style={{ fontSize: 13, marginBottom: 6, color: "rgba(255,255,255,0.82)" }}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}

              {primaryRecommendation && (
                <div className="card" style={{ padding: 16, background: "rgba(51,214,159,0.05)", border: "1px solid rgba(51,214,159,0.14)" }}>
                  <div style={{ fontWeight: 700, marginBottom: 8 }}>Recommendation</div>
                  <div style={{ fontSize: 14, color: "rgba(255,255,255,0.88)" }}>{primaryRecommendation}</div>
                </div>
              )}
            </>
          ) : diagnostics ? (
            <>
              <div className="card" style={{ background: "rgba(255,179,71,0.07)", border: "1px solid rgba(255,179,71,0.18)", marginBottom: 24, padding: 16 }}>
                <div style={{ fontWeight: 700, marginBottom: 12 }}>Assignment Summary</div>
                <div style={{ display: "grid", gap: 10 }}>
                  <AssignmentFact label="Assignment Status" value={formatTitleCase(diagnosticsStatus)} />
                  <AssignmentFact label="Result" value={diagnostics?.result || "Auto-assignment failed"} />
                  <AssignmentFact label="Primary Reason" value={primaryReason || "No primary reason is available for this order yet."} />
                </div>
              </div>

              {assignmentRequirements && (
                <div className="card" style={{ padding: 16, marginBottom: 24, background: "rgba(255,255,255,0.02)" }}>
                  <div style={{ fontWeight: 700, marginBottom: 12 }}>Delivery Requirements</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
                    <RequirementItem label="Pickup" value={assignmentRequirements.pickup} />
                    <RequirementItem label="Destination" value={assignmentRequirements.destination} />
                    <RequirementItem label="Distance" value={formatDistanceKm(assignmentRequirements.distance_km)} />
                    <RequirementItem label="Priority" value={formatTitleCase(assignmentRequirements.priority)} />
                    <RequirementItem label="Package Type" value={formatTitleCase(assignmentRequirements.package_type)} />
                    <RequirementItem label="Weight" value={formatWeightKg(assignmentRequirements.weight_kg)} />
                    <RequirementItem label="Estimated Duration" value={formatDurationHours(assignmentRequirements.estimated_duration_h)} />
                  </div>
                </div>
              )}

              <div style={{ marginBottom: 24 }}>
                <h4 style={{ marginBottom: 12, fontSize: 14, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Fleet Analysis
                </h4>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {fleetAnalysis.length > 0 ? (
                    fleetAnalysis.map((drone) => (
                      <div key={drone.drone_id} className="card" style={{ padding: 12, background: "rgba(255,255,255,0.02)" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                          <div style={{ fontWeight: 600 }}>{drone.drone_name || formatDroneName(drone.drone_id)}</div>
                          <span className="badge" style={getVerdictBadgeStyle(drone.verdict)}>{drone.verdict}</span>
                        </div>
                        <div style={{ marginTop: 8, display: "flex", gap: 10, flexWrap: "wrap", fontSize: 12 }} className="subtle">
                          <span>Status: <strong>{drone.status_label || formatTitleCase(drone.status)}</strong></span>
                          <span>Battery: <strong>{formatPercent(drone.battery)}</strong></span>
                          <span>Range: <strong>{formatDistanceKm(drone.estimated_range_km)}</strong></span>
                        </div>
                        <div style={{ marginTop: 8, fontSize: 13, color: "rgba(255,255,255,0.82)" }}>
                          {drone.reason_label || REJECTION_REASONS[drone.reason] || drone.reason || "Eligible for automatic assignment"}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div style={{ textAlign: "center", padding: 20 }} className="subtle">
                      No drone evaluation details are available for this order yet.
                    </div>
                  )}
                </div>
              </div>

              {primaryRecommendation && (
                <div className="card" style={{ padding: 16, background: "rgba(51,214,159,0.05)", border: "1px solid rgba(51,214,159,0.14)" }}>
                  <div style={{ fontWeight: 700, marginBottom: 8 }}>Recommendation</div>
                  <div style={{ fontSize: 14, color: "rgba(255,255,255,0.88)" }}>{primaryRecommendation}</div>
                </div>
              )}
            </>
          ) : (
            <div style={{ textAlign: "center", padding: 40 }} className="subtle">
              Could not retrieve diagnostics data.
            </div>
          )}
        </div>
        
        <div className="app-modal__footer">
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

function AssignmentFact({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", color: "rgba(255,255,255,0.55)", marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 14, color: "rgba(255,255,255,0.9)" }}>{value}</div>
    </div>
  );
}

function RequirementItem({ label, value }) {
  return (
    <div className="app-modal__proof-card">
      <div className="app-modal__section-label">{label}</div>
      <div className="app-modal__section-value">{value}</div>
    </div>
  );
}

function FailureFact({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", color: "rgba(255,255,255,0.55)", marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 14, color: "rgba(255,255,255,0.88)" }}>{value}</div>
    </div>
  );
}

function formatStatusLabel(status) {
  return String(status).replace(/_/g, " ").toUpperCase();
}

function formatTitleCase(value) {
  return String(value || "Unavailable").replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function formatDistanceKm(value) {
  if (value == null) {
    return "Unavailable";
  }
  return `${Number(value).toFixed(1)} km`;
}

function formatWeightKg(value) {
  if (value == null) {
    return "Unavailable";
  }
  return `${Number(value).toFixed(1)} kg`;
}

function formatPercent(value) {
  if (value == null) {
    return "Unavailable";
  }
  return `${Number(value).toFixed(0)}%`;
}

function formatDurationHours(value) {
  if (value == null) {
    return "Unavailable";
  }

  const totalMinutes = Math.round(Number(value) * 60);
  if (totalMinutes < 60) {
    return `${totalMinutes} min`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes ? `${hours} h ${minutes} min` : `${hours} h`;
}

function getStatusTone(status) {
  const normalized = String(status || "").toLowerCase();
  if (["failed", "cancelled"].includes(normalized)) {
    return "danger";
  }
  if (["assigned", "delivered", "confirmed"].includes(normalized)) {
    return "success";
  }
  if (["pending", "picking_up", "picked_up", "in_transit", "in_progress"].includes(normalized)) {
    return "warning";
  }
  return "muted";
}

function getStatusBadgeStyle(tone) {
  const tones = {
    warning: { background: "rgba(255,179,71,0.2)", color: "#ffb347" },
    success: { background: "rgba(51,214,159,0.2)", color: "#33d69f" },
    danger: { background: "rgba(255,77,109,0.18)", color: "#ff9f43" },
    muted: { background: "rgba(173,181,189,0.2)", color: "#adb5bd" },
  };
  return tones[tone] || tones.muted;
}

function getVerdictBadgeStyle(verdict) {
  const normalized = String(verdict || "").toLowerCase();
  if (normalized === "eligible") {
    return { background: "rgba(51,214,159,0.18)", color: "#33d69f", borderColor: "rgba(51,214,159,0.3)" };
  }
  if (normalized === "busy") {
    return { background: "rgba(255,179,71,0.18)", color: "#ffb347", borderColor: "rgba(255,179,71,0.3)" };
  }
  return { background: "rgba(255,77,109,0.16)", color: "#ff6b8a", borderColor: "rgba(255,77,109,0.28)" };
}

function formatDateTime(value) {
  if (!value) {
    return "Unavailable";
  }

  return formatBackendDateTime(value, { locale: "en-US" });
}

function formatDroneName(id) {
  if (!id) return "Unknown";
  const greek = ["Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta", "Eta", "Theta", "Iota", "Kappa", "Lambda", "Mu", "Nu", "Xi", "Omicron", "Pi", "Rho", "Sigma", "Tau", "Upsilon"];
  return `AF-${String(id).padStart(2, '0')} ${greek[(id - 1) % greek.length]}`;
}

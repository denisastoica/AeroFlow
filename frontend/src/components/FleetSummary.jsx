import React from "react";

export default function FleetSummary({ stats }) {
    return (
    <div className="map-panel">
      <div className="map-panel__head">
        <span>Fleet Summary</span>
        <span style={{ fontSize: "0.7rem", opacity: 0.6, fontWeight: 400, textTransform: "none" }}>{stats.total} drones</span>
      </div>
      <div className="map-panel__body">
        <div className="map-fleet-stats">
          <div className="map-fleet-stat">
            <span className="map-fleet-stat__value" style={{ color: "#2563eb" }}>{stats.idle}</span>
            <span className="map-fleet-stat__label">Available</span>
          </div>
          <div className="map-fleet-stat">
            <span className="map-fleet-stat__value" style={{ color: "#16a34a" }}>{stats.inMission}</span>
            <span className="map-fleet-stat__label">In Mission</span>
          </div>
          <div className="map-fleet-stat">
            <span className="map-fleet-stat__value" style={{ color: "#ca8a04" }}>{stats.charging}</span>
            <span className="map-fleet-stat__label">Charging</span>
          </div>
          <div className="map-fleet-stat">
            <span className="map-fleet-stat__value" style={{ color: "#6ae4ff" }}>{stats.avgBattery?.toFixed(0)}%</span>
            <span className="map-fleet-stat__label">Avg Battery</span>
          </div>
        </div>
        {stats.lowBattery > 0 && (
          <div className="map-alert map-alert--err" style={{ marginTop: "0.5rem" }}>
            {stats.lowBattery} drone{stats.lowBattery === 1 ? "" : "s"} with battery below 20%
          </div>
        )}
      </div>
    </div>
  );
}

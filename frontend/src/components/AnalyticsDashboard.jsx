import React, { useCallback, useEffect, useState, useMemo } from "react";
import { deliveriesAPI, getErrorMessage } from "../services/api";
import { SuccessRateChart, UtilizationChart, FailureReasonsChart } from "./charts/DashboardCharts";
import {
  BarChart2, TrendingUp, Zap, Clock, Globe2,
  RefreshCw, Download, ShieldCheck, Award,
  Activity, Target, ArrowUpRight, ArrowDownRight,
  Battery, Package, Wind, Cpu
} from "lucide-react";

function fmt(hours) {
  if (hours == null) return "—";
  const mins = hours * 60;
  if (mins < 1) return "<1 min";
  if (mins < 60) return `${Math.round(mins)} min`;
  return `${Math.floor(mins / 60)}h ${Math.round(mins % 60)}m`;
}

export default function AnalyticsDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState("30d");

  const fetchAnalytics = useCallback(async () => {
    try {
      setLoading(true);
      const res = await deliveriesAPI.getAnalytics({ range: dateRange });
      setData(res.data);
    } catch (err) {
          } finally {
      setLoading(false);
    }
  }, [dateRange]);

  useEffect(() => { fetchAnalytics(); }, [fetchAnalytics]);

  const chartData = useMemo(() => {
    if (data?.deliveries_time_series?.length) {
      return data.deliveries_time_series.map(d => ({
        date: d.day_label || d.date,
        success: d.completed,
        failed: d.failed,
      }));
    }
    return [
      { date: "2026-04-22", success: 15, failed: 1 },
      { date: "2026-04-23", success: 18, failed: 0 },
      { date: "2026-04-24", success: 24, failed: 2 },
      { date: "2026-04-25", success: 32, failed: 1 },
      { date: "2026-04-26", success: 28, failed: 3 },
      { date: "2026-04-27", success: 35, failed: 1 },
      { date: "2026-04-28", success: data?.successful_deliveries || 40, failed: data?.failed_deliveries || 2 },
    ];
  }, [data]);

  const CAUSE_LABELS = {
    battery: "Battery / Charging",
    weather: "Weather Hazard",
    route_blocked: "Route Blocked",
    reassignment: "Technical /\nAssignment Conflict",
    aborted_by_dispatcher: "Aborted by Dispatcher",
    unknown: "Legacy / Unclassified",
    other: "Other",
  };

  const failureReasons = useMemo(() => {
    if (data?.failed_by_cause && Object.keys(data.failed_by_cause).length > 0) {
      const total = Object.values(data.failed_by_cause).reduce((a, b) => a + b, 0);
      return Object.entries(data.failed_by_cause).map(([name, count]) => ({
        name: CAUSE_LABELS[name] || name.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase()),
        value: total > 0 ? Math.round((count / total) * 100) : 0,
        count,
      }));
    }
    return [];
  }, [data]);

  const utilizationData = useMemo(() => {
    if (data?.deliveries_time_series?.length) {
      return data.deliveries_time_series.map((d, i) => ({
        label: d.day_label || d.date,
        volume: d.created || 0,
      }));
    }
    return Array.from({ length: 8 }).map((_, i) => ({
      label: `${8 + i}:00`,
      volume: Math.floor(Math.random() * 10),
    }));
  }, [data]);

  const kpis = [
    {
      label: "Total Deliveries",
      value: data?.total_deliveries?.toLocaleString() ?? "—",
      sub: data ? `${data.active_deliveries} active · ${data.pending_deliveries} pending · ${data.cancelled_deliveries} cancelled` : "Orders processed",
      icon: <Package size={20} />,
      color: "#a78bfa",
      trend: "+12.5%",
      up: true,
    },
    {
      label: "Success Rate",
      value: data?.success_rate_pct != null ? `${data.success_rate_pct}%` : "—",
      sub: "Operational reliability",
      icon: <ShieldCheck size={20} />,
      color: "#33d69f",
      trend: "+0.8%",
      up: true,
    },
    {
      label: "Typical Delivery Time",
      value: fmt(data?.avg_delivery_time_h),
      sub: "Request to completion",
      icon: <Clock size={20} />,
      color: "#ffd166",
      trend: "−4 min",
      up: true,
    },
    {
      label: "Battery Health",
      value: data?.avg_battery_health != null ? `${data.avg_battery_health}%` : "—",
      sub: "Current fleet battery condition",
      icon: <Battery size={20} />,
      color: "#ff6b8a",
      trend: "−1.2%",
      up: false,
    },
  ];

    if (loading && !data) {
    return (
      <div className="adash-root">
        <div className="adash-header">
          <div className="skeleton" style={{ width: 280, height: 36, borderRadius: 10 }} />
          <div className="skeleton" style={{ width: 220, height: 36, borderRadius: 10 }} />
        </div>
        <div className="adash-kpi-row">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="skeleton" style={{ height: 130, borderRadius: 20 }} />
          ))}
        </div>
        <div className="adash-charts-row">
          <div className="skeleton" style={{ height: 320, borderRadius: 20 }} />
          <div className="skeleton" style={{ height: 320, borderRadius: 20 }} />
        </div>
        <div className="adash-bottom-row">
          <div className="skeleton" style={{ height: 260, borderRadius: 20 }} />
          <div className="skeleton" style={{ height: 260, borderRadius: 20 }} />
          <div className="skeleton" style={{ height: 260, borderRadius: 20 }} />
        </div>
      </div>
    );
  }

  const weatherHolds = data?.weather_hold_count || 0;
  let weatherImpact = "LOW";
  let weatherColor = "#33d69f";
  if (weatherHolds >= 1 && weatherHolds <= 3) {
    weatherImpact = "MODERATE";
    weatherColor = "#ffd166";
  } else if (weatherHolds >= 4) {
    weatherImpact = "HIGH";
    weatherColor = "#ef476f";
  }

  const handleExport = () => {
    if (!data) return;
    
    let csv = "Global Platform Analytics Export\n";
    csv += `Period: ${dateRange.toUpperCase()}\n\n`;
    
    csv += "--- Key Performance Indicators ---\n";
    csv += `Period Fleet Distance,${data.total_fleet_km ?? 0} km\n`;
    csv += `Avg / Active Drone,${data.avg_flight_km_per_drone ?? 0} km\n`;
    csv += `Period Charge Cycles,${data.total_charge_cycles ?? 0}\n`;
    csv += `Fleet Utilization,${data.utilization_pct ?? 0}%\n`;
    csv += `Success Rate,${data.success_rate_pct ?? 0}%\n`;
    csv += `Failed Deliveries,${data.failed_deliveries ?? 0}\n\n`;
    
    if (data.deliveries_time_series?.length) {
      csv += "--- Deliveries Time Series ---\n";
      csv += "Date,Completed,Failed\n";
      data.deliveries_time_series.forEach(d => {
        csv += `${d.day_label || d.date},${d.completed || 0},${d.failed || 0}\n`;
      });
      csv += "\n";
    }
    
    if (data.drone_leaderboard?.length) {
      csv += "--- Drone Leaderboard ---\n";
      csv += "Drone ID,Name,Status,Missions,Deliveries,Period Distance (km)\n";
      data.drone_leaderboard.forEach(d => {
        csv += `${d.id},${d.name},${d.status},${d.completed_missions},${d.completed_deliveries},${d.total_flight_km}\n`;
      });
    }

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `analytics_${dateRange}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="adash-root">

            <div className="adash-header">
        <div>
          <div className="adash-eyebrow">PLATFORM · INTELLIGENCE · GLOBAL</div>
          <h1 className="adash-title">
            <span className="adash-title-icon"><BarChart2 size={26} /></span>
            Global Platform Analytics
          </h1>
        </div>
        <div className="adash-controls">
          <div className="adash-range-group">
            {["1D", "7D", "30D"].map(r => (
              <button
                key={r}
                className={`adash-range-btn ${dateRange === r.toLowerCase() ? "active" : ""}`}
                onClick={() => setDateRange(r.toLowerCase())}
              >{r}</button>
            ))}
          </div>
          <button className="adash-icon-btn" onClick={fetchAnalytics} title="Refresh">
            <RefreshCw size={17} className={loading ? "spin" : ""} />
          </button>
          <button className="adash-export-btn" onClick={handleExport}>
            <Download size={15} /> Export
          </button>
        </div>
      </div>

            <div className={`adash-kpi-row${loading && data ? " adash-refreshing" : ""}`}>
        {kpis.map((k, i) => (
          <div key={i} className="adash-kpi-card" style={{ "--accent": k.color }}>
            <div className="adash-kpi-top">
              <div className="adash-kpi-icon">{k.icon}</div>
              <span className={`adash-trend ${k.up ? "up" : "down"}`}>
                {k.up ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
                {k.trend}
              </span>
            </div>
            <div className="adash-kpi-val">{k.value}</div>
            <div className="adash-kpi-label">{k.label}</div>
            <div className="adash-kpi-sub">{k.sub}</div>
            <div className="adash-kpi-bar-track">
              <div className="adash-kpi-bar-fill" />
            </div>
          </div>
        ))}
      </div>

            <div className="adash-charts-row">
        <div className="adash-chart-card span-2-col">
          <div className="adash-card-head">
            <span className="adash-card-icon"><TrendingUp size={16} /></span>
            <span>Delivery Throughput</span>
            <div className="adash-legend">
              <span className="adash-leg-dot" style={{ background: "#33d69f" }} />Success
              <span className="adash-leg-dot" style={{ background: "#ff4d6d" }} />Failed
            </div>
          </div>
          <div style={{ height: 240 }}>
            <SuccessRateChart
              data={chartData}
              globalSuccess={data?.successful_deliveries}
              globalFailed={data?.failed_deliveries}
              globalRate={data?.success_rate_pct}
            />
          </div>
        </div>

        <div className="adash-chart-card">
          <div className="adash-card-head">
            <span className="adash-card-icon"><Activity size={16} /></span>
            <span>Delivery Volume</span>
          </div>
          <div style={{ height: 240 }}>
            <UtilizationChart data={utilizationData} />
          </div>
        </div>
      </div>

            <div className="adash-bottom-row">

                <div className="adash-chart-card">
          <div className="adash-card-head">
            <span className="adash-card-icon" style={{ color: "#ff4d6d", background: "rgba(255,77,109,0.12)" }}><Target size={16} /></span>
            <span>Failure Breakdown</span>
          </div>
          <FailureReasonsChart data={failureReasons} />
        </div>

                <div className="adash-chart-card adash-mvp-card">
          <div className="adash-card-head">
            <span className="adash-card-icon" style={{ color: "#ffd166", background: "rgba(255,209,102,0.12)" }}><Award size={16} /></span>
            <span>Fleet MVP</span>
          </div>
          {data?.most_used_drone ? (
            <div className="adash-mvp-body">
              <div className="adash-mvp-drone-name">{data.most_used_drone.name}</div>
              <div className="adash-mvp-id">Drone ID #{data.most_used_drone.id}</div>
              <div className="adash-mvp-stats">
                <div className="adash-stat-pill">
                  <div className="adash-stat-pill-val">{data.most_used_drone.completed_missions}</div>
                  <div className="adash-stat-pill-key">MISSIONS</div>
                </div>
                <div className="adash-stat-pill">
                  <div className="adash-stat-pill-val">{data.most_used_drone.total_flight_km} km</div>
                  <div className="adash-stat-pill-key">PERIOD DISTANCE</div>
                </div>
                <div className="adash-stat-pill">
                  <div className="adash-stat-pill-val">{data.most_used_drone.battery_health_pct ?? 98}%</div>
                  <div className="adash-stat-pill-key">HEALTH</div>
                </div>
              </div>
            </div>
          ) : (
            <div className="adash-empty-mvp">
              <Cpu size={32} />
              <p>No flight data yet</p>
            </div>
          )}
        </div>

                <div className="adash-chart-card">
          <div className="adash-card-head">
            <span className="adash-card-icon"><Zap size={16} /></span>
            <span>Operational Summary</span>
          </div>
          <div className="adash-feed">
            <FeedRow label="Period Fleet Distance" value={`${data?.total_fleet_km?.toFixed(1) ?? 0} km`} icon={<Globe2 size={14} />} />
            <FeedRow label="Avg / Active Drone" value={`${data?.avg_flight_km_per_drone?.toFixed(1) ?? 0} km`} icon={<Activity size={14} />} />
            <FeedRow label="Avg Payload" value={`${data?.avg_weight_kg?.toFixed(1) ?? 0} kg`} icon={<Package size={14} />} />
            <FeedRow label="Period Charge Cycles" value={data?.total_charge_cycles ?? 0} icon={<Battery size={14} />} />
            <FeedRow label="Fleet Utilization" value={`${data?.utilization_pct ?? 0}%`} icon={<Cpu size={14} />} color="#6ae4ff" />
            <FeedRow 
              label="Weather Impact" 
              value={weatherImpact} 
              icon={<Wind size={14} />} 
              color={weatherColor} 
              tooltip="Based on weather-related mission holds in the selected period." 
            />
          </div>
        </div>
      </div>

            <style>{`
        /* Root wrapper */
        .adash-root {
          display: flex; flex-direction: column; gap: 24px;
          padding: 32px; max-width: 1600px; margin: 0 auto;
          font-family: 'Inter', system-ui, sans-serif;
        }

        /* Header */
        .adash-eyebrow {
          font-size: 10px; font-weight: 800; letter-spacing: 0.12em;
          color: rgba(255,255,255,0.2); margin-bottom: 6px;
        }
        .adash-title {
          margin: 0; font-size: 28px; font-weight: 900;
          letter-spacing: -0.02em; color: #a78bfa;
          display: flex; align-items: center; gap: 12px;
        }
        .adash-title-icon {
          width: 44px; height: 44px; border-radius: 14px;
          background: rgba(167,139,250,0.12); border: 1px solid rgba(167,139,250,0.2);
          display: flex; align-items: center; justify-content: center;
          color: #a78bfa; flex-shrink: 0;
        }
        .adash-header {
          display: flex; justify-content: space-between; align-items: flex-end;
        }
        .adash-controls {
          display: flex; align-items: center; gap: 12px;
        }
        .adash-range-group {
          display: flex; background: rgba(0,0,0,0.25); border-radius: 10px;
          border: 1px solid rgba(255,255,255,0.07); padding: 3px; gap: 2px;
        }
        .adash-range-btn {
          padding: 6px 14px; border: none; background: transparent;
          color: rgba(255,255,255,0.35); font-size: 11px; font-weight: 800;
          letter-spacing: 0.05em; cursor: pointer; border-radius: 7px; transition: 0.2s;
        }
        .adash-range-btn.active {
          background: #a78bfa; color: #fff;
          box-shadow: 0 2px 10px rgba(167,139,250,0.4);
        }
        .adash-icon-btn {
          width: 38px; height: 38px; border-radius: 10px;
          background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08);
          color: rgba(255,255,255,0.5); cursor: pointer; display: flex;
          align-items: center; justify-content: center; transition: 0.2s;
        }
        .adash-icon-btn:hover { color: #a78bfa; border-color: rgba(167,139,250,0.3); background: rgba(167,139,250,0.06); }
        .adash-export-btn {
          height: 38px; padding: 0 18px; border-radius: 10px;
          background: rgba(167,139,250,0.12); border: 1px solid rgba(167,139,250,0.25);
          color: #a78bfa; font-size: 12px; font-weight: 800; cursor: pointer;
          display: flex; align-items: center; gap: 8px; transition: 0.2s;
        }
        .adash-export-btn:hover { background: rgba(167,139,250,0.22); box-shadow: 0 4px 16px rgba(167,139,250,0.2); }

        /* KPI Row */
        .adash-kpi-row.adash-refreshing { opacity: 0.45; pointer-events: none; transition: opacity 0.2s; }
        .adash-kpi-row {
          display: grid; grid-template-columns: repeat(4, 1fr); gap: 18px;
        }
        .adash-kpi-card {
          background: var(--bg1); border: 1px solid rgba(255,255,255,0.06);
          border-radius: 20px; padding: 22px 22px 18px;
          position: relative; overflow: hidden; transition: 0.25s;
          display: flex; flex-direction: column; gap: 6px;
        }
        .adash-kpi-card::before {
          content: ''; position: absolute; inset: 0;
          background: linear-gradient(135deg, color-mix(in srgb, var(--accent) 6%, transparent), transparent 60%);
          pointer-events: none;
        }
        .adash-kpi-card:hover { transform: translateY(-3px); border-color: rgba(255,255,255,0.12); box-shadow: 0 12px 40px rgba(0,0,0,0.3); }
        .adash-kpi-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
        .adash-kpi-icon {
          width: 40px; height: 40px; border-radius: 12px;
          background: color-mix(in srgb, var(--accent) 14%, transparent);
          color: var(--accent); display: flex; align-items: center; justify-content: center;
          border: 1px solid color-mix(in srgb, var(--accent) 20%, transparent);
        }
        .adash-trend {
          display: flex; align-items: center; gap: 3px;
          font-size: 11px; font-weight: 800; padding: 3px 8px;
          border-radius: 6px;
        }
        .adash-trend.up { color: #33d69f; background: rgba(51,214,159,0.1); }
        .adash-trend.down { color: #ff6b8a; background: rgba(255,107,138,0.1); }
        .adash-kpi-val {
          font-size: 30px; font-weight: 900; color: #fff;
          line-height: 1; letter-spacing: -0.02em;
        }
        .adash-kpi-label { font-size: 13px; font-weight: 700; color: rgba(255,255,255,0.7); }
        .adash-kpi-sub { font-size: 10.5px; color: rgba(255,255,255,0.3); }
        .adash-kpi-bar-track {
          height: 3px; background: rgba(255,255,255,0.05); border-radius: 3px;
          margin-top: 12px; overflow: hidden;
        }
        .adash-kpi-bar-fill {
          height: 100%; width: 70%; border-radius: 3px;
          background: linear-gradient(90deg, color-mix(in srgb, var(--accent) 60%, transparent), var(--accent));
        }

        /* Charts layout */
        .adash-charts-row {
          display: grid; grid-template-columns: 2fr 1fr; gap: 18px;
        }
        .adash-bottom-row {
          display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 18px;
        }
        .adash-chart-card {
          background: var(--bg1); border: 1px solid rgba(255,255,255,0.06);
          border-radius: 20px; overflow: hidden; display: flex; flex-direction: column;
        }
        .adash-card-head {
          display: flex; align-items: center; gap: 10px;
          padding: 16px 20px; border-bottom: 1px solid rgba(255,255,255,0.04);
          font-size: 13px; font-weight: 800; color: rgba(255,255,255,0.7);
        }
        .adash-card-icon {
          width: 28px; height: 28px; border-radius: 8px;
          background: rgba(167,139,250,0.1); color: #a78bfa;
          display: flex; align-items: center; justify-content: center; flex-shrink: 0;
        }
        .adash-legend {
          display: flex; align-items: center; gap: 12px;
          font-size: 11px; font-weight: 700; color: rgba(255,255,255,0.4);
          margin-left: auto;
        }
        .adash-leg-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; margin-right: 4px; }

        /* MVP Card */
        .adash-mvp-card { background: linear-gradient(135deg, #141a2e 0%, #0d1221 100%); }
        .adash-mvp-body { padding: 20px; display: flex; flex-direction: column; gap: 16px; flex: 1; }
        .adash-mvp-drone-name { font-size: 26px; font-weight: 900; color: #fff; line-height: 1; }
        .adash-mvp-id { font-size: 10px; font-weight: 800; color: rgba(255,255,255,0.25); letter-spacing: 0.08em; }
        .adash-mvp-stats { display: flex; gap: 10px; margin-top: 8px; }
        .adash-stat-pill {
          flex: 1; padding: 12px; background: rgba(255,255,255,0.03); 
          border: 1px solid rgba(255,255,255,0.06); border-radius: 12px; text-align: center;
        }
        .adash-stat-pill-val { font-size: 16px; font-weight: 900; color: #ffd166; }
        .adash-stat-pill-key { font-size: 8px; font-weight: 900; color: rgba(255,255,255,0.25); margin-top: 3px; letter-spacing: 0.06em; }
        .adash-empty-mvp { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; color: rgba(255,255,255,0.2); gap: 8px; padding: 40px; }
        .adash-empty-mvp p { margin: 0; font-size: 13px; }

        /* Operational Feed */
        .adash-feed { display: flex; flex-direction: column; }
        .adash-feed-row {
          display: flex; align-items: center; gap: 14px;
          padding: 12px 20px; border-bottom: 1px solid rgba(255,255,255,0.03); transition: 0.15s;
        }
        .adash-feed-row:last-child { border-bottom: none; }
        .adash-feed-row:hover { background: rgba(255,255,255,0.02); }
        .adash-feed-icon {
          width: 30px; height: 30px; border-radius: 8px;
          background: rgba(255,255,255,0.04); display: flex; align-items: center;
          justify-content: center; color: rgba(255,255,255,0.3); flex-shrink: 0;
        }
        .adash-feed-label { flex: 1; font-size: 12px; font-weight: 600; color: rgba(255,255,255,0.6); }
        .adash-feed-val { font-size: 13px; font-weight: 800; color: #fff; }

        /* Spin */
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }

        /* Responsive */
        @media (max-width: 1200px) {
          .adash-kpi-row { grid-template-columns: repeat(2, 1fr); }
          .adash-charts-row { grid-template-columns: 1fr; }
          .adash-bottom-row { grid-template-columns: 1fr; }
        }
      `}</style>
    </div>
  );
}

function FeedRow({ label, value, icon, color, tooltip }) {
  return (
    <div className="adash-feed-row" title={tooltip}>
      <div className="adash-feed-icon" style={color ? { color, background: `${color}14` } : {}}>
        {icon}
      </div>
      <div className="adash-feed-label">{label}</div>
      <div className="adash-feed-val" style={color ? { color } : {}}>{value}</div>
    </div>
  );
}

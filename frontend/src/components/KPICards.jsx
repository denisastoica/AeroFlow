import React, { useEffect, useState } from "react";
import api from "../services/api";
import { 
  Plane, CheckCircle2, Package, CheckCircle, 
  AlertTriangle, Clock, AlertCircle 
} from "lucide-react";
import { useAuth } from "../context/AuthContext";

const KPI_LIST = [
  { key: "active_drones", label: "Active Drones", color: "#6ae4ff", icon: <Plane size={20} /> },
  { key: "available_drones", label: "Available Drones", color: "#2563eb", icon: <CheckCircle2 size={20} /> },
  { key: "active_deliveries", label: "Active Deliveries", color: "#ffd166", icon: <Package size={20} /> },
  { key: "completed_today", label: "Delivered Today", color: "#33d69f", icon: <CheckCircle size={20} /> },
  { key: "failed_deliveries", label: "Failed Deliveries", color: "#ff4d6d", icon: <AlertTriangle size={20} /> },
  { key: "average_eta", label: "Avg ETA (min)", color: "#a78bfa", icon: <Clock size={20} /> },
  { key: "alerts_active", label: "Unresolved Incidents", color: "#ff9f43", icon: <AlertCircle size={20} /> },
];

export default function KPICards() {
  const { user } = useAuth();
  const [kpi, setKpi] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    async function fetchKPI() {
      setLoading(true);
      try {
        const canFetchAlerts = user?.role === "admin" || user?.role === "dispatcher";
        const tasks = [
          api.get("/drones/"),
          api.get("/deliveries/"),
        ];
        if (canFetchAlerts) {
          tasks.push(api.get("/alerts/summary"));
        }

        const results = await Promise.all(tasks);
        const dronesRes = results[0];
        const deliveriesRes = results[1];
        const alertsRes = canFetchAlerts ? results[2] : null;

        const now = new Date();
        const today = now.toISOString().slice(0, 10);
        
        const dronesList = Array.isArray(dronesRes.data) ? dronesRes.data : [];
        const rawDel = deliveriesRes.data;
        const deliveriesList = Array.isArray(rawDel) ? rawDel : Array.isArray(rawDel?.items) ? rawDel.items : [];
        
        let alertsActive = "-";
        if (alertsRes) {
          alertsActive = alertsRes.data.total_active || 0;
        }

        const activeDrones = dronesList.filter(d => d.status === "in_mission" || d.status === "going_to_charging").length;
        const availableDrones = dronesList.filter(d => d.status === "idle").length;
        const activeDeliveries = deliveriesList.filter(d => ["assigned","picking_up","picked_up","in_transit","in_progress"].includes(d.status)).length;
        const completedToday = deliveriesList.filter(d => d.status === "delivered" && d.completed_at && d.completed_at.startsWith(today)).length;
        const failedDeliveries = deliveriesList.filter(d => d.status === "failed").length;
        
        const etaList = deliveriesList
          .filter(d => d.estimated_duration_h != null && ["assigned","in_transit","in_progress","picking_up","picked_up"].includes(d.status))
          .map(d => d.estimated_duration_h * 60);
        const averageEta = etaList.length ? (etaList.reduce((a,b) => a+b,0)/etaList.length).toFixed(1) : "-";

        if (mounted) setKpi({
          active_drones: activeDrones,
          available_drones: availableDrones,
          active_deliveries: activeDeliveries,
          completed_today: completedToday,
          failed_deliveries: failedDeliveries,
          average_eta: averageEta,
          alerts_active: alertsActive,
        });
      } catch {
        if (mounted) setKpi({});
      } finally {
        setLoading(false);
      }
    }
    fetchKPI();
    return () => { mounted = false; };
  }, []);

  return (
    <div className="kpi-cards-grid">
      {KPI_LIST.map(({ key, label, color, icon }) => (
        <div key={key} className="kpi-card" style={{ borderColor: color }}>
          <div className="kpi-card__icon" style={{ color }}>{icon}</div>
          <div className="kpi-card__value" style={{ color }}>{loading ? "..." : kpi[key] ?? "-"}</div>
          <div className="kpi-card__label">{label}</div>
        </div>
      ))}
    </div>
  );
}

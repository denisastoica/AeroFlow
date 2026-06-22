import React, { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useLocation } from "react-router-dom";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Polyline,
  Circle,
  Polygon,
  ImageOverlay,
  useMap,
  ZoomControl,
} from "react-leaflet";

import "leaflet/dist/leaflet.css";
import api, { radarAPI, weatherAPI } from "../services/api";
import L from "leaflet";
import { useWebSocketMonitor } from "../hooks/useWebSocketMonitor";
import MissionReplayPanel, { MissionReplayOverlay } from "./MissionReplayPanel";
import AlertsPanel from "./AlertsPanel";
import FleetSummary from "./FleetSummary";
import KPICards from "./KPICards";
import DeliveryList from "./DeliveryList";
import DroneDetail from "./DroneDetail";
import ScenarioPanel from "./ScenarioPanel";
import NoFlyZoneManager from "./NoFlyZoneManager";
import ChargingStationManager from "./ChargingStationManager";
import {
  Layers, Shield, LayoutDashboard, ScrollText,
  Settings, Zap, Navigation, MapPin,
  Wind, Cloud, Thermometer, Gauge,
  Activity, AlertTriangle, CheckCircle2,
Trash2, Info, Crosshair, Package, Bell
} from "lucide-react";

import droneIconBlue from "../assets/icons/drone-icon.png";
import droneIconGreen from "../assets/icons/drone-green.png";
import droneIconYellow from "../assets/icons/drone-yellow.png";

function MapAutoResizer() {
  const map = useMap();
  useEffect(() => {
    let isMounted = true;
    const timeout = setTimeout(() => {
      if (isMounted && map) {
        try {
          map.invalidateSize();
        } catch (e) {
                  }
      }
    }, 100);
    return () => {
      isMounted = false;
      clearTimeout(timeout);
    };
  }, [map]);
  return null;
}

function ChangeView({ center, zoom, missionId }) {
  const map = useMap();
  const lastMissionId = useRef(null);

  useEffect(() => {
        if (missionId !== lastMissionId.current) {
      if (center && zoom && map) {
                if (map._container && map._panes) {
          try {
            map.setView(center, zoom, { animate: true });
          } catch (e) {
                        console.warn("[Leaflet] setView failed:", e);
          }
        }
      }
      lastMissionId.current = missionId;
    }
  }, [center, zoom, missionId, map]);
  return null;
}

const RADAR_BOUNDS = [
  [42.007679, 17.972679],
  [49.162879, 31.476679],
];

const getActiveSegment = (routePath, routeIndex, stations) => {
  if (!Array.isArray(routePath) || routePath.length < 2) return [];
  
  const startIdx = Math.max(0, Number(routeIndex || 0));
  if (startIdx >= routePath.length) return [];
  
  const slicedPath = routePath.slice(startIdx);
  
  let endIdx = slicedPath.length;
  for (let i = 1; i < slicedPath.length; i++) {
    const [lat, lon] = slicedPath[i];
    
        const isAtStation = Array.isArray(stations) && stations.some(station => {
      const sLat = station.latitude || station.lat;
      const sLon = station.longitude || station.lon;
      if (sLat == null || sLon == null) return false;
      
      const dLat = lat - sLat;
      const dLon = lon - sLon;
      const dist = Math.sqrt(dLat * dLat + dLon * dLon) * 111.0;
      return dist < 0.1;
    });
    
    if (isAtStation) {
      endIdx = i + 1;
      break;
    }
  }
  
  return slicedPath.slice(0, endIdx);
};

const pickupMarkerIcon = L.divIcon({
  className: "pickup-marker-new",
  html: `
    <div class="marker-container" style="color: #a78bfa;">
      <div class="marker-ripple"></div>
      <div class="marker-pin-head" style="width: 24px; height: 24px; background: linear-gradient(135deg, #a78bfa, #7c5cff);">
        <div class="marker-icon-fixed">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/>
            <path d="m3.3 7 8.7 5 8.7-5"/>
            <path d="M12 22V12"/>
          </svg>
        </div>
      </div>
    </div>`,
  iconSize: [24, 24], iconAnchor: [12, 24], popupAnchor: [0, -24],
});

const destMarkerIcon = L.divIcon({
  className: "dest-marker-new",
  html: `
    <div class="marker-container" style="color: #33d69f;">
      <div class="marker-ripple"></div>
      <div class="marker-pin-head" style="width: 24px; height: 24px; background: linear-gradient(135deg, #33d69f, #16a34a);">
        <div class="marker-icon-fixed">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/>
            <circle cx="12" cy="10" r="3"/>
          </svg>
        </div>
      </div>
    </div>`,
  iconSize: [24, 24], iconAnchor: [12, 24], popupAnchor: [0, -24],
});

const stationIcon = L.divIcon({
  className: "custom-station-icon",
  html: `<div style="width: 24px; height: 24px; background: #f59e0b; border-radius: 50%; border: 2px solid white; display: flex; align-items: center; justify-content: center; font-size: 12px; color: white;"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg></div>`,
  iconSize: [24, 24], iconAnchor: [12, 12]
});

export default function DroneMap({
  deliveryId, highlightRoute, sidebar, singleDrone, missionId,
  replayData: externalReplayData,
  replayShowEvents: externalReplayShowEvents
}) {
  const [drones, setDrones] = useState([]);
  const [recenterVersion, setRecenterVersion] = useState(0);
  const [chargingStations, setChargingStations] = useState([]);
  const [wsConnected, setWsConnected] = useState(false);
  const [noFlyZones, setNoFlyZones] = useState([]);
  const [showNoFlyZones, setShowNoFlyZones] = useState(true);
  const [showStations, setShowStations] = useState(true);
  const [showRoutes, setShowRoutes] = useState(true);
  const [showIdleDrones, setShowIdleDrones] = useState(true);
  const [selectedDroneId, setSelectedDroneId] = useState(null);
  const [radarUrl, setRadarUrl] = useState(null);
  const [showRadar, setShowRadar] = useState(true);
  const [radarOpacity, setRadarOpacity] = useState(0.65);
  const [radarLoading, setRadarLoading] = useState(false);
  const [radarTimestamp, setRadarTimestamp] = useState(null);
  const [radarError, setRadarError] = useState(false);
  const [mapInstance, setMapInstance] = useState(null);
  const [showPickupDest, setShowPickupDest] = useState(true);

  const [warnings, setWarnings] = useState({ general: [], nowcast: [] });
  const [weatherZones, setWeatherZones] = useState([]);
  const [showWeatherZones, setShowWeatherZones] = useState(true);

  const location = useLocation();
  const locationStateProcessed = useRef(false);

  useEffect(() => {
    if (!locationStateProcessed.current && location.state?.selectedDroneId && drones.length > 0) {
      const droneId = location.state.selectedDroneId;
      const d = drones.find(dr => dr.id === droneId);
      if (d) {
        setSelectedDroneId(droneId);
        locationStateProcessed.current = true;
        
                setRecenterVersion(v => v + 1);

                setTimeout(() => {
          setSelectedDroneId(prev => (prev === droneId ? null : prev));
        }, 3000);
      }
    }
  }, [location.state, drones]);

  const [showDeliveries, setShowDeliveries] = useState(false);
  const [showAlertsPanel, setShowAlertsPanel] = useState(false);
  const [internalReplayData, setInternalReplayData] = useState(null);
  const [internalReplayShowEvents, setInternalReplayShowEvents] = useState(true);
  const [detailDrone, setDetailDrone] = useState(null);

  const replayData = externalReplayData !== undefined ? externalReplayData : internalReplayData;
  const replayShowEvents = externalReplayShowEvents !== undefined ? externalReplayShowEvents : internalReplayShowEvents;

  const handleReplayChange = useCallback((data, showEv) => {
    setInternalReplayData(data);
    setInternalReplayShowEvents(showEv);
  }, []);

  const handleWeatherUpdate = useCallback((zones) => {
    setWeatherZones(zones || []);
  }, []);

  const fleetStats = useMemo(() => {
    const count = drones.length;
    const active = drones.filter(d => d.status === 'in_mission' || d.status === 'going_to_charging').length;
    const avgBatt = count > 0 ? Math.round(drones.reduce((acc, d) => acc + (d.battery ?? 100), 0) / count) : 0;
    const inMission = drones.filter(d => d.status === "in_mission").length;
    const charging = drones.filter(d => d.status === "charging" || d.status === "going_to_charging").length;
    return { count, active, avgBatt, inMission, charging };
  }, [drones]);

  const nfzByCategory = useMemo(() => {
    const cats = { airport: [], military: [], nuclear: [], government: [], other: [] };
    noFlyZones.forEach(nfz => {
      const name = (nfz.name + " " + (nfz.reason || "")).toLowerCase();
      if (name.includes("aeroport") || name.includes("airport")) cats.airport.push(nfz);
      else if (name.includes("militar") || name.includes("nato") || name.includes("baz")) cats.military.push(nfz);
      else if (name.includes("nuclear") || name.includes("centrala")) cats.nuclear.push(nfz);
      else if (name.includes("palat") || name.includes("palace") || name.includes("parlament") || name.includes("parliament") || name.includes("cotroceni") || name.includes("guvern")) cats.government.push(nfz);
      else cats.other.push(nfz);
    });
    return cats;
  }, [noFlyZones]);

  const fetchDrones = async () => {
    try {
      const response = await api.get("/drones/");
      setDrones(response.data);
    } catch (error) {
      console.error("Error fetching drones:", error);
    }
  };

  const handleDroneUpdate = useCallback((update) => {
    setDrones((prevDrones) => {
      const droneIndex = prevDrones.findIndex(
        (d) => d.id === update.drone_id || d.drone_id === update.drone_id
      );
      if (droneIndex !== -1) {
        const updatedDrones = [...prevDrones];
        updatedDrones[droneIndex] = { ...updatedDrones[droneIndex], ...update, id: update.drone_id };
        return updatedDrones;
      } else {
        return [...prevDrones, { ...update, id: update.drone_id }];
      }
    });
  }, []);

  const handleDroneWeatherUpdate = useCallback((data) => {
    setDrones((prevDrones) => {
      const droneIndex = prevDrones.findIndex(
        (d) => d.id === data.drone_id || d.drone_id === data.drone_id
      );
      if (droneIndex === -1) return prevDrones;
      const updatedDrones = [...prevDrones];
      updatedDrones[droneIndex] = { ...updatedDrones[droneIndex], weather: data.weather };
      return updatedDrones;
    });
  }, []);

  const handleFleetUpdate = useCallback((data) => {
    if (data.reset_fleet) {
      api.get("/no-fly-zones/").then(r => setNoFlyZones(Array.isArray(r.data) ? r.data : [])).catch(() => { });
      api.get("/drones/").then(r => setDrones(r.data)).catch(() => { });
    }
  }, []);

  const { isConnected: wsIsConnected, error: wsError } = useWebSocketMonitor(
    handleDroneUpdate,
    handleWeatherUpdate,
    handleDroneWeatherUpdate,
    handleFleetUpdate
  );

  useEffect(() => {
    setWsConnected(wsIsConnected);
  }, [wsIsConnected, wsError]);

  useEffect(() => {
    if (selectedDroneId) {
      const d = drones.find(dr => dr.id === selectedDroneId);
      if (d && d.latitude && d.longitude) {
        setRecenterVersion(v => v + 1);
      }
    }
  }, [selectedDroneId]);

  useEffect(() => {
    fetchDrones();
                    const interval = setInterval(fetchDrones, 30000);
    return () => clearInterval(interval);
  }, [wsConnected]);

  const fetchRadar = useCallback(async () => {
    setRadarLoading(true);
    setRadarError(false);
    try {
      const resp = await radarAPI.getList();
      const latestObj = resp.data?.latest;

      if (latestObj && latestObj.poza) {
        const parts = latestObj.poza.split("/");
        const latestFileName = parts[parts.length - 1].split("?")[0];
        const imgUrl = radarAPI.getImageUrl(latestFileName);
        setRadarUrl(`${imgUrl}?_t=${Date.now()}`);
        setRadarError(false);

        if (latestObj.timp) {
          setRadarTimestamp(latestObj.timp);
        } else {
          const m = latestFileName.match(/mos\.live\.(\d{4})(\d{2})(\d{2})\.(\d{2})(\d{2})/);
          if (m) {
            const frameDate = new Date(Date.UTC(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10), parseInt(m[4], 10), parseInt(m[5], 10)));
            setRadarTimestamp(`${frameDate.toLocaleDateString()} ora ${frameDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
          }
        }
      } else {
        setRadarUrl(null);
        setRadarTimestamp(null);
        setRadarError(true);
      }
    } catch (e) {
      console.warn("[Radar] fetch failed:", e);
      setRadarUrl(null);
      setRadarTimestamp(null);
      setRadarError(true);
    } finally {
      setRadarLoading(false);
    }
  }, []);

  const fetchWarnings = useCallback(async () => {
    try {
      const resp = await weatherAPI.getWarnings();
      setWarnings(resp.data || { general: [], nowcast: [] });
    } catch (e) {
      console.warn("[Weather Warnings] fetch failed:", e);
    }
  }, []);

  const fetchWeatherZones = useCallback(async () => {
    try {
      const resp = await weatherAPI.getCurrent();
      setWeatherZones(resp.data?.zones || []);
    } catch (e) {
      console.warn("[Weather Zones] fetch failed:", e);
    }
  }, []);

  useEffect(() => {
    api.get("/charging/stations").then(r => setChargingStations(r.data?.stations ?? r.data ?? [])).catch(() => { });
    api.get("/no-fly-zones/").then(r => setNoFlyZones(Array.isArray(r.data) ? r.data : [])).catch(() => { });
    fetchRadar();
    fetchWarnings();
    fetchWeatherZones();
    const radarInterval = setInterval(() => {
      fetchRadar();
      fetchWarnings();
      fetchWeatherZones();
    }, 10 * 60 * 1000);
    return () => clearInterval(radarInterval);
  }, [fetchRadar, fetchWarnings, fetchWeatherZones]);

  const nfzColors = (nfz) => {
    const name = (nfz.name + " " + (nfz.reason || "")).toLowerCase();
    if (name.includes("nuclear")) return { fill: "#7c3aed", stroke: "#c4b5fd" };
    if (name.includes("militar") || name.includes("nato") || name.includes("baz") || name.includes("radar")) return { fill: "#b91c1c", stroke: "#fca5a5" };
    if (name.includes("palat") || name.includes("parlament") || name.includes("cotroceni")) return { fill: "#0369a1", stroke: "#7dd3fc" };
    if (nfz.zone_type === "temporary") return { fill: "#ea580c", stroke: "#fdba74" };
    return { fill: "#991b1b", stroke: "#fca5a5" };
  };

  const ACTIVE_STATUSES = ["in_mission", "going_to_charging", "charging"];
  const activeDrones = drones.filter(d => ACTIVE_STATUSES.includes(d.status));
  const visibleDrones = showIdleDrones ? drones : activeDrones;

    const liveSingleDrone = useMemo(() => {
    if (!singleDrone) return null;
        const live = drones.find(d => d.id === singleDrone.id);

            if (live) {
      return {
        ...singleDrone,
        latitude: live.latitude ?? singleDrone.latitude,
        longitude: live.longitude ?? singleDrone.longitude,
        battery: live.battery ?? singleDrone.battery,
        speed: live.speed ?? singleDrone.speed ?? 0,
        status: live.status ?? singleDrone.status,
        route_index: live.route_index ?? singleDrone.route_index,
        route_path: live.route_path || singleDrone.route_path,
        planned_route_path: singleDrone.planned_route_path || live.planned_route_path,
        pickup_lat: singleDrone.pickup_lat ?? live.pickup_lat,
        pickup_lon: singleDrone.pickup_lon ?? live.pickup_lon,
        dest_lat: singleDrone.dest_lat ?? live.dest_lat,
        dest_lon: singleDrone.dest_lon ?? live.dest_lon,
      };
    }
    return singleDrone;
  }, [singleDrone, drones]);

  let dronesToShow = visibleDrones;
  let mapCenter = [46.7712, 23.6236];
  let zoom = 7;

  if (liveSingleDrone) {
    dronesToShow = [liveSingleDrone];
    if (liveSingleDrone.latitude && liveSingleDrone.longitude) {
      mapCenter = [liveSingleDrone.latitude, liveSingleDrone.longitude];
      zoom = 13;
    }
  }

  const [activePanel, setActivePanel] = useState(null);
  const togglePanel = (panel) => setActivePanel(activePanel === panel ? null : panel);

  return (
    <div className="map-view-fullscreen">
      <main className="map-main-fullscreen">
        <MapContainer
          ref={setMapInstance}
          center={mapCenter}
          zoom={zoom}
          className="map-leaflet-fullscreen"
          style={{ height: "calc(100vh - 64px)", width: "100%" }}
          zoomControl={false}
        >
          <ChangeView center={mapCenter} zoom={zoom} missionId={missionId} />
          <ZoomControl position="bottomright" />
          <MapAutoResizer />
          <TileLayer attribution='Imagery &copy; Esri' url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" maxNativeZoom={19} />
          <TileLayer attribution="" url="https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}" maxNativeZoom={19} opacity={0.42} />
          {!singleDrone && <FitBounds drones={activeDrones.length > 0 ? activeDrones : drones} recenterVersion={recenterVersion} selectedDroneId={selectedDroneId} />}

                    {replayData && (
            <MissionReplayOverlay
              replayData={replayData}
              showEvents={replayShowEvents}
            />
          )}

          {showRoutes && dronesToShow.map((drone) => {
            if (drone.status === 'idle') return null;
            const isSelected = (selectedDroneId === drone.id) || (liveSingleDrone && drone.id === liveSingleDrone.id);

            return (
              <React.Fragment key={`route-group-${drone.id}`}>
                                {isSelected && drone.status !== 'going_to_charging' && Array.isArray(drone.planned_route_path) && drone.planned_route_path.length >= 2 && (() => {
                  const activePlannedSegment = getActiveSegment(drone.planned_route_path, drone.route_index, chargingStations);
                  if (activePlannedSegment.length < 2) return null;
                  return (
                    <Polyline
                      positions={activePlannedSegment.map(p => [p[0], p[1]])}
                      pathOptions={{
                        color: isSelected ? 'rgba(255, 255, 255, 0.8)' : 'rgba(255, 255, 255, 0.45)',
                        weight: 4,
                        dashArray: '10, 15',
                        interactive: false
                      }}
                    />
                  );
                })()}

                                {Array.isArray(drone.route_path) && drone.route_path.length >= 2 && (() => {
                  const activeSegment = getActiveSegment(drone.route_path, drone.route_index, chargingStations);
                  if (activeSegment.length < 2) return null;
                  const path = activeSegment.map(p => [p[0], p[1]]);
                  return (
                    <>
                      {isSelected && (
                        <Polyline
                          positions={path}
                          pathOptions={{ color: STATUS_RING[drone.status], weight: 14, opacity: 0.15, lineCap: 'round' }}
                        />
                      )}
                      <Polyline
                        positions={path}
                        pathOptions={{
                          color: isSelected ? (STATUS_RING[drone.status] || '#6ae4ff') : 'rgba(255, 255, 255, 0.55)',
                          weight: isSelected ? 7 : 5,
                          opacity: isSelected ? 0.85 : 0.55,
                          dashArray: "8, 12",
                          lineCap: "round"
                        }}
                      />
                    </>
                  );
                })()}
              </React.Fragment>
            );
          })}

          {showNoFlyZones && noFlyZones.filter(nfz => nfz.center_lat != null && nfz.center_lon != null).map((nfz) => {
            const colors = nfzColors(nfz);
            return (
              <Circle key={nfz.id} center={[nfz.center_lat, nfz.center_lon]} radius={(nfz.radius_km || 1) * 1000} pathOptions={{ color: colors.stroke, fillColor: colors.fill, fillOpacity: 0.25, weight: 2 }}>
                <Popup>
                  <div style={{ padding: '4px' }}>
                    <b style={{ color: colors.stroke, fontSize: '1rem', display: 'flex', alignItems: 'center', gap: 8 }}><Shield size={16} /> Restricted Zone</b><br />
                    <div style={{ marginTop: '8px', fontWeight: 600 }}>{nfz.name}</div>
                    <div style={{ fontSize: '0.85rem', opacity: 0.8 }}>{nfz.reason}</div>
                  </div>
                </Popup>
              </Circle>
            );
          })}

          {showStations && chargingStations.filter(st => st.lat != null && st.lon != null).map((st, i) => (
            <Marker key={`st-${st.id || i}`} position={[st.lat, st.lon]} icon={stationIcon} zIndexOffset={100} opacity={st.active === false ? 0.4 : 1}>
              <Popup>
                <div className="map-popup">
                  <div className="map-popup__title" style={{ display: 'flex', alignItems: 'center', gap: 8, color: st.active === false ? 'var(--text-muted)' : 'inherit' }}><Zap size={14} fill={st.active !== false ? "#eab308" : "none"} color={st.active === false ? "var(--text-muted)" : "#eab308"} /> {st.name}</div>
                  {st.active === false ? (
                     <div className="map-popup__status" style={{color: 'var(--danger)'}}>Inactive / Disabled</div>
                  ) : (
                     <div className="map-popup__status">Capacity: {st.current_drones || 0}/{st.capacity || 4} drones</div>
                  )}
                </div>
              </Popup>
            </Marker>
          ))}

          {showWeatherZones && weatherZones.filter(wz => wz.severity > 1 || !wz.can_fly).map((wz, i) => {
            const isStorm = wz.condition === 'storm' || !wz.can_fly;
            const color = isStorm ? '#dc2626' : '#f59e0b';
            const fillColor = isStorm ? '#ef4444' : '#fbbf24';
            return (
              <Circle key={`wz-${i}`} center={[wz.center_lat, wz.center_lon]} radius={(wz.radius_km || 40) * 1000} pathOptions={{ color, fillColor, fillOpacity: 0.15, weight: 2, dashArray: '5,5' }}>
                <Popup className="weather-popup">
                  <div style={{ padding: '2px' }}>
                    <b style={{ color, fontSize: '1.05rem', display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 8px 0' }}><Cloud size={16} /> Severe Weather: {wz.name}</b>
                    <div style={{ fontWeight: 600, color: 'rgba(255, 255, 255, 0.9)' }}>{wz.condition_label} ({wz.temperature}°C)</div>
                    <div style={{ fontSize: '0.85rem', color: 'rgba(255, 255, 255, 0.6)' }}>Wind: {wz.wind_speed} km/h</div>
                    {wz.warning && <div style={{ color: '#ff4d6d', fontSize: '0.85rem', marginTop: '8px', fontWeight: 'bold' }}>⚠ {wz.warning}</div>}
                  </div>
                </Popup>
              </Circle>
            );
          })}

          {showPickupDest && dronesToShow.map((drone) => {
            if (!drone.pickup_lat || !drone.pickup_lon || drone.status === 'idle') return null;
            const isSelected = (selectedDroneId === drone.id) || (liveSingleDrone && drone.id === liveSingleDrone.id);

            return (
              <React.Fragment key={`del-markers-${drone.id}`}>
                                <Marker position={[drone.pickup_lat, drone.pickup_lon]} icon={pickupMarkerIcon} zIndexOffset={500}>
                  <Popup><b>Pickup Point</b><br />Drone: {drone.name}</Popup>
                </Marker>

                                {drone.dest_lat && drone.dest_lon && (
                  <Marker position={[drone.dest_lat, drone.dest_lon]} icon={destMarkerIcon} zIndexOffset={500}>
                    <Popup><b>Destination</b><br />Drone: {drone.name}</Popup>
                  </Marker>
                )}

                                {isSelected && drone.target_lat && drone.target_lon && drone.current_target_type === 'charging' && (
                  <>
                    <Marker position={[drone.target_lat, drone.target_lon]} icon={stationIcon} zIndexOffset={600}>
                      <Popup>
                        <div style={{ textAlign: 'center' }}>
                          <b style={{ color: '#f59e0b' }}>ACTIVE DETOUR</b><br />
                          {drone.current_target_name}
                        </div>
                      </Popup>
                    </Marker>
                    <Circle
                      center={[drone.target_lat, drone.target_lon]}
                      radius={150}
                      pathOptions={{ color: '#f59e0b', weight: 2, dashArray: '5, 5', fillOpacity: 0.1 }}
                    />
                  </>
                )}
              </React.Fragment>
            );
          })}

          {showRadar && radarUrl && (
            <ImageOverlay
              url={radarUrl}
              bounds={RADAR_BOUNDS}
              opacity={radarOpacity}
              zIndex={400}
              crossOrigin="anonymous"
            />
          )}

          {dronesToShow.map((drone) => {
            if (!drone.latitude || !drone.longitude) return null;
            return (
              <DroneMarker key={drone.id} drone={drone} isSelected={(selectedDroneId === drone.id) || (liveSingleDrone && drone.id === liveSingleDrone.id)} onSelect={setSelectedDroneId} onDetail={setDetailDrone} />
            );
          })}
        </MapContainer>

        
        <div className="map-overlay-tl">
          <div className="map-floating-group" style={{ zIndex: activePanel === 'layers' ? 50 : 1 }}>
            <button className={`map-fab ${activePanel === 'layers' ? 'active' : ''}`} onClick={() => togglePanel('layers')}><Layers size={18} /></button>
            {activePanel === 'layers' && (
              <MapFloatingPanel className="map-popover">
                <div className="popover-head">Map Layers</div>
                <div className="popover-body" style={{ width: '280px', padding: '12px' }}>
                  <div className="map-layer-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                    <button className={`layer-btn ${showStations ? 'active' : ''}`} onClick={() => setShowStations(!showStations)}>⚡ Stations</button>
                    <button className={`layer-btn ${showRoutes ? 'active' : ''}`} onClick={() => setShowRoutes(!showRoutes)}>🛤 Routes</button>
                    <button className={`layer-btn ${showRadar ? 'active' : ''}`} onClick={() => setShowRadar(!showRadar)}>🌧 Radar</button>
                    <button className={`layer-btn ${showWeatherZones ? 'active' : ''}`} onClick={() => setShowWeatherZones(!showWeatherZones)}>⛈ Weather Zones</button>
                    <button className={`layer-btn ${showPickupDest ? 'active' : ''}`} onClick={() => setShowPickupDest(!showPickupDest)}>📍 Delivery Points</button>
                    <button className={`layer-btn ${showIdleDrones ? 'active' : ''}`} onClick={() => setShowIdleDrones(!showIdleDrones)} title={`${drones.length - activeDrones.length} idle drones hidden`}>🛸 Idle Drones</button>
                    <button className="layer-btn layer-btn--action" onClick={() => setRecenterVersion(v => v + 1)}>🎯 Recenter</button>
                  </div>
                  {showRadar && (
                    <div style={{ marginTop: '12px', padding: '0 2px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                        <span style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)', letterSpacing: '0.05em' }}>Radar Opacity</span>
                        <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--primary)' }}>{Math.round(radarOpacity * 100)}%</span>
                      </div>
                      <input type="range" min="10" max="100" value={Math.round(radarOpacity * 100)} onChange={e => setRadarOpacity(Number(e.target.value) / 100)}
                        style={{ width: '100%', accentColor: 'var(--primary)', cursor: 'pointer' }} />
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px' }}>
                        <span style={{ fontSize: '10px', color: radarError && !radarUrl ? '#fca5a5' : 'var(--muted)', opacity: 0.9 }}>
                          {radarLoading ? '⏳ Loading...' : radarError && !radarUrl ? '⚠ Indisponibil' : radarTimestamp ? `🕐 ${radarTimestamp}` : '—'}
                        </span>
                        <button onClick={() => { setRadarError(false); fetchRadar(); }} disabled={radarLoading}
                          style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '4px', background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.3)', color: 'var(--primary)', cursor: 'pointer', opacity: radarLoading ? 0.5 : 1 }}>
                          ↺ Refresh
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </MapFloatingPanel>
            )}
          </div>
          <div className="map-floating-group" style={{ zIndex: activePanel === 'zones' ? 50 : 1 }}>
            <button className={`map-fab ${activePanel === 'zones' ? 'active' : ''}`} onClick={() => togglePanel('zones')}><Shield size={18} /></button>
            {activePanel === 'zones' && (
              <MapFloatingPanel className="map-popover">
                <div className="popover-head">Restricted Zones</div>
                <div className="popover-body" style={{ width: '280px', padding: '12px' }}>
                  <NoFlyZoneManager 
                    zones={noFlyZones} 
                    onRefresh={() => {
                      api.get("/no-fly-zones/").then(r => setNoFlyZones(Array.isArray(r.data) ? r.data : [])).catch(() => { });
                    }}
                    showOverlay={showNoFlyZones}
                    onToggleOverlay={setShowNoFlyZones}
                    mapInstance={mapInstance}
                  />
                </div>
              </MapFloatingPanel>
            )}
          </div>
          <div className="map-floating-group" style={{ zIndex: activePanel === 'charging' ? 50 : 1 }}>
            <button className={`map-fab ${activePanel === 'charging' ? 'active' : ''}`} onClick={() => togglePanel('charging')}><Zap size={18} /></button>
            {activePanel === 'charging' && (
              <MapFloatingPanel className="map-popover">
                <div className="popover-head">Charging Stations</div>
                <div className="popover-body" style={{ width: '280px', padding: '12px' }}>
                  <ChargingStationManager 
                    stations={chargingStations} 
                    onRefresh={() => {
                      api.get("/charging/stations").then(r => setChargingStations(r.data?.stations ?? r.data ?? [])).catch(() => { });
                    }}
                    showOverlay={showStations}
                    onToggleOverlay={setShowStations}
                    mapInstance={mapInstance}
                  />
                </div>
              </MapFloatingPanel>
            )}
          </div>
        </div>

        <div className="map-overlay-tr">
                    {(warnings.nowcast?.length > 0 || warnings.general?.some(w => w.culoare === 'Rosu' || w.culoare === 'Portocaliu')) && (
            <div style={{
              background: "rgba(214, 40, 40, 0.9)",
              backdropFilter: "blur(8px)",
              color: "white",
              padding: "10px 16px",
              borderRadius: "12px",
              display: "flex",
              alignItems: "center",
              gap: 12,
              marginBottom: 10,
              boxShadow: "0 8px 32px rgba(214, 40, 40, 0.4)",
              border: "1px solid rgba(255,255,255,0.2)",
              pointerEvents: "auto",
              cursor: "pointer",
              animation: "pulse 2s infinite"
            }} onClick={() => document.querySelector('.icon-btn')?.click() }>
              <AlertTriangle size={24} color="#ffb703" />
              <div>
                <div style={{ fontWeight: 800, fontSize: 13, letterSpacing: "0.05em" }}>SEVERE WEATHER WARNING</div>
                <div style={{ fontSize: 12, opacity: 0.9 }}>
                  {warnings.nowcast?.length > 0 ? `${warnings.nowcast.length} Active Nowcasts` : `${warnings.general.filter(w => w.culoare === 'Rosu' || w.culoare === 'Portocaliu').length} Active Major Warnings`}
                </div>
              </div>
            </div>
          )}

          <div className="map-floating-group" style={{ zIndex: activePanel === 'fleet' ? 50 : 1 }}>
            <button className={`map-fab ${activePanel === 'fleet' ? 'active' : ''}`} onClick={() => togglePanel('fleet')}><Activity size={18} /></button>
            {activePanel === 'fleet' && (
              <MapFloatingPanel className="map-popover map-popover--right">
                <div className="popover-head">Fleet Monitoring</div>
                <div className="popover-body map-drone-list-scroll-compact" style={{ maxHeight: '400px', width: '280px' }}>
                  {drones.map(drone => (
                    <div key={drone.id} className={`drone-item-mini ${selectedDroneId === drone.id ? 'active' : ''}`} onClick={() => setSelectedDroneId(selectedDroneId === drone.id ? null : drone.id)}>
                      <div className="drone-status-dot" style={{ background: STATUS_RING[drone.status] || '#6b7280', borderRadius: '50%', width: '8px', height: '8px' }} />
                      <div className="drone-info"><div className="name">{drone.name}</div><div className="status">{drone.status}</div></div>
                      <div className="drone-batt">{drone.battery?.toFixed(0)}%</div>
                    </div>
                  ))}
                </div>
              </MapFloatingPanel>
            )}
          </div>
        </div>

        <div className="map-overlay-bl">
          <div className="map-floating-group"><button className={`map-fab ${activePanel === 'legend' ? 'active' : ''}`} onClick={() => togglePanel('legend')}><ScrollText size={18} /></button>
            {activePanel === 'legend' && (
              <MapFloatingPanel className="map-popover map-popover--up">
                <div className="popover-head">Map Legend</div>
                <div className="popover-body" style={{ width: '240px', maxHeight: '420px', overflowY: 'auto' }}>
                  <div className="legend-section"><div style={{ fontSize: '10px', textTransform: 'uppercase', color: 'var(--muted2)', marginBottom: '10px', fontWeight: 800 }}>Fleet Status</div>
                    <div style={{ display: 'grid', gap: '8px' }}>
                      <div className="nfz-mini-row"><span className="dot" style={{ background: STATUS_RING.idle }}></span><span style={{ fontSize: '12px' }}>Dark — Available / Idle</span></div>
                      <div className="nfz-mini-row"><span className="dot" style={{ background: STATUS_RING.in_mission }}></span><span style={{ fontSize: '12px' }}>Green — In Mission</span></div>
                      <div className="nfz-mini-row"><span className="dot" style={{ background: STATUS_RING.going_to_charging }}></span><span style={{ fontSize: '12px' }}>Green — Going to Charge</span></div>
                      <div className="nfz-mini-row"><span className="dot" style={{ background: STATUS_RING.charging }}></span><span style={{ fontSize: '12px' }}>Yellow — Charging</span></div>
                      <div className="nfz-mini-row"><span className="dot" style={{ background: STATUS_RING.maintenance }}></span><span style={{ fontSize: '12px' }}>Red — Maintenance (auto-recovers)</span></div>
                      <div className="nfz-mini-row"><span className="dot" style={{ background: STATUS_RING.inactive }}></span><span style={{ fontSize: '12px' }}>Grey — Inactive / Disabled</span></div>
                    </div>
                  </div>
                </div>
              </MapFloatingPanel>
            )}
          </div>
        </div>
        <div className="map-overlay-br" style={{ right: '60px', bottom: '40px' }}>
          <div className="map-floating-group">
            <button className={`map-fab ${showAlertsPanel ? 'active' : ''}`} onClick={() => setShowAlertsPanel(true)} title="System Alerts">
              <Bell size={18} />
            </button>
          </div>
        </div>
      </main>

      {showAlertsPanel && <AlertsPanel onClose={() => setShowAlertsPanel(false)} />}

      {detailDrone && <div className="delivery-detail-modal-bg"><DroneDetail drone={detailDrone} onClose={() => setDetailDrone(null)} /></div>}
    </div>
  );
}

const STATUS_RING = { idle: "#111827", in_mission: "#33d69f", charging: "#ffd166", going_to_charging: "#33d69f", maintenance: "#ff4d6d", inactive: "#6b7280" };

function calculateHeading(drone) {
  if (!drone.route_path || !Array.isArray(drone.route_path) || drone.route_path.length < 2) return 0;
  const idx = drone.route_index || 0;
  if (idx >= drone.route_path.length - 1) return 0;

  const nextPoint = drone.route_path[idx + 1];
  const currLat = drone.latitude;
  const currLon = drone.longitude;

  const dy = nextPoint[0] - currLat;
  const dx = Math.cos(Math.PI / 180 * currLat) * (nextPoint[1] - currLon);
  const angle = Math.atan2(dx, dy) * (180 / Math.PI);
  return angle;
}

function DroneMarker({ drone, isSelected, onSelect, onDetail }) {
  const markerRef = React.useRef(null);
  const initialPosRef = React.useRef([drone.latitude, drone.longitude]);
  const animRef = React.useRef(null);

                                  const segmentsRef  = React.useRef([]);
  const toPosRef     = React.useRef([drone.latitude, drone.longitude]);
  const velRef       = React.useRef([0, 0]);
  const tickStartRef = React.useRef(null);
  const tickDurRef   = React.useRef(500);
  const prevTsRef    = React.useRef(null);
  const isFirstUpdate = React.useRef(true);
  const TICK_MS = 500;
  const MAX_EXTRAP_MS = 0;
  const SNAP_THRESHOLD_KM = 15.0;

  const segKm = (a, b) => {
    const dLat = (b[0] - a[0]) * 111.32;
    const dLon = (b[1] - a[1]) * 111.32 * Math.cos(a[0] * Math.PI / 180);
    return Math.sqrt(dLat * dLat + dLon * dLon);
  };

  const getDisplayPos = (now) => {
    const segs = segmentsRef.current;
    if (!tickStartRef.current || segs.length === 0) return toPosRef.current.slice();
    const elapsed = now - tickStartRef.current;
    const tickDur = tickDurRef.current;
    if (elapsed <= tickDur) {
      const t = elapsed / tickDur;
      for (let i = 0; i < segs.length; i++) {
        if (t <= segs[i].endFrac || i === segs.length - 1) {
          const { from, to, startFrac, endFrac } = segs[i];
          const span = endFrac - startFrac;
          const segT = span > 1e-9 ? Math.min(1, (t - startFrac) / span) : 1;
          return [
            from[0] + (to[0] - from[0]) * segT,
            from[1] + (to[1] - from[1]) * segT,
          ];
        }
      }
      return toPosRef.current.slice();
    }
        const extraMs = Math.min(elapsed - tickDur, MAX_EXTRAP_MS);
    return [
      toPosRef.current[0] + velRef.current[0] * extraMs,
      toPosRef.current[1] + velRef.current[1] * extraMs,
    ];
  };

    React.useEffect(() => {
    const animate = (ts) => {
      if (tickStartRef.current !== null) {
        const [lat, lon] = getDisplayPos(ts);
        try { markerRef.current?.setLatLng([lat, lon]); } catch (_) {}
      }
      animRef.current = requestAnimationFrame(animate);
    };
    animRef.current = requestAnimationFrame(animate);
    return () => { if (animRef.current) { cancelAnimationFrame(animRef.current); animRef.current = null; } };
  }, []);

    React.useEffect(() => {
    if (!drone.latitude || !drone.longitude) return;
    const now = performance.now();
    const tLat = drone.latitude, tLon = drone.longitude;
        const dynamicDurMs = TICK_MS;
    prevTsRef.current = now;

        const curPos = getDisplayPos(now);
    if (isFirstUpdate.current || segKm(curPos, [tLat, tLon]) > SNAP_THRESHOLD_KM) {
      isFirstUpdate.current = false;
      segmentsRef.current  = [{ from: [tLat, tLon], to: [tLat, tLon], startFrac: 0, endFrac: 1 }];
      toPosRef.current     = [tLat, tLon];
      velRef.current       = [0, 0];
      tickDurRef.current   = dynamicDurMs;
      tickStartRef.current = now;
      try { markerRef.current?.setLatLng([tLat, tLon]); } catch (_) {}
      return;
    }

        const isMoving = drone.status === 'in_mission' || drone.status === 'going_to_charging';
    if (!isMoving) {
      segmentsRef.current  = [{ from: [tLat, tLon], to: [tLat, tLon], startFrac: 0, endFrac: 1 }];
      toPosRef.current     = [tLat, tLon];
      velRef.current       = [0, 0];
      tickDurRef.current   = dynamicDurMs;
      tickStartRef.current = now;
      try { markerRef.current?.setLatLng([tLat, tLon]); } catch (_) {}
      return;
    }

    const pathSeg = drone.path_segment;
    if (pathSeg && pathSeg.length >= 2) {
                                    try { markerRef.current?.setLatLng(pathSeg[0]); } catch (_) {}

      const kms = [];
      let totalKm = 0;
      for (let i = 0; i < pathSeg.length - 1; i++) {
        const k = segKm(pathSeg[i], pathSeg[i + 1]);
        kms.push(k);
        totalKm += k;
      }
      if (totalKm < 1e-6) {
                segmentsRef.current  = [{ from: [tLat, tLon], to: [tLat, tLon], startFrac: 0, endFrac: 1 }];
        toPosRef.current     = [tLat, tLon];
        velRef.current       = [0, 0];
        tickDurRef.current   = dynamicDurMs;
        tickStartRef.current = now;
        return;
      }
      const segs = [];
      let frac = 0;
      for (let i = 0; i < pathSeg.length - 1; i++) {
        const segFrac = kms[i] / totalKm;
        const from = pathSeg[i].slice();
        const to   = pathSeg[i + 1].slice();
        segs.push({ from, to, startFrac: frac, endFrac: frac + segFrac });
        frac += segFrac;
      }
            const lastSeg   = segs[segs.length - 1];
      const lastDurMs = (kms[kms.length - 1] / totalKm) * dynamicDurMs;
      velRef.current = [
        (lastSeg.to[0] - lastSeg.from[0]) / Math.max(lastDurMs, 1),
        (lastSeg.to[1] - lastSeg.from[1]) / Math.max(lastDurMs, 1),
      ];
      segmentsRef.current  = segs;
      toPosRef.current     = [tLat, tLon];
      tickDurRef.current   = dynamicDurMs;
      tickStartRef.current = now;
    } else {
            segmentsRef.current  = [{ from: curPos, to: [tLat, tLon], startFrac: 0, endFrac: 1 }];
      toPosRef.current     = [tLat, tLon];
      velRef.current       = [(tLat - curPos[0]) / dynamicDurMs, (tLon - curPos[1]) / dynamicDurMs];
      tickDurRef.current   = dynamicDurMs;
      tickStartRef.current = now;
    }
  }, [drone.latitude, drone.longitude, drone.status, drone.path_segment]);

  const icon = React.useMemo(() => {
    return L.divIcon({
      html: `
        <div class="drone-marker-wrapper">
          <div class="radar-ping" style="display: none;"></div>
          <img 
            src="${droneIconBlue}" 
            style="width: 34px; height: 34px;" 
            class="custom-drone-icon"
          />
        </div>
      `,
      className: 'drone-div-icon',
      iconSize: [34, 34],
      iconAnchor: [17, 17],
      popupAnchor: [0, -20],
    });
  }, []);

  React.useEffect(() => {
    if (markerRef.current) {
      const element = markerRef.current.getElement();
      if (element) {
        const img = element.querySelector('img.custom-drone-icon');
        const radar = element.querySelector('.radar-ping');
        if (img) {
          const heading = calculateHeading(drone);
          img.style.transform = `rotate(${heading}deg)`;

          let iconUrl = droneIconBlue;
                              let cssFilter = '';

          if (drone.status === 'in_mission' || drone.status === 'going_to_charging') {
            iconUrl = droneIconGreen;
          } else if (drone.status === 'charging') {
            iconUrl = droneIconYellow;
          } else if (drone.status === 'maintenance') {
                        iconUrl = droneIconGreen;
            cssFilter = 'hue-rotate(-120deg) saturate(2)';
          } else if (drone.status === 'idle') {
            iconUrl = droneIconBlue;
                        cssFilter = 'brightness(0.55) saturate(0)';
          } else if (drone.status === 'inactive') {
            iconUrl = droneIconBlue;
                        cssFilter = 'saturate(0) brightness(0.8)';
          }

                    img.style.opacity = drone.status === 'inactive' ? '0.5' : '1';
          
                    const targetSrc = iconUrl;
          if (!img.src.endsWith(targetSrc) && !img.src.includes(targetSrc)) {
            img.src = targetSrc;
          }
          img.style.filter = cssFilter;

          if (isSelected) {
            img.classList.add('selected');
            if (radar) radar.style.display = 'block';
          } else {
            img.classList.remove('selected');
            if (radar) radar.style.display = 'none';
          }
        }
      }
    }
  }, [drone.status, drone.latitude, drone.longitude, drone.route_index, isSelected]);

  return (
    <Marker ref={markerRef} position={initialPosRef.current} icon={icon} zIndexOffset={1000}>
      <Popup closeButton={false}>
        <div className="drone-popup">
          <div className="popup-header">
            <div className="drone-title">{drone.name} <span className="drone-id">DR-{drone.id}</span></div>
          </div>
          <div className="popup-status-bar" style={{ marginBottom: '10px', padding: '0 8px' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '3px 10px', borderRadius: '6px', fontSize: '0.65rem', fontWeight: 900, textTransform: 'uppercase', color: drone.status === 'idle' ? '#fff' : STATUS_RING[drone.status], background: drone.status === 'idle' ? '#111827' : `${STATUS_RING[drone.status]}15`, border: drone.status === 'idle' ? '1px solid rgba(255,255,255,0.1)' : `1px solid ${STATUS_RING[drone.status]}30` }}>
              <div className="status-dot-mini" style={{ background: drone.status === 'idle' ? '#33d69f' : 'currentColor', width: '6px', height: '6px' }}></div>
              {drone.status?.replace('_', ' ')}
            </span>
          </div>
          <div className="popup-body">
            <div className="popup-stats">
              <div className="stat-item">
                <span className="stat-label">Battery</span>
                <div className="stat-value-row">
                  <div className="battery-bar-bg"><div className="battery-bar-fill" style={{ width: `${drone.battery}%`, background: drone.battery < 20 ? '#ff4d6d' : (drone.battery < 50 ? '#ffd166' : '#33d69f') }}></div></div>
                  <span className="stat-value">{drone.battery?.toFixed(0)}%</span>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div className="stat-item"><span className="stat-label">Range</span><span className="stat-value">{drone.estimated_range_km?.toFixed(1) || 0} km</span></div>
                <div className="stat-item"><span className="stat-label">Speed</span><span className="stat-value">{drone.speed ? `${drone.speed} km/h` : "Idle"}</span></div>
              </div>
            </div>
            {drone.weather && (
              <div className="popup-stats" style={{ marginTop: '12px', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '10px' }}>
                <div style={{ fontSize: '0.6rem', textTransform: 'uppercase', opacity: 0.4, fontWeight: 800, marginBottom: '6px' }}>Local Weather</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Cloud size={16} color="var(--primary)" />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '0.8rem', fontWeight: 700 }}>{drone.weather.condition_label || drone.weather.condition} <span style={{ opacity: 0.5, marginLeft: '6px' }}>{drone.weather.temperature}°C</span></div>
                    {drone.weather.warning && <div style={{ fontSize: '0.65rem', color: '#ff4d6d', fontWeight: 600 }}>⚠ {drone.weather.warning}</div>}
                  </div>
                </div>
              </div>
            )}
          </div>
          {drone.delivery_id && (
            <div className="popup-mission-info">
              <div className="mission-label">Active Mission #{drone.delivery_id}</div>
              <div className="mission-eta">ETA: {drone.eta_minutes ? `${drone.eta_minutes} min` : "Calculating..."}</div>
            </div>
          )}
          <div className="popup-actions">
            <button className="popup-btn primary" onClick={() => onDetail(drone)}>Full Details</button>
            <button className="popup-btn" onClick={() => onSelect(drone.id)} title="Center on Map"><Crosshair size={14} /></button>
            <button className="popup-btn" disabled={!drone.delivery_id} onClick={() => window.location.href = `/missions`} title={drone.delivery_id ? "View Mission" : "No Active Mission"} style={{ opacity: drone.delivery_id ? 1 : 0.4 }}><Package size={14} /></button>
          </div>
        </div>
      </Popup>
    </Marker>
  );
}

function FitBounds({ drones, recenterVersion, selectedDroneId }) {
  const map = useMap();
  const prevRecenterVersion = useRef(recenterVersion);
  const initialFitDone = useRef(false);

  useEffect(() => {
    if (drones.length === 0) return;

    const didRecenter = prevRecenterVersion.current !== recenterVersion;
    prevRecenterVersion.current = recenterVersion;

    if (selectedDroneId) {
      const d = drones.find(dr => dr.id === selectedDroneId);
      if (d && d.latitude && d.longitude && map) {
        if (didRecenter && map._container && map._panes) {
          try {
            map.setView([d.latitude, d.longitude], 15, { animate: false });
          } catch (e) {
            console.warn("[Leaflet] FitBounds setView failed:", e);
          }
        }
        return;
      }
    }

    if (map && (!initialFitDone.current || didRecenter)) {
      const points = [];
      drones.forEach((d) => {
        if (d.latitude != null && d.longitude != null) points.push([Number(d.latitude), Number(d.longitude)]);
        if (d.pickup_lat != null && d.pickup_lon != null) points.push([Number(d.pickup_lat), Number(d.pickup_lon)]);
        if (d.dest_lat != null && d.dest_lon != null) points.push([Number(d.dest_lat), Number(d.dest_lon)]);
        if (Array.isArray(d.route_path)) {
          d.route_path.forEach((p) => {
            if (Array.isArray(p) && p.length >= 2) points.push([Number(p[0]), Number(p[1])]);
          });
        }
        if (Array.isArray(d.planned_route_path)) {
          d.planned_route_path.forEach((p) => {
            if (Array.isArray(p) && p.length >= 2) points.push([Number(p[0]), Number(p[1])]);
          });
        }
      });
      const validPoints = points.filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
      const bounds = L.latLngBounds(validPoints);
      if (bounds.isValid() && map._container && map._panes) {
        try {
          map.fitBounds(bounds, { padding: [50, 50], maxZoom: 14 });
          initialFitDone.current = true;
        } catch (e) {
          console.warn("[Leaflet] fitBounds failed:", e);
        }
      }
    }
  }, [recenterVersion, drones, map, selectedDroneId]);
  return null;
}

function MapFloatingPanel({ children, className, style }) {
  return <div className={`map-floating-panel ${className}`} style={style} onClick={e => e.stopPropagation()}>{children}</div>;
}

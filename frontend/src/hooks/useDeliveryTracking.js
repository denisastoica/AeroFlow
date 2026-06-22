import { useEffect, useState, useRef, useCallback } from "react";
import { deliveriesAPI, getWsMonitorUrl, AUTH_CHANGED_EVENT } from "../services/api";

export function useDeliveryTracking(deliveryId) {
  const [tracking, setTracking] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [authTick, setAuthTick] = useState(0);
  const wsRef = useRef(null);
  const intervalRef = useRef(null);

  useEffect(() => {
    const onAuth = () => setAuthTick((t) => t + 1);
    window.addEventListener(AUTH_CHANGED_EVENT, onAuth);
    return () => window.removeEventListener(AUTH_CHANGED_EVENT, onAuth);
  }, []);

    const fetchTracking = useCallback(async () => {
    if (!deliveryId) return;
    try {
      setLoading((prev) => !prev && true);
      const res = await deliveriesAPI.track(deliveryId);
      setTracking(res.data);
      setError(null);
    } catch (err) {
      setError(err.response?.data?.detail || "Failed to load tracking");
    } finally {
      setLoading(false);
    }
  }, [deliveryId]);

    const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    if (!deliveryId) return;

        fetchTracking();

        const startPolling = (ms) => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = setInterval(fetchTracking, ms);
    };

        startPolling(3000);

    const token = localStorage.getItem("access_token");
    const wsUrl = getWsMonitorUrl(token);
    if (!wsUrl) return;

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        startPolling(15000);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

                    if (data.type === "delivery_update" && data.delivery_id === deliveryId) {
            setTracking((prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                status: data.status,
                dropoff_safety_status: data.dropoff_safety_status ?? prev.dropoff_safety_status,
                dropoff_safety_reason: data.dropoff_safety_reason ?? prev.dropoff_safety_reason,
                dropoff_weather_safe: data.dropoff_weather_safe ?? prev.dropoff_weather_safe,
                dropoff_battery_pct: data.dropoff_battery_pct ?? prev.dropoff_battery_pct,
                dropoff_distance_m: data.dropoff_distance_m ?? prev.dropoff_distance_m,
                dropoff_code_required: data.dropoff_code_required ?? prev.dropoff_code_required,
                confirmed_at: data.confirmed_at ?? prev.confirmed_at,
                weather: data.weather || prev.weather,
                drone: prev.drone
                  ? {
                      ...prev.drone,
                      latitude: data.drone_lat ?? prev.drone.latitude,
                      longitude: data.drone_lon ?? prev.drone.longitude,
                      battery: data.drone_battery ?? prev.drone.battery,
                      status: data.drone_status ?? prev.drone.status,
                      route_path: data.route_path ?? prev.drone.route_path,
                      route_index: data.route_index ?? prev.drone.route_index,
                      planned_route_path: data.planned_route_path ?? prev.drone.planned_route_path,
                      speed: data.drone_speed ?? prev.drone.speed,
                    }
                  : data.drone_lat
                  ? {
                      id: data.drone_id,
                      latitude: data.drone_lat,
                      longitude: data.drone_lon,
                      battery: data.drone_battery,
                      status: data.drone_status,
                      route_path: data.route_path,
                      route_index: data.route_index,
                      planned_route_path: data.planned_route_path,
                      speed: data.drone_speed,
                    }
                  : null,
                mission: prev.mission
                  ? {
                      ...prev.mission,
                      progress_pct: data.progress_pct ?? prev.mission.progress_pct,
                      remaining_km: data.remaining_km ?? prev.mission.remaining_km,
                      remaining_duration_h:
                        data.remaining_duration_h ?? prev.mission.remaining_duration_h,
                    }
                  : data.progress_pct != null
                  ? {
                      progress_pct: data.progress_pct,
                      remaining_km: data.remaining_km,
                      remaining_duration_h: data.remaining_duration_h,
                    }
                  : null,
              };
            });
          }

                    if (data.type === "drone_update") {
            setTracking((prev) => {
              if (!prev || !prev.drone) return prev;
              if (data.drone_id !== prev.drone.id) return prev;
              return {
                ...prev,
                weather: data.weather || prev.weather,
                drone: {
                  ...prev.drone,
                  latitude: data.latitude ?? prev.drone.latitude,
                  longitude: data.longitude ?? prev.drone.longitude,
                  battery: data.battery ?? prev.drone.battery,
                  status: data.status ?? prev.drone.status,
                  route_path: data.route_path ?? prev.drone.route_path,
                  route_index: data.route_index ?? prev.drone.route_index,
                  planned_route_path: data.planned_route_path ?? prev.drone.planned_route_path,
                  current_target_type: data.current_target_type,
                  current_target_name: data.current_target_name,
                  target_lat: data.target_lat,
                  target_lon: data.target_lon,
                  speed: data.speed ?? prev.drone.speed,
                },
                mission: data.mission_progress_pct != null
                  ? {
                      ...(prev.mission || {}),
                      progress_pct: data.mission_progress_pct,
                      remaining_km: data.mission_remaining_km,
                      remaining_duration_h: data.mission_remaining_duration_h,
                      status: data.mission_status,
                    }
                  : prev.mission,
              };
            });
          }

                    if (data.type === "drone_weather_update") {
            setTracking((prev) => {
              if (!prev || !prev.drone) return prev;
              if (data.drone_id !== prev.drone.id) return prev;
              return {
                ...prev,
                weather: data.weather,
              };
            });
          }
        } catch (err) {
                  }
      };

      ws.onerror = () => {
        setIsConnected(false);
        startPolling(3000);
      };
      ws.onclose = () => {
        setIsConnected(false);
        startPolling(3000);
      };
    } catch (err) {
            setIsConnected(false);
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.onerror = null;
        wsRef.current.onmessage = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [deliveryId, fetchTracking, authTick]);

  return { tracking, loading, error, refetch: fetchTracking };
}

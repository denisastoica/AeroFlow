import { useEffect, useState, useRef } from "react";
import { getWsMonitorUrl, AUTH_CHANGED_EVENT } from "../services/api";

export function useWebSocketMonitor(onDroneUpdate, onWeatherUpdate, onDroneWeatherUpdate, onFleetUpdate) {
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState(null);
  const [authTick, setAuthTick] = useState(0);
  const droneRef = useRef(onDroneUpdate);
  const weatherRef = useRef(onWeatherUpdate);
  const droneWeatherRef = useRef(onDroneWeatherUpdate);
  const fleetRef = useRef(onFleetUpdate);
  
  droneRef.current = onDroneUpdate;
  weatherRef.current = onWeatherUpdate;
  droneWeatherRef.current = onDroneWeatherUpdate;
  fleetRef.current = onFleetUpdate;

  useEffect(() => {
    const onAuth = () => setAuthTick((t) => t + 1);
    window.addEventListener(AUTH_CHANGED_EVENT, onAuth);
    return () => window.removeEventListener(AUTH_CHANGED_EVENT, onAuth);
  }, []);

  useEffect(() => {
    let ws = null;
    let reconnectTimeout = null;
    let reconnectAttempt = 0;
    const MAX_RECONNECT_DELAY = 30000;

    const connect = () => {
      try {
        const token = localStorage.getItem("access_token");
        const wsUrl = getWsMonitorUrl(token);
        if (!wsUrl) {
          setError("Missing authentication token");
          setIsConnected(false);
          console.warn("[WebSocket] Cannot connect: Missing authentication token.");
          return;
        }

        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
          setIsConnected(true);
          setError(null);
          reconnectAttempt = 0;
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === "drone_update" && droneRef.current) {
              droneRef.current(data);
            }
            if (data.type === "weather_update" && weatherRef.current) {
              weatherRef.current(data.zones);
            }
            if (data.type === "drone_weather_update" && droneWeatherRef.current) {
              droneWeatherRef.current(data);
            }
            if ((data.type === "fleet_update" || data.type === "nfz_update") && fleetRef.current) {
              fleetRef.current(data);
            }
          } catch (e) {
            console.error("[WebSocket Callback Error]: Error processing message or inside component callback:", e, event.data);
          }
        };

        ws.onerror = (err) => {
          setError("WebSocket connection error");
          console.error("[WebSocket] Connection error:", err);
        };

        ws.onclose = (event) => {
          setIsConnected(false);
          console.warn(`[WebSocket] Connection closed (code: ${event.code}, reason: ${event.reason || 'none'}). Reconnecting...`);
          const delay = Math.min(1000 * Math.pow(2, reconnectAttempt), MAX_RECONNECT_DELAY);
          reconnectAttempt++;
          reconnectTimeout = setTimeout(connect, delay);
        };
      } catch (e) {
        setError("Failed to connect to WebSocket");
        console.error("[WebSocket] Catch block connection error:", e);
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempt), MAX_RECONNECT_DELAY);
        reconnectAttempt++;
        reconnectTimeout = setTimeout(connect, delay);
      }
    };

    connect();

    return () => {
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
      }
      if (ws) {
        ws.onclose = null;
        ws.onerror = null;
        ws.close();
      }
    };
  }, [authTick]);

  return { isConnected, error };
}

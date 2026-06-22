import { useEffect, useState, useRef } from "react";
import { getWsMonitorUrl, AUTH_CHANGED_EVENT } from "../services/api";

export function useDeliveryUpdates(onDeliveryUpdate) {
  const [connected, setConnected] = useState(false);
  const [authTick, setAuthTick] = useState(0);
  const callbackRef = useRef(onDeliveryUpdate);
  callbackRef.current = onDeliveryUpdate;

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
      const token = localStorage.getItem("access_token");
      const url = getWsMonitorUrl(token);
      if (!url) {
        setConnected(false);
        return;
      }

      try {
        ws = new WebSocket(url);

        ws.onopen = () => {
          setConnected(true);
          reconnectAttempt = 0;
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === "delivery_update" || data.type === "delivery_confirmed") {
              callbackRef.current?.(data);
            }
          } catch (err) {
                      }
        };

        ws.onerror = () => {
          setConnected(false);
        };

        ws.onclose = () => {
          setConnected(false);
          const delay = Math.min(1000 * Math.pow(2, reconnectAttempt), MAX_RECONNECT_DELAY);
          reconnectAttempt++;
          reconnectTimeout = setTimeout(connect, delay);
        };
      } catch (err) {
        setConnected(false);
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempt), MAX_RECONNECT_DELAY);
        reconnectAttempt++;
        reconnectTimeout = setTimeout(connect, delay);
      }
    };

    connect();

    return () => {
      if (ws) {
        ws.close();
      }
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
      }
    };
  }, [authTick]);

  return { connected };
}

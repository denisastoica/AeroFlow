import { useState, useCallback, createContext, useContext } from "react";
import React from "react";

let toastId = 0;

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((message, type = "info", duration = 4000) => {
    const id = toastId++;
    setToasts((prev) => [...prev, { id, message, type, duration }]);
    return id;
  }, []);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const success = useCallback((message, duration = 4000) => addToast(message, "success", duration), [addToast]);
  const error = useCallback((message, duration = 5000) => addToast(message, "error", duration), [addToast]);
  const info = useCallback((message, duration = 4000) => addToast(message, "info", duration), [addToast]);
  const warning = useCallback((message, duration = 4000) => addToast(message, "warning", duration), [addToast]);

  const value = React.useMemo(() => ({
    toasts,
    removeToast,
    addToast,
    success,
    error,
    info,
    warning,
  }), [toasts, removeToast, addToast, success, error, info, warning]);

  return React.createElement(ToastContext.Provider, { value }, children);
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within a <ToastProvider>");
  }
  return ctx;
}

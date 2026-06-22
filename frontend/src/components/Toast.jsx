import React, { useEffect } from "react";

function Toast({ id, message, type = "info", duration = 4000, onClose }) {
  useEffect(() => {
    if (duration > 0) {
      const timer = setTimeout(() => {
        onClose(id);
      }, duration);
      return () => clearTimeout(timer);
    }
  }, [id, duration, onClose]);

  return (
    <div className={`toast-item toast-item--${type}`}>
      <span>{message}</span>
      <button onClick={() => onClose(id)} className="toast-close">
        ×
      </button>
    </div>
  );
}

export function ToastContainer({ toasts, onClose }) {
  return (
    <div className="toast-container">
      {toasts.map((toast) => (
        <Toast key={toast.id} {...toast} onClose={onClose} />
      ))}
    </div>
  );
}

export default Toast;

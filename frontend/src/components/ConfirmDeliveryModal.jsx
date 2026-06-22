import React, { useState } from "react";
import { proofOfDeliveryAPI, getErrorMessage } from "../services/api";
import { useToast } from "../hooks/useToast";
import { useAuth } from "../context/AuthContext";
import { DEMO_PROOF_PHOTO_URL } from "../utils/proofPhoto";

export default function ConfirmDeliveryModal({ deliveryId, onClose, onConfirm }) {
  const { user } = useAuth();
  const [code, setCode] = useState("");
  const [recipientName, setRecipientName] = useState(user?.name || "");
  const [notes, setNotes] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const toast = useToast();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (code.length !== 6) {
      toast.error("Confirmation code must be 6 digits");
      return;
    }

    setLoading(true);
    try {
      await proofOfDeliveryAPI.confirm(deliveryId, {
        confirmation_code: code,
        recipient_name: recipientName,
        delivery_photo_url: photoUrl || undefined,
        delivery_notes: notes
      });
      
      toast.success("Delivery confirmed successfully!");
      if (onConfirm) onConfirm();
      onClose();
    } catch (err) {
      toast.error(getErrorMessage(err, "The code entered is incorrect"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay app-modal-overlay" style={{ zIndex: 3500 }} onClick={onClose}>
      <div className="modal-content app-modal app-modal--confirm" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <div className="app-modal__header">
          <div>
            <h2 className="app-modal__title">Confirm Receipt</h2>
            <p className="app-modal__subtitle">
              Enter the 6-digit code sent by email when the delivery was assigned to confirm that you received the package.
            </p>
          </div>
          <button className="app-modal__close" onClick={onClose} aria-label="Close confirm receipt modal">&times;</button>
        </div>

        <form onSubmit={handleSubmit} className="app-modal__body">
          <div className="form-group">
            <label className="app-modal__label">Confirmation Code</label>
            <input
              type="text"
              maxLength="6"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              placeholder="0 0 0 0 0 0"
              required
              className="app-modal__otp"
            />
            <p className="app-modal__help">Use the 6-digit code from the delivery email sent before arrival.</p>
          </div>

          <div className="form-group">
            <label className="app-modal__label">Recipient Name</label>
            <input
              type="text"
              value={recipientName}
              onChange={(e) => setRecipientName(e.target.value)}
              placeholder="Your full name"
              required
              className="app-modal__input"
            />
          </div>

          <div className="form-group">
            <label className="app-modal__label">Notes (Optional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Package arrived intact."
              className="app-modal__textarea"
            />
          </div>

          <details className="app-modal__advanced">
            <summary>Demo proof photo</summary>
            <div className="app-modal__advanced-body">
              <div className="form-group" style={{ margin: 0 }}>
                <label className="app-modal__label">Photo Proof URL</label>
                <div className="app-modal__inline-row">
                  <input
                    type="text"
                    value={photoUrl}
                    onChange={(e) => setPhotoUrl(e.target.value)}
                    placeholder="https://example.com/photo.jpg"
                    className="app-modal__input"
                    style={{ flex: 1 }}
                  />
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={() => setPhotoUrl(DEMO_PROOF_PHOTO_URL)}
                  >
                    Demo
                  </button>
                </div>
                <p className="app-modal__help">
                  For demo purposes, you can attach a proof photo URL. In production, this would be uploaded automatically by the drone.
                </p>
              </div>
            </div>
          </details>

          <div className="app-modal__footer">
            <button type="button" className="btn btn-outline" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn--primary"
              disabled={loading}
            >
              {loading ? "Confirming..." : "Confirm Package"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// "Deactivated" state of a volunteer or NGO account (deactivated by its
// owner in Settings) and the admin's Reactivate action. Reactivation is
// written to the audit log by the server.
import { useState } from "react";
import { formatIST, reactivateAccount } from "./adminApi";

export function DeactivatedPill({ deactivatedAt }) {
  if (!deactivatedAt) return null;

  return (
    <span className="adm-pill adm-pill--deactivated" title={`Deactivated ${formatIST(deactivatedAt)}`}>
      Deactivated
    </span>
  );
}

/** Pill + "Reactivate" with a confirm step, for the detail page header. */
export function ReactivateControl({ kind, id, name, deactivatedAt, showToast, onReactivated }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!deactivatedAt) return null;

  const reactivate = async () => {
    setBusy(true);
    setError("");
    try {
      await reactivateAccount(kind, id);
      showToast?.(`${name} can log in again`, "success");
      setConfirming(false);
      onReactivated?.();
    } catch (err) {
      // A 401 already sent the admin back to the login screen.
      if (err.status !== 401) setError(err.message || "Could not reactivate this account");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="adm-reactivate">
      <DeactivatedPill deactivatedAt={deactivatedAt} />
      {!confirming ? (
        <button type="button" className="adm-btn adm-btn--secondary adm-btn--sm" onClick={() => setConfirming(true)}>
          Reactivate
        </button>
      ) : (
        <div className="adm-reactivate-confirm" role="group" aria-label={`Reactivate ${name}`}>
          <p>
            Reactivate {name}? The account can log in again and shows up in lists and matching.
            Deactivated {formatIST(deactivatedAt)}.
          </p>
          <div className="adm-reactivate-actions">
            <button type="button" className="adm-btn adm-btn--primary adm-btn--sm" onClick={reactivate} disabled={busy}>
              {busy ? "Reactivating…" : "Yes, reactivate"}
            </button>
            <button type="button" className="adm-btn adm-btn--secondary adm-btn--sm" onClick={() => setConfirming(false)} disabled={busy}>
              Cancel
            </button>
          </div>
          {error && (
            <p className="adm-modal-error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

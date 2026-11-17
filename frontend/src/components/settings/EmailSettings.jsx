import { useState } from "react";
import { Icon } from "../ui/ui";
import { getSession } from "../../api";
import { requestEmailChange } from "./settingsApi";
import { Field, SettingsCard, describedBy } from "./SettingsParts";

// The address a link was last sent to, shown until it is confirmed. Kept in
// this tab only (sessionStorage); the server never says whether it was sent.
const PENDING_KEY = "voluntag_pending_email";
const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function readPending() {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    const data = raw ? JSON.parse(raw) : null;
    const session = getSession();
    // Only for the account that asked, and only while it still has the old address.
    if (data && session && data.from === session.email && typeof data.to === "string") return data.to;
  } catch {
    // Storage unavailable: no notice.
  }
  return "";
}

function writePending(to) {
  try {
    const session = getSession();
    if (to && session) sessionStorage.setItem(PENDING_KEY, JSON.stringify({ from: session.email, to }));
    else sessionStorage.removeItem(PENDING_KEY);
  } catch {
    // The notice simply does not survive a reload.
  }
}

export default function EmailSettings({ currentEmail }) {
  const [newEmail, setNewEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(readPending);

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;

    const address = newEmail.trim().toLowerCase();
    const errs = {};
    if (!EMAIL_SHAPE.test(address)) errs.newEmail = "Enter a valid email address";
    else if (address === String(currentEmail || "").toLowerCase()) errs.newEmail = "That is already your email address";
    if (!password) errs.password = "Enter your password";
    setErrors(errs);
    setError("");
    if (Object.keys(errs).length) return;

    setBusy(true);
    try {
      await requestEmailChange(password, address);
      setPending(address);
      writePending(address);
      setNewEmail("");
      setPassword("");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const dismiss = () => {
    setPending("");
    writePending("");
  };

  return (
    <SettingsCard
      id="set-email"
      title="Email address"
      description="You log in with this address and we send notices to it."
    >
      <dl className="settings-readonly">
        <div className="settings-readonly__wide">
          <dt>Current address</dt>
          <dd>{currentEmail}</dd>
        </div>
      </dl>

      {pending && (
        <div className="ui-alert ui-alert--warning settings-pending" role="status">
          <p className="settings-confirm__title">
            <Icon name="inbox" size={15} /> Waiting for confirmation
          </p>
          <p>
            If <strong>{pending}</strong> can be used, we have sent a link to it. Your address stays{" "}
            <strong>{currentEmail}</strong> until you open that link. It works once, for 24 hours.
          </p>
          <p>Didn't get it? Check spam, or send a new request below (the newest link is the only one that works).</p>
          <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={dismiss}>
            Hide this notice
          </button>
        </div>
      )}

      <form className="settings-form settings-form--narrow" onSubmit={submit} noValidate>
        <Field id="set-new-email" label="New email address" required error={errors.newEmail}>
          <input
            id="set-new-email"
            className="ui-input"
            type="email"
            autoComplete="email"
            inputMode="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            {...describedBy("set-new-email", errors.newEmail)}
          />
        </Field>

        <Field id="set-email-password" label="Your password" required error={errors.password}>
          <input
            id="set-email-password"
            className="ui-input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            {...describedBy("set-email-password", errors.password)}
          />
        </Field>

        <p className="ui-hint">
          After you confirm, every other device is logged out and your old address gets a short notice.
        </p>

        {error && (
          <p className="ui-alert ui-alert--danger" role="alert">
            {error}
          </p>
        )}

        <div className="settings-actions">
          <button type="submit" className="ui-btn ui-btn--primary" disabled={busy || !newEmail.trim() || !password}>
            {busy ? "Sending…" : "Send confirmation link"}
          </button>
        </div>
      </form>
    </SettingsCard>
  );
}

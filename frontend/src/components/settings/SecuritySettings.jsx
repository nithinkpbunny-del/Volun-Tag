import { useCallback, useEffect, useState } from "react";
import { Badge, SkeletonList } from "../ui/ui";
import { PasswordField, meetsPasswordPolicy } from "../PasswordRules";
import { changePassword, listSessions, logoutOtherSessions } from "./settingsApi";
import { Field, SettingsCard, describedBy, formatWhen } from "./SettingsParts";

function ChangePasswordCard({ onChanged }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null); // {tone, text}

  const touched = current || next || confirm;

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;

    const errs = {};
    if (!current) errs.current = "Enter your current password";
    if (!meetsPasswordPolicy(next)) errs.next = "The new password does not meet all the rules";
    else if (next === current) errs.next = "Choose a password different from your current one";
    if (confirm !== next) errs.confirm = "The two new passwords do not match";
    setErrors(errs);
    setResult(null);
    if (Object.keys(errs).length) return;

    setBusy(true);
    try {
      const data = await changePassword(current, next);
      setCurrent("");
      setNext("");
      setConfirm("");
      const others = Number(data.sessions_revoked) || 0;
      setResult({
        tone: "success",
        text:
          others > 0
            ? `Password changed. ${others} other ${others === 1 ? "session was" : "sessions were"} logged out; you stay logged in here.`
            : "Password changed. You stay logged in here.",
      });
      onChanged?.();
    } catch (err) {
      setResult({ tone: "danger", text: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsCard
      id="set-password"
      title="Change password"
      description="You stay logged in on this device. Every other device is logged out."
    >
      <form className="settings-form settings-form--narrow" onSubmit={submit} noValidate>
        <Field id="set-current-password" label="Current password" required error={errors.current}>
          <input
            id="set-current-password"
            className="ui-input"
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            {...describedBy("set-current-password", errors.current)}
          />
        </Field>

        <div className="ui-field settings-field">
          <label htmlFor="set-new-password">
            New password<span className="settings-required" aria-hidden="true"> *</span>
          </label>
          <PasswordField id="set-new-password" value={next} onChange={setNext} hasError={Boolean(errors.next)} />
          {errors.next && <p className="ui-error">{errors.next}</p>}
        </div>

        <Field id="set-confirm-password" label="Confirm new password" required error={errors.confirm}>
          <input
            id="set-confirm-password"
            className="ui-input"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            {...describedBy("set-confirm-password", errors.confirm)}
          />
        </Field>

        {result && (
          <p className={`ui-alert ui-alert--${result.tone}`} role={result.tone === "danger" ? "alert" : "status"}>
            {result.text}
          </p>
        )}

        <div className="settings-actions">
          <button type="submit" className="ui-btn ui-btn--primary" disabled={!touched || busy}>
            {busy ? "Changing…" : "Change password"}
          </button>
        </div>
      </form>
    </SettingsCard>
  );
}

function SessionsCard({ refreshKey }) {
  const [sessions, setSessions] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      setSessions(await listSessions());
      setError("");
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const others = sessions ? sessions.filter((s) => !s.current).length : 0;

  const logoutOthers = async () => {
    setBusy(true);
    setNotice("");
    try {
      const data = await logoutOtherSessions();
      const n = Number(data.revoked) || 0;
      setNotice(n === 1 ? "1 other session was logged out." : `${n} other sessions were logged out.`);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsCard
      id="set-sessions"
      title="Where you're logged in"
      description="Each login lasts up to 12 hours. Log out anything you do not recognise, then change your password."
    >
      {error && (
        <p className="ui-alert ui-alert--danger" role="alert">
          {error}
        </p>
      )}

      {!sessions && !error && <SkeletonList count={1} label="Loading your sessions" />}

      {sessions && (
        <ul className="settings-sessions">
          {sessions.map((s) => (
            <li key={s.id} className={`settings-session ${s.current ? "settings-session--current" : ""}`.trim()}>
              <div className="settings-session__main">
                <p className="settings-session__device">
                  {s.device || "Unknown device"}
                  {s.current && (
                    <Badge tone="success" dot>
                      This device
                    </Badge>
                  )}
                </p>
                <p className="settings-session__meta">
                  Logged in {formatWhen(s.created_at)} · Last active {formatWhen(s.last_used_at)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}

      {notice && (
        <p className="ui-alert ui-alert--success" role="status">
          {notice}
        </p>
      )}

      <div className="settings-actions">
        <button type="button" className="ui-btn" onClick={logoutOthers} disabled={busy || others === 0}>
          {busy ? "Logging out…" : "Log out other sessions"}
        </button>
        {sessions && others === 0 && <span className="settings-muted">No other sessions.</span>}
      </div>
    </SettingsCard>
  );
}

export default function SecuritySettings() {
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div className="settings-stack">
      <ChangePasswordCard onChanged={() => setRefreshKey((k) => k + 1)} />
      <SessionsCard refreshKey={refreshKey} />
    </div>
  );
}

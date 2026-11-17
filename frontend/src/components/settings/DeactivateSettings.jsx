import { useState } from "react";
import { Link } from "react-router-dom";
import { Icon } from "../ui/ui";
import { formatEventDay } from "../../dates";
import { PATHS } from "../../routes";
import { deactivateAccount } from "./settingsApi";
import { Field, SettingsCard, describedBy } from "./SettingsParts";

const WORD = "DEACTIVATE";

export default function DeactivateSettings({ role, onDeactivated, onOpenEvents }) {
  const [password, setPassword] = useState("");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [blockedBy, setBlockedBy] = useState(null); // upcoming events (NGO)

  const ready = typed === WORD && password && !busy;

  const submit = async (e) => {
    e.preventDefault();
    if (!ready) return;

    setBusy(true);
    setError("");
    setBlockedBy(null);
    try {
      await deactivateAccount(password, typed);
      onDeactivated?.();
    } catch (err) {
      if (err.code === "upcoming_events" && Array.isArray(err.data?.upcoming_events)) {
        setBlockedBy(err.data.upcoming_events);
      }
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <SettingsCard
      id="set-deactivate"
      title="Deactivate your account"
      tone="danger"
      description="For when you want to stop using VolunTag. You can ask us to turn it back on later."
    >
      <ul className="settings-consequences">
        <li>You are logged out everywhere and cannot log in.</li>
        {role === "ngo" ? (
          <li>Your NGO disappears from the NGO list and from volunteers' suggestions.</li>
        ) : (
          <li>You stop appearing in matching, and NGOs cannot send you new messages.</li>
        )}
        <li>Nothing is deleted: your history stays, so the team can reactivate the account if you ask.</li>
        {role === "ngo" && <li>Upcoming events must be cancelled first, so the volunteers who joined are told.</li>}
      </ul>

      {blockedBy && (
        <div className="ui-alert ui-alert--warning settings-confirm" role="alert">
          <p className="settings-confirm__title">
            <Icon name="calendar" size={15} /> Cancel these events first
          </p>
          <ul className="settings-blocked-list">
            {blockedBy.map((event) => (
              <li key={event.id}>
                <strong>{event.title}</strong> · {formatEventDay(event.event_day)}
              </li>
            ))}
          </ul>
          {onOpenEvents && (
            <div className="settings-confirm__actions">
              <button type="button" className="ui-btn" onClick={onOpenEvents}>
                Go to My Events
              </button>
            </div>
          )}
        </div>
      )}

      <form className="settings-form settings-form--narrow" onSubmit={submit} noValidate>
        <Field id="set-deactivate-password" label="Your password" required>
          <input
            id="set-deactivate-password"
            className="ui-input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>

        <Field id="set-deactivate-word" label={`Type ${WORD} to confirm`} required hint="Capital letters, exactly as shown.">
          <input
            id="set-deactivate-word"
            className="ui-input"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            {...describedBy("set-deactivate-word", "", true)}
          />
        </Field>

        {error && !blockedBy && (
          <p className="ui-alert ui-alert--danger" role="alert">
            {error}
          </p>
        )}

        <div className="settings-actions">
          <button type="submit" className="ui-btn ui-btn--danger" disabled={!ready}>
            {busy ? "Deactivating…" : "Deactivate my account"}
          </button>
          <Link className="settings-muted" to={PATHS.contact}>
            Questions? Contact us
          </Link>
        </div>
      </form>
    </SettingsCard>
  );
}

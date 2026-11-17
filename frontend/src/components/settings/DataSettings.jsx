import { useState } from "react";
import { downloadMyData } from "./settingsApi";
import { Field, SettingsCard, describedBy } from "./SettingsParts";

const CONTENTS = {
  volunteer: [
    "Your profile",
    "The events you signed up for, with the ratings and feedback NGOs gave you",
    "The problems you reported",
    "The messages you sent",
  ],
  ngo: [
    "Your organisation's profile and which documents are on file",
    "Your events, with how many volunteers signed up (not who)",
    "The problem solutions you submitted",
    "The messages you sent",
  ],
};

export default function DataSettings({ role }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    if (busy || !password) return;

    setBusy(true);
    setError("");
    setDone("");
    try {
      const filename = await downloadMyData(password);
      setPassword("");
      setDone(`Your data was saved as ${filename}.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsCard
      id="set-data"
      title="Download your data"
      description="A JSON file with what VolunTag stores about your account."
    >
      <div className="settings-data-list">
        <p className="ui-label">It includes</p>
        <ul>
          {(CONTENTS[role] || CONTENTS.volunteer).map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p className="ui-hint">
          It never includes your password, login tokens, other people's private details or internal matching data.
        </p>
      </div>

      <form className="settings-form settings-form--narrow" onSubmit={submit} noValidate>
        <Field id="set-data-password" label="Confirm with your password" required>
          <input
            id="set-data-password"
            className="ui-input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            {...describedBy("set-data-password", error)}
          />
        </Field>

        {error && (
          <p className="ui-alert ui-alert--danger" role="alert" id="set-data-password-error">
            {error}
          </p>
        )}
        {done && (
          <p className="ui-alert ui-alert--success" role="status">
            {done}
          </p>
        )}

        <div className="settings-actions">
          <button type="submit" className="ui-btn ui-btn--primary" disabled={busy || !password}>
            {busy ? "Preparing…" : "Download my data"}
          </button>
        </div>
      </form>
    </SettingsCard>
  );
}

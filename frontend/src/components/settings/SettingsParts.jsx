// Small pieces shared by the Settings sections.
import { useEffect } from "react";
import { Badge } from "../ui/ui";

/** One titled card in a Settings section. */
export function SettingsCard({ title, description, id, children, tone = "" }) {
  const headingId = id ? `${id}-title` : undefined;

  return (
    <section
      className={`ui-card settings-card ${tone ? `settings-card--${tone}` : ""}`.trim()}
      aria-labelledby={headingId}
    >
      <header className="settings-card__head">
        <h3 className="settings-card__title" id={headingId}>
          {title}
        </h3>
        {description && <p className="settings-card__desc">{description}</p>}
      </header>
      {children}
    </section>
  );
}

/** A labelled input, select or textarea with its hint and error. */
export function Field({ id, label, required, hint, error, children, className = "" }) {
  return (
    <div className={`ui-field settings-field ${className}`.trim()}>
      <label htmlFor={id}>
        {label}
        {required && (
          <span className="settings-required" aria-hidden="true">
            {" "}*
          </span>
        )}
      </label>
      {children}
      {hint && !error && (
        <p className="ui-hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
      {error && (
        <p className="ui-error" id={`${id}-error`}>
          {error}
        </p>
      )}
    </div>
  );
}

/** aria props for an input that may show a hint or an error under it. */
export const describedBy = (id, error, hint) => ({
  "aria-invalid": error ? "true" : undefined,
  "aria-describedby": error ? `${id}-error` : hint ? `${id}-hint` : undefined,
});

/**
 * The save row under a form: unsaved / saved / error state, a Discard button
 * and a Save button that is disabled while nothing changed or while saving.
 */
export function SaveBar({ dirty, saving, status, error, onDiscard, saveLabel = "Save changes" }) {
  return (
    <div className="settings-savebar">
      <div className="settings-savebar__state" role="status" aria-live="polite">
        {saving ? (
          <span className="settings-muted">Saving…</span>
        ) : dirty ? (
          <Badge tone="warning" dot>
            Unsaved changes
          </Badge>
        ) : status === "saved" ? (
          <Badge tone="success" dot>
            Saved
          </Badge>
        ) : null}
      </div>
      <div className="settings-savebar__actions">
        {dirty && !saving && (
          <button type="button" className="ui-btn ui-btn--ghost" onClick={onDiscard}>
            Discard
          </button>
        )}
        <button type="submit" className="ui-btn ui-btn--primary" disabled={!dirty || saving}>
          {saving ? "Saving…" : saveLabel}
        </button>
      </div>
      {error && (
        <p className="ui-alert ui-alert--danger settings-savebar__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** Ask the browser to confirm leaving the page while there are unsaved changes. */
export function useLeaveWarning(active) {
  useEffect(() => {
    if (!active) return undefined;

    const onBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [active]);
}

/** "2026-11-17T08:30:00Z" -> "17 Nov 2026, 2:00 pm" in the viewer's time zone. */
export function formatWhen(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

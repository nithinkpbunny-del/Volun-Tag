import { useCallback, useEffect, useRef, useState } from "react";
import { formatIST, getAuditActions, useVisibleInterval } from "./adminApi";

const AUDIT_REFRESH_MS = 15000;

const DETAIL_MAX_CHARS = 80;

// `value` is the exact target_type the backend stores; "" sends no filter.
const TARGET_FILTERS = [
  { value: "", label: "All" },
  { value: "conversation", label: "Conversations" },
  { value: "resolution", label: "Proofs" },
  { value: "issue", label: "Issues" },
  { value: "session", label: "Logins" },
];

const LIMITS = [50, 100, 200];

const ACTION_LABELS = {
  view_conversation: "Viewed conversation",
  approve_resolution: "Approved proof",
  reject_resolution: "Rejected proof",
  change_issue_status: "Changed issue status",
  delete_issue: "Deleted issue",
  login: "Admin login",
  login_failed: "Failed admin login",
  logout: "Admin logout",
};

/** Compact plain text for any JSON value; nested values are flattened, never rendered as HTML. */
function compactText(value) {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (Array.isArray(value)) {
    return value.length ? value.map(compactText).join(", ") : "none";
  }
  if (typeof value === "object") {
    const entries = Object.entries(value);
    return entries.length
      ? entries.map(([key, inner]) => `${key}: ${compactText(inner)}`).join("; ")
      : "none";
  }
  return String(value);
}

function truncate(text) {
  return text.length > DETAIL_MAX_CHARS ? `${text.slice(0, DETAIL_MAX_CHARS - 1)}…` : text;
}

function TruncatedText({ text }) {
  const short = truncate(text);
  return <span title={short !== text ? text : undefined}>{short}</span>;
}

function DetailsCell({ details }) {
  if (details === null || details === undefined) return "—";

  if (typeof details !== "object" || Array.isArray(details)) {
    return <TruncatedText text={compactText(details)} />;
  }

  const entries = Object.entries(details);
  if (entries.length === 0) return "—";

  return (
    <dl className="adm-audit-details">
      {entries.map(([key, value]) => (
        <div key={key} className="adm-audit-detail">
          <dt>{key.replace(/_/g, " ")}:</dt>
          <dd><TruncatedText text={compactText(value)} /></dd>
        </div>
      ))}
    </dl>
  );
}

function targetText(entry) {
  const type = entry.target_type;
  const id = entry.target_id;
  if (!type && !id) return "—";
  if (!id) return type;
  return type ? `${type} ${id}` : id;
}

export default function AdminAuditLog() {
  const [targetType, setTargetType] = useState("");
  const [limit, setLimit] = useState(LIMITS[0]);
  const [items, setItems] = useState(null); // null until the first successful load
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Only the newest request may update the table (filters can change mid-flight).
  const requestSeq = useRef(0);

  const load = useCallback(
    async ({ silent = false } = {}) => {
      const seq = ++requestSeq.current;

      if (!silent) {
        setLoading(true);
        setError("");
      }

      try {
        const data = await getAuditActions(limit, targetType);
        if (seq !== requestSeq.current) return;
        setItems(Array.isArray(data) ? data : []);
        setError("");
      } catch (err) {
        // Silent refreshes keep the rows already on screen.
        if (seq !== requestSeq.current || silent || err.status === 401) return;
        setError(err.message || "Could not load the audit log");
      } finally {
        if (seq === requestSeq.current && !silent) setLoading(false);
      }
    },
    [limit, targetType]
  );

  useEffect(() => {
    load();
  }, [load]);

  useVisibleInterval(() => load({ silent: true }), true, AUDIT_REFRESH_MS);

  let body;
  if (error) {
    body = (
      <div className="adm-state adm-state--error" role="alert">
        <p>{error}</p>
        <button type="button" className="adm-btn adm-btn--secondary" onClick={() => load()}>
          Try again
        </button>
      </div>
    );
  } else if (items === null) {
    body = (
      <div className="adm-state" role="status">
        <span className="adm-spinner" aria-hidden="true" />
        Loading audit log…
      </div>
    );
  } else if (items.length === 0) {
    body = (
      <div className="adm-state adm-state--empty">
        <p>{targetType ? "No actions of this kind yet." : "No admin actions have been recorded yet."}</p>
      </div>
    );
  } else {
    body = (
      <div className="adm-card adm-card--flush">
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th scope="col">Action</th>
                <th scope="col">Target</th>
                <th scope="col">Details</th>
              </tr>
            </thead>
            <tbody>
              {items.map((entry) => (
                <tr key={entry.id}>
                  <td className="adm-nowrap">{formatIST(entry.created_at)}</td>
                  <td className="adm-nowrap">{ACTION_LABELS[entry.action] || entry.action || "—"}</td>
                  <td className="adm-cell-wrap">{targetText(entry)}</td>
                  <td><DetailsCell details={entry.details} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <section className="adm-page" aria-labelledby="adm-audit-title">
      <header className="adm-page-header">
        <h1 className="adm-page-title" id="adm-audit-title">Audit log</h1>
        <p className="adm-page-sub">Newest first. Refreshes every 15 seconds.</p>
      </header>

      <p className="adm-audit-note" role="note">
        Every admin action is recorded here. This page is read-only.
      </p>

      <div className="adm-toolbar">
        <div className="adm-tabs adm-tabs--inline" role="group" aria-label="Filter actions by target">
          {TARGET_FILTERS.map((f) => (
            <button
              key={f.label}
              type="button"
              aria-pressed={f.value === targetType}
              className={`adm-tab${f.value === targetType ? " adm-tab--active" : ""}`}
              onClick={() => setTargetType(f.value)}
            >
              {f.label}
            </button>
          ))}
        </div>

        <label className="adm-limit">
          <span>Show</span>
          <select
            className="adm-input adm-select"
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
          >
            {LIMITS.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>

        {loading && items !== null && (
          <span className="adm-toolbar-status" role="status">
            <span className="adm-spinner" aria-hidden="true" />
            Updating…
          </span>
        )}
      </div>

      {body}
    </section>
  );
}

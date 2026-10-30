import { useCallback, useEffect, useRef, useState } from "react";
import AdminNGODetail from "./AdminNGODetail";
import AdminProofDetail from "./AdminProofDetail";
import { formatIST, getEvent, getOverview, useVisibleInterval } from "./adminApi";

const OVERVIEW_REFRESH_MS = 15000;

// Verification statuses listed first in the NGO breakdown; any others follow.
const NGO_STATUS_ORDER = ["Approved", "Pending", "Rejected"];

const ACTIVITY_LABELS = {
  event_created: "Event",
  signup: "Signup",
  issue_reported: "Problem",
  proof_submitted: "Proof",
  proof_decided: "Decision",
};

function ngoBreakdown(byStatus) {
  const entries = Object.entries(byStatus || {});
  entries.sort(([a], [b]) => {
    const ia = NGO_STATUS_ORDER.indexOf(a);
    const ib = NGO_STATUS_ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
  });
  return entries.map(([status, n]) => `${n} ${status}`).join(", ");
}

function StatCard({ label, value, sub, onClick, actionLabel }) {
  const content = (
    <>
      <span className="adm-stat-label">{label}</span>
      <span className="adm-stat-value">{value}</span>
      {sub && <span className="adm-stat-sub">{sub}</span>}
      {actionLabel && <span className="adm-stat-action">{actionLabel} →</span>}
    </>
  );

  if (onClick) {
    return (
      <button type="button" className="adm-stat-card adm-stat-card--link" onClick={onClick}>
        {content}
      </button>
    );
  }

  return <div className="adm-stat-card">{content}</div>;
}

export default function AdminOverview({ showToast, onDataChanged, onNavigate }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  // null, { type: "proof", id } or { type: "ngo", ngoId, eventId, event }
  const [detail, setDetail] = useState(null);
  const [openingKey, setOpeningKey] = useState(null);

  const requestSeq = useRef(0);

  const load = useCallback(async ({ silent = false } = {}) => {
    const seq = ++requestSeq.current;

    try {
      const result = await getOverview();
      if (seq !== requestSeq.current) return;
      setData(result);
      setError("");
    } catch (err) {
      // Silent refreshes keep the data already on screen.
      if (seq !== requestSeq.current || silent || err.status === 401) return;
      setError(err.message || "Could not load the overview");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Refresh silently while the overview itself is on screen.
  useVisibleInterval(() => load({ silent: true }), detail === null, OVERVIEW_REFRESH_MS);

  const retry = () => {
    setError("");
    load();
  };

  const closeDetail = () => {
    setDetail(null);
    load({ silent: true });
    window.scrollTo({ top: 0, behavior: "instant" });
  };

  const openProof = (id) => {
    setDetail({ type: "proof", id: Number(id) });
    window.scrollTo({ top: 0, behavior: "instant" });
  };

  const openEvent = async (item, key) => {
    if (openingKey) return;
    setOpeningKey(key);

    try {
      const event = await getEvent(item.ref_id);
      setDetail({ type: "ngo", ngoId: event.ngo_id, eventId: event.id, event });
      window.scrollTo({ top: 0, behavior: "instant" });
    } catch (err) {
      if (err.status !== 401) {
        showToast(err.message || "Could not open this event", "error");
      }
    } finally {
      setOpeningKey(null);
    }
  };

  if (detail && detail.type === "proof") {
    return (
      <AdminProofDetail
        key={detail.id}
        resolutionId={detail.id}
        showToast={showToast}
        onBack={closeDetail}
        onOpenProof={openProof}
        onChanged={onDataChanged}
        backLabel="Back to overview"
      />
    );
  }

  if (detail && detail.type === "ngo") {
    return (
      <AdminNGODetail
        key={`${detail.ngoId}-${detail.eventId}`}
        ngoId={detail.ngoId}
        showToast={showToast}
        onBack={closeDetail}
        backLabel="Back to overview"
        onDataChanged={onDataChanged}
        initialTab="events"
        initialEventId={detail.eventId}
        initialEvent={detail.event}
      />
    );
  }

  const header = (
    <header className="adm-page-header">
      <h1 className="adm-page-title" id="adm-overview-title">Overview</h1>
      <p className="adm-page-sub">A live summary of VolunTag. Refreshes every 15 seconds.</p>
    </header>
  );

  if (!data) {
    return (
      <section className="adm-page" aria-labelledby="adm-overview-title">
        {header}
        {error ? (
          <div className="adm-state adm-state--error" role="alert">
            <p>{error}</p>
            <button type="button" className="adm-btn adm-btn--secondary" onClick={retry}>
              Try again
            </button>
          </div>
        ) : (
          <div className="adm-state" role="status">
            <span className="adm-spinner" aria-hidden="true" />
            Loading overview…
          </div>
        )}
      </section>
    );
  }

  const { ngos, events, signups, issues } = data;
  const eventsTotal = events.upcoming + events.completed + events.cancelled;

  const issueParts = [
    `${issues.reported} reported`,
    `${issues.under_evaluation} under evaluation`,
    `${issues.resolved} resolved`,
  ];
  if (issues.other > 0) issueParts.push(`${issues.other} other`);

  const activity = data.recent_activity || [];

  return (
    <section className="adm-page" aria-labelledby="adm-overview-title">
      {header}

      <div className="adm-stat-grid">
        <StatCard label="NGOs" value={ngos.total} sub={ngoBreakdown(ngos.by_status)} />
        <StatCard label="Volunteers" value={data.volunteers_total} />
        <StatCard
          label="Events"
          value={eventsTotal}
          sub={`${events.upcoming} upcoming · ${events.completed} completed · ${events.cancelled} cancelled`}
        />
        <StatCard
          label="Signups"
          value={signups.total}
          sub={`${signups.approved} approved · ${signups.attended} attended`}
        />
        <StatCard label="Issues" value={issues.total} sub={issueParts.join(" · ")} />
        <StatCard
          label="Pending proofs"
          value={data.proofs_pending}
          onClick={() => onNavigate && onNavigate("proofs")}
          actionLabel="Review proofs"
        />
        <StatCard label="Messages" value={data.messages_total} />
      </div>

      <article className="adm-card adm-section-card" aria-labelledby="adm-activity-title">
        <h2 className="adm-card-title" id="adm-activity-title">Recent activity</h2>

        {activity.length === 0 ? (
          <p className="adm-muted">Nothing has happened yet.</p>
        ) : (
          <ul className="adm-activity-list">
            {activity.map((item, index) => {
              const key = `${item.type}-${item.ref_id}-${item.at}-${index}`;
              const label = ACTIVITY_LABELS[item.type] || "Activity";
              const opening = openingKey === key;

              const content = (
                <>
                  <span className="adm-activity-type">{label}</span>
                  <span className="adm-activity-text">{item.text}</span>
                  <span className="adm-activity-time">
                    {opening ? "Opening…" : formatIST(item.at)}
                  </span>
                </>
              );

              let row;
              if (item.ref_type === "resolution") {
                row = (
                  <button
                    type="button"
                    className="adm-activity-item adm-activity-item--link"
                    onClick={() => openProof(item.ref_id)}
                  >
                    {content}
                  </button>
                );
              } else if (item.ref_type === "event") {
                row = (
                  <button
                    type="button"
                    className="adm-activity-item adm-activity-item--link"
                    onClick={() => openEvent(item, key)}
                    disabled={Boolean(openingKey)}
                    aria-busy={opening}
                  >
                    {content}
                  </button>
                );
              } else {
                // Issues have no page of their own, so they are plain text.
                row = <div className="adm-activity-item">{content}</div>;
              }

              return <li key={key}>{row}</li>;
            })}
          </ul>
        )}
      </article>
    </section>
  );
}

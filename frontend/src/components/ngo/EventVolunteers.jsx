import { useEffect, useState } from "react";
import "./EventVolunteers.css";

const API_BASE = "http://127.0.0.1:8000";

const initials = (name) =>
  name
    ? name
        .split(" ")
        .map((p) => p[0])
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : "";

const formatDate = (iso) => {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};

const splitSkills = (skills) =>
  skills
    ? skills
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

// Event dates come from the backend as naive UTC timestamps.
const hasPassed = (iso) => {
  if (!iso) return false;
  const withZone = /(Z|[+-]\d{2}:?\d{2})$/i.test(iso) ? iso : `${iso}Z`;
  return new Date(withZone).getTime() <= Date.now();
};

export default function EventVolunteers({
  event,
  ngoEmail,
  showToast,
  onBack,
  onConnect,
}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    if (!event || !ngoEmail) return;

    let cancelled = false;

    const url = `${API_BASE}/event-volunteers/${event.id}?ngo_email=${encodeURIComponent(ngoEmail)}`;

    const load = async () => {
      setLoading(true);
      setError("");

      try {
        const res = await fetch(url);

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(
            typeof err.detail === "string" && err.detail
              ? err.detail
              : "Could not load volunteers"
          );
        }

        const json = await res.json();

        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled) setError(err.message || "Could not load volunteers");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    // Silent refresh: no loading state, errors ignored.
    const refresh = async () => {
      if (document.visibilityState === "hidden") return;

      try {
        const res = await fetch(url);

        if (!res.ok) return;

        const json = await res.json();

        if (!cancelled) {
          setData(json);
          setError("");
        }
      } catch {
        // silent
      }
    };

    load();
    const timer = setInterval(refresh, 10000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [event, ngoEmail]);

  const title = data?.title ?? event?.title;
  const status = data?.status ?? event?.status;
  const spots = data ? data.spots_available : event?.spots_available;
  const joinedCount = data ? data.joined_count : event?.joined_count;
  const volunteers = data?.volunteers || [];
  const approvedCount = data ? data.approved_count : event?.approved_count ?? 0;
  const waitingCount = (joinedCount ?? 0) - approvedCount;
  const approvedVolunteers = volunteers.filter((v) => v.approved);
  const joinedVolunteers = volunteers.filter((v) => !v.approved);

  const isPast = hasPassed(event?.event_date);
  const allFilled = spots != null && approvedCount >= spots;

  let approveBlockedReason = "";
  if (status && status !== "Active") approveBlockedReason = "Event is not active";
  else if (isPast) approveBlockedReason = "This event has already passed";
  else if (allFilled) approveBlockedReason = "All spots are filled";

  // Same fetch as the 10-second refresh: no loading state, errors ignored.
  const reloadSilently = async () => {
    try {
      const res = await fetch(
        `${API_BASE}/event-volunteers/${event.id}?ngo_email=${encodeURIComponent(ngoEmail)}`
      );

      if (!res.ok) return;

      const json = await res.json();
      setData(json);
      setError("");
    } catch {
      // silent
    }
  };

  const changeApproval = async (v, action) => {
    if (busyId !== null) return;

    const failure =
      action === "approve"
        ? "Could not approve this volunteer"
        : "Could not move this volunteer back";

    setBusyId(v.volunteer_id);

    try {
      const res = await fetch(
        `${API_BASE}/event-volunteers/${event.id}/${v.volunteer_id}/${action}?ngo_email=${encodeURIComponent(ngoEmail)}`,
        { method: "POST" }
      );

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(
          typeof err.detail === "string" && err.detail ? err.detail : failure
        );
      }

      showToast(
        action === "approve"
          ? `${v.name} approved`
          : `${v.name} moved back to joined volunteers`,
        "success"
      );
      await reloadSilently();
    } catch (err) {
      showToast(err.message || failure, "error");
    } finally {
      setBusyId(null);
    }
  };

  const handleRemove = (v) => {
    if (!window.confirm(`Move ${v.name} back to joined volunteers?`)) return;
    changeApproval(v, "unapprove");
  };

  const renderCard = (v) => (
    <div className="ev-vol-card" key={v.volunteer_id}>
      <div className="ev-vol-avatar">{initials(v.name)}</div>

      <div className="ev-vol-info">
        <div className="ev-vol-name-row">
          <p className="ev-vol-name">{v.name}</p>
          {v.approved && <span className="ev-vol-approved-pill">Approved</span>}
        </div>
        <p className="ev-vol-meta">{v.location || "No location"}</p>
        <p className="ev-vol-meta">{v.email}</p>

        {v.experience && (
          <p className="ev-vol-meta">{v.experience}</p>
        )}

        {splitSkills(v.skills).length > 0 && (
          <div className="ev-vol-chips">
            {splitSkills(v.skills).map((skill) => (
              <span className="ev-vol-chip" key={skill}>
                {skill}
              </span>
            ))}
          </div>
        )}

        <p className="ev-vol-meta">
          Events attended: {v.events_attended}
        </p>
        <p className="ev-vol-meta">
          Joined on {formatDate(v.joined_at)}
        </p>
      </div>

      <div className="ev-vol-actions">
        <button
          type="button"
          className="ev-vol-connect-btn"
          onClick={() => onConnect({ email: v.email, name: v.name })}
        >
          Connect
        </button>

        {v.approved && !isPast && (
          <button
            type="button"
            className="ev-vol-remove-btn"
            disabled={busyId !== null}
            onClick={() => handleRemove(v)}
          >
            Remove
          </button>
        )}

        {!v.approved && (
          <button
            type="button"
            className="ev-vol-approve-btn"
            disabled={busyId !== null || approveBlockedReason !== ""}
            title={approveBlockedReason || undefined}
            onClick={() => changeApproval(v, "approve")}
          >
            Approve
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="ev-vol-page">
      <button type="button" className="ev-vol-back-btn" onClick={onBack}>
        ← Back to dashboard
      </button>

      <div className="ev-vol-header">
        <div className="ev-vol-title-row">
          <h2 className="ev-vol-title">{title}</h2>
          {status && <span className="ev-vol-status">{status}</span>}
        </div>

        {data && (
          <p className="ev-vol-count">
            {spots != null
              ? `${approvedCount} of ${spots} approved · ${waitingCount} waiting`
              : `${approvedCount} approved · ${waitingCount} waiting`}
          </p>
        )}
      </div>

      {loading && <p className="ev-vol-message">Loading volunteers...</p>}

      {!loading && error && !data && (
        <p className="ev-vol-message ev-vol-error">{error}</p>
      )}

      {data && (
        <>
          <h3 className="ev-vol-section-title">Approved volunteers</h3>

          {approvedVolunteers.length === 0 ? (
            <p className="ev-vol-message">No volunteers approved yet</p>
          ) : (
            <div className="ev-vol-list">
              {approvedVolunteers.map(renderCard)}
            </div>
          )}

          <h3 className="ev-vol-section-title">Joined volunteers</h3>

          {joinedVolunteers.length === 0 ? (
            <p className="ev-vol-message">No volunteers waiting for approval</p>
          ) : (
            <div className="ev-vol-list">
              {joinedVolunteers.map(renderCard)}
            </div>
          )}
        </>
      )}
    </div>
  );
}

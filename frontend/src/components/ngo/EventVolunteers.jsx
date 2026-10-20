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
              ? `${joinedCount} of ${spots} volunteers joined`
              : `${joinedCount} volunteers joined`}
          </p>
        )}
      </div>

      {loading && <p className="ev-vol-message">Loading volunteers...</p>}

      {!loading && error && !data && (
        <p className="ev-vol-message ev-vol-error">{error}</p>
      )}

      {!loading && data && volunteers.length === 0 && (
        <p className="ev-vol-message">No volunteers joined yet</p>
      )}

      {data && volunteers.length > 0 && (
        <div className="ev-vol-list">
          {volunteers.map((v) => (
            <div className="ev-vol-card" key={v.volunteer_id}>
              <div className="ev-vol-avatar">{initials(v.name)}</div>

              <div className="ev-vol-info">
                <p className="ev-vol-name">{v.name}</p>
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

              <button
                type="button"
                className="ev-vol-connect-btn"
                onClick={() => onConnect({ email: v.email, name: v.name })}
              >
                Connect
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

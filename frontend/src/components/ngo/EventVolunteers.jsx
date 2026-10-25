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

const EMPTY_DRAFT = { attendance: "", rating: 0, feedback: "" };

const FEEDBACK_MAX = 1000;

const renderStars = (rating) =>
  "★".repeat(rating || 0) + "☆".repeat(5 - (rating || 0));

// Read-only result for a volunteer whose feedback has been submitted.
function FeedbackResult({ volunteer }) {
  if (volunteer.attendance_status === "attended") {
    return (
      <div className="ev-fb-result">
        <span className="ev-fb-pill ev-fb-pill-attended">Attended</span>
        <p className="ev-fb-stars" aria-label={`${volunteer.rating} out of 5 stars`}>
          {renderStars(volunteer.rating)}
        </p>
        {volunteer.feedback && (
          <p className="ev-fb-text">{volunteer.feedback}</p>
        )}
      </div>
    );
  }

  return (
    <div className="ev-fb-result">
      <span className="ev-fb-pill ev-fb-pill-absent">Not attended</span>
    </div>
  );
}

// Controlled by the parent: drafts live in EventVolunteers state so they
// survive the 10-second data refresh.
function FeedbackForm({ volunteer, draft, busy, onChange, onSubmit }) {
  const { attendance, rating, feedback } = draft;
  const name = `attendance-${volunteer.volunteer_id}`;

  const canSubmit =
    !busy &&
    (attendance === "not_attended" ||
      (attendance === "attended" && rating >= 1 && feedback.trim() !== ""));

  return (
    <div className="ev-fb-form">
      <div className="ev-fb-radios" role="radiogroup" aria-label="Attendance">
        <label className="ev-fb-radio">
          <input
            type="radio"
            name={name}
            value="attended"
            checked={attendance === "attended"}
            onChange={() => onChange({ attendance: "attended" })}
          />
          Attended
        </label>
        <label className="ev-fb-radio">
          <input
            type="radio"
            name={name}
            value="not_attended"
            checked={attendance === "not_attended"}
            onChange={() => onChange({ attendance: "not_attended" })}
          />
          Not attended
        </label>
      </div>

      {attendance === "attended" && (
        <>
          <div className="ev-fb-star-row">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                className={`ev-fb-star ${n <= rating ? "filled" : ""}`}
                aria-label={n === 1 ? "1 star" : `${n} stars`}
                aria-pressed={n <= rating}
                onClick={() => onChange({ rating: n })}
              >
                {n <= rating ? "★" : "☆"}
              </button>
            ))}
          </div>

          <textarea
            className="ev-fb-textarea"
            placeholder="Write feedback for this volunteer"
            maxLength={FEEDBACK_MAX}
            rows={3}
            value={feedback}
            onChange={(e) => onChange({ feedback: e.target.value })}
          />
          <p className="ev-fb-counter">
            {feedback.length}/{FEEDBACK_MAX}
          </p>
        </>
      )}

      {attendance === "not_attended" && (
        <p className="ev-fb-note">No rating or feedback is needed.</p>
      )}

      <button
        type="button"
        className="ev-fb-submit-btn"
        disabled={!canSubmit}
        onClick={onSubmit}
      >
        Submit feedback
      </button>
    </div>
  );
}

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
  // Feedback drafts keyed by volunteer_id. The refresh only replaces `data`.
  const [drafts, setDrafts] = useState({});

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

  const completed = data ? data.is_completed : !!event?.is_completed;
  const ratedCount = approvedVolunteers.filter((v) => v.attendance_status).length;

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

  const updateDraft = (volunteerId, patch) => {
    setDrafts((prev) => ({
      ...prev,
      [volunteerId]: { ...(prev[volunteerId] || EMPTY_DRAFT), ...patch },
    }));
  };

  const submitFeedback = async (v) => {
    const draft = drafts[v.volunteer_id];

    if (!draft || busyId !== null) return;

    if (
      !window.confirm(
        `Submit feedback for ${v.name}? It cannot be changed afterwards.`
      )
    ) {
      return;
    }

    const body =
      draft.attendance === "attended"
        ? {
            attendance: "attended",
            rating: draft.rating,
            feedback: draft.feedback.trim(),
          }
        : { attendance: "not_attended" };

    setBusyId(v.volunteer_id);

    try {
      const res = await fetch(
        `${API_BASE}/event-volunteers/${event.id}/${v.volunteer_id}/feedback?ngo_email=${encodeURIComponent(ngoEmail)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(
          typeof err.detail === "string" && err.detail
            ? err.detail
            : "Could not save feedback"
        );
      }

      showToast("Feedback saved", "success");
      setDrafts((prev) => {
        const { [v.volunteer_id]: removed, ...rest } = prev;
        return rest;
      });
      await reloadSilently();
    } catch (err) {
      showToast(err.message || "Could not save feedback", "error");
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

        {completed && v.approved && (
          v.attendance_status ? (
            <FeedbackResult volunteer={v} />
          ) : (
            <FeedbackForm
              volunteer={v}
              draft={drafts[v.volunteer_id] || EMPTY_DRAFT}
              busy={busyId !== null}
              onChange={(patch) => updateDraft(v.volunteer_id, patch)}
              onSubmit={() => submitFeedback(v)}
            />
          )
        )}
      </div>

      <div className="ev-vol-actions">
        <button
          type="button"
          className="ev-vol-connect-btn"
          onClick={() => onConnect({ email: v.email, name: v.name })}
        >
          Connect
        </button>

        {v.approved && !isPast && !completed && (
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
            {completed
              ? `${approvedCount} approved · ${ratedCount} rated`
              : spots != null
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
          <h3 className="ev-vol-section-title">
            {completed ? "Volunteers to rate" : "Approved volunteers"}
          </h3>

          {approvedVolunteers.length === 0 ? (
            <p className="ev-vol-message">
              {completed
                ? "No volunteers were approved for this event."
                : "No volunteers approved yet"}
            </p>
          ) : (
            <div className="ev-vol-list">
              {approvedVolunteers.map(renderCard)}
            </div>
          )}

          {!completed && (
            <>
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
        </>
      )}
    </div>
  );
}

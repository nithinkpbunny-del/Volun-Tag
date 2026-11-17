import { useEffect, useState } from "react";
import "./EventVolunteers.css";
import { API_BASE } from "../../config";
import { authFetch } from "../../api";
import PhaseBadge from "../PhaseBadge";
import { Badge, Chips, EmptyState, Icon, Progress, SkeletonList } from "../ui/ui";
import {
  formatEventDay,
  formatTimestampDate,
  isCompletedPhase,
  isOpenPhase,
} from "../../dates";

const initials = (name) =>
  name
    ? name
        .split(" ")
        .map((p) => p[0])
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : "";

// joined_at is a server timestamp (naive UTC), shown as an IST date.
const formatDate = (iso) => formatTimestampDate(iso);

const EMPTY_DRAFT = { attendance: "", rating: 0, feedback: "" };

const FEEDBACK_MAX = 1000;

// Read-only result for a volunteer whose feedback has been submitted.
function FeedbackResult({ volunteer }) {
  if (volunteer.attendance_status === "attended") {
    return (
      <div className="ev-fb-result">
        <div className="ev-fb-result-head">
          <Badge tone="success" dot>Attended</Badge>
          <p className="ev-fb-stars">
            <span className="sr-only">{volunteer.rating} out of 5 stars</span>
            <span className="rating-stars" aria-hidden="true">
              {"★".repeat(volunteer.rating || 0)}
              <span className="rating-stars__empty">{"★".repeat(5 - (volunteer.rating || 0))}</span>
            </span>
          </p>
        </div>
        {volunteer.feedback && (
          <p className="ev-fb-text">{volunteer.feedback}</p>
        )}
      </div>
    );
  }

  return (
    <div className="ev-fb-result">
      <Badge tone="warning" dot>Not attended</Badge>
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
      <p className="ev-fb-form-title">Rate attendance</p>
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
          <div className="ev-fb-star-row" role="group" aria-label="Rating">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                className={`ev-fb-star ${n <= rating ? "filled" : ""}`}
                aria-label={n === 1 ? "1 star" : `${n} stars`}
                aria-pressed={n <= rating}
                onClick={() => onChange({ rating: n })}
              >
                ★
              </button>
            ))}
          </div>

          <textarea
            className="ui-textarea ev-fb-textarea"
            aria-label={`Feedback for ${volunteer.name}`}
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

      <div className="ev-fb-submit-row">
        <button
          type="button"
          className="ui-btn ui-btn--primary"
          disabled={!canSubmit}
          onClick={onSubmit}
        >
          Submit feedback
        </button>
        <span className="ui-hint">Feedback cannot be changed after you submit it.</span>
      </div>
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

    const url = `${API_BASE}/event-volunteers/${event.id}`;

    const load = async () => {
      setLoading(true);
      setError("");

      try {
        const res = await authFetch(url);

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
        const res = await authFetch(url);

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

  // The phase comes from the server (IST); the browser never works it out.
  const phase = (data && data.phase) || event?.phase;
  const eventDay = data ? data.event_day : event?.event_day;
  const completed = isCompletedPhase(phase);
  // Approve and Remove are possible only before the event day starts.
  const registrationOpen = isOpenPhase(phase);
  const ratedCount = approvedVolunteers.filter((v) => v.attendance_status).length;

  const allFilled = spots != null && approvedCount >= spots;

  let approveBlockedReason = "";
  if (status && status !== "Active") approveBlockedReason = "Event is not active";
  else if (!registrationOpen) approveBlockedReason = "Registration for this event has closed";
  else if (allFilled) approveBlockedReason = "All spots are filled";

  // Same fetch as the 10-second refresh: no loading state, errors ignored.
  const reloadSilently = async () => {
    try {
      const res = await authFetch(
        `${API_BASE}/event-volunteers/${event.id}`
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
      const res = await authFetch(
        `${API_BASE}/event-volunteers/${event.id}/${v.volunteer_id}/${action}`,
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
      const res = await authFetch(
        `${API_BASE}/event-volunteers/${event.id}/${v.volunteer_id}/feedback`,
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
      <div className="ev-vol-avatar" aria-hidden="true">{initials(v.name)}</div>

      <div className="ev-vol-info">
        <div className="ev-vol-name-row">
          <p className="ev-vol-name">{v.name}</p>
          {v.approved && <Badge tone="success">Approved</Badge>}
        </div>
        <p className="ev-vol-meta">{v.location || "No location"}</p>
        <p className="ev-vol-meta">{v.email}</p>

        {v.experience && (
          <p className="ev-vol-meta">{v.experience}</p>
        )}

        <Chips items={v.skills} label="Skills" />

        <p className="ev-vol-meta">
          Events attended: {v.events_attended} · Joined on {formatDate(v.joined_at)}
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
          className="ui-btn ui-btn--sm"
          onClick={() => onConnect({ email: v.email, name: v.name })}
        >
          <Icon name="chat" size={15} />
          Connect
        </button>

        {v.approved && registrationOpen && (
          <button
            type="button"
            className="ui-btn ui-btn--danger ui-btn--sm"
            disabled={busyId !== null}
            onClick={() => handleRemove(v)}
          >
            Remove
          </button>
        )}

        {!v.approved && registrationOpen && (
          <button
            type="button"
            className="ui-btn ui-btn--primary ui-btn--sm"
            disabled={busyId !== null || approveBlockedReason !== ""}
            title={approveBlockedReason || undefined}
            onClick={() => changeApproval(v, "approve")}
          >
            <Icon name="check" size={15} />
            Approve
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="ev-vol-page">
      <button type="button" className="ui-btn ui-btn--ghost ev-vol-back-btn" onClick={onBack}>
        <Icon name="arrowLeft" />
        Back to dashboard
      </button>

      <div className="ev-vol-header">
        <div className="ev-vol-title-row">
          <h1 className="ev-vol-title">{title}</h1>
          <div className="ev-vol-badges">
            {status !== "Cancelled" && <PhaseBadge phase={phase} />}
            {/* "Active" says nothing once the event is over. */}
            {status && !(completed && status === "Active") && (
              <Badge
                tone={status === "Cancelled" ? "danger" : status === "Filled" ? "info" : "neutral"}
                dot={status === "Active"}
              >
                {status}
              </Badge>
            )}
          </div>
        </div>

        <ul className="event-card__meta">
          <li>
            <Icon name="calendar" />
            <span>{formatEventDay(eventDay)}</span>
          </li>
        </ul>

        {data && (
          <div className="ev-vol-progress">
            {completed ? (
              <Progress
                value={ratedCount}
                total={approvedCount}
                tone={ratedCount >= approvedCount ? "" : "muted"}
                label={
                  <>
                    <strong>{approvedCount}</strong> approved · <strong>{ratedCount}</strong> rated
                  </>
                }
              />
            ) : (
              <Progress
                value={approvedCount}
                total={spots != null ? spots : undefined}
                label={
                  spots != null ? (
                    <>
                      <strong>
                        {approvedCount} of {spots}
                      </strong>{" "}
                      approved
                    </>
                  ) : (
                    <>
                      <strong>{approvedCount}</strong> approved
                    </>
                  )
                }
                detail={`${waitingCount} waiting`}
              />
            )}
          </div>
        )}
      </div>

      {loading && <SkeletonList count={3} label="Loading volunteers" />}

      {!loading && error && !data && (
        <p className="ui-alert ui-alert--danger" role="alert">{error}</p>
      )}

      {data && (
        <>
          <h2 className="ev-vol-section-title">
            {completed ? "Volunteers to rate" : "Approved volunteers"}
          </h2>

          {approvedVolunteers.length === 0 ? (
            <EmptyState icon="users" title={completed ? "Nobody to rate" : "No volunteers approved yet"}>
              {completed
                ? "No volunteers were approved for this event."
                : "Approve volunteers from the list below."}
            </EmptyState>
          ) : (
            <div className="ev-vol-list">
              {approvedVolunteers.map(renderCard)}
            </div>
          )}

          {!completed && (
            <>
              <h2 className="ev-vol-section-title">Joined volunteers</h2>

              {!registrationOpen && joinedVolunteers.length > 0 && (
                <p className="ui-alert ui-alert--warning">
                  Registration closed when the event day started, so these volunteers can no
                  longer be approved.
                </p>
              )}

              {joinedVolunteers.length === 0 ? (
                <EmptyState icon="inbox" title="No volunteers waiting for approval">
                  Volunteers who join this event appear here.
                </EmptyState>
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

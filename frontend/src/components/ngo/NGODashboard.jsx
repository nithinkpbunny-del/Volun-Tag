import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import Messages from "../messaging/Messages";
import AuthImage from "../AuthImage";
import EventCard from "./EventCard";
import AccountSettings from "../settings/AccountSettings";
import { Badge, EmptyState, Icon, SkeletonList } from "../ui/ui";
import "./NGODashboard.css";
import { API_BASE } from "../../config";
import { authFetch, errorText, openAuthedFile } from "../../api";
import { PATHS } from "../../routes";
import {
  eventDayInputValue,
  formatTimestampDate,
  isCompletedPhase,
  tomorrowInIST,
} from "../../dates";
import { safeExternalUrl } from "../../safeUrl";

// Tabs, in the order shown; the current one is kept in the address (?tab=).
export const NGO_TABS = ["profile", "events", "problems", "messages", "activity", "settings"];
const DEFAULT_TAB = "profile";

const ISSUE_TONES = {
  Reported: "info",
  "Under evaluation": "warning",
  "Proof rejected": "danger",
};

const verificationTone = (status) =>
  status === "Approved" ? "success" : status === "Rejected" ? "danger" : "warning";

// How long a newly created event stays highlighted.
const NEW_EVENT_HIGHLIGHT_MS = 8000;

// One clickable thumbnail; hidden entirely if the image cannot be loaded.
function PhotoThumb({ src, alt, caption, onOpenError }) {
  const [failed, setFailed] = useState(false);

  if (failed) return null;

  return (
    <div className="ngo-photo-item">
      <AuthImage
        className="ngo-photo-thumb"
        src={src}
        alt={alt}
        onFail={() => setFailed(true)}
        onOpenError={onOpenError}
      />
      {caption && <span className="ngo-photo-caption">{caption}</span>}
    </div>
  );
}

// The labelled fields of the create and edit event forms.
function EventFormFields({ idPrefix, formData, onField, minDate }) {
  const id = (name) => `${idPrefix}-${name}`;

  return (
    <>
      <div className="ui-field">
        <label htmlFor={id("title")}>
          Event title <span className="required">*</span>
        </label>
        <input
          id={id("title")}
          type="text"
          className="ui-input"
          value={formData.title}
          onChange={onField("title")}
          required
        />
      </div>

      <div className="ui-field">
        <label htmlFor={id("skills")}>
          Required skills <span className="required">*</span>
        </label>
        <input
          id={id("skills")}
          type="text"
          className="ui-input"
          placeholder="For example: teaching, first aid"
          value={formData.required_skills}
          onChange={onField("required_skills")}
          required
        />
      </div>

      <div className="ui-field">
        <label htmlFor={id("location")}>Location</label>
        <input
          id={id("location")}
          type="text"
          className="ui-input"
          value={formData.location}
          onChange={onField("location")}
        />
      </div>

      <div className="ui-field">
        <label htmlFor={id("date")}>Event date</label>
        <input
          id={id("date")}
          type="date"
          className="ui-input"
          min={minDate}
          value={formData.event_date}
          onChange={onField("event_date")}
          aria-describedby={id("date-hint")}
        />
        <span className="ui-hint" id={id("date-hint")}>
          Registration closes when the event day starts (India time), so pick tomorrow or later.
        </span>
      </div>

      <div className="ui-field">
        <label htmlFor={id("spots")}>Spots available</label>
        <input
          id={id("spots")}
          type="number"
          className="ui-input"
          placeholder="Leave empty for no limit"
          min="1"
          value={formData.spots_available}
          onChange={onField("spots_available")}
        />
      </div>
    </>
  );
}

const EMPTY_EVENT = {
  title: "",
  required_skills: "",
  location: "",
  event_date: "",
  spots_available: "",
};

export default function NGODashboard({
  email,
  showToast,
  onViewVolunteers,
  onMarkSolved,
  initialChat,
  onInitialConsumed,
  onAccountDeactivated,
}) {
  const navigate = useNavigate();
  // navigate changes whenever the address does; keep it out of effect
  // dependencies so the data below is not reloaded by a navigation.
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  const [profile, setProfile] = useState(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const activeTab = NGO_TABS.includes(tabParam) ? tabParam : DEFAULT_TAB;
  // Each tab change is a history entry, so Back returns to the previous tab.
  const setActiveTab = (tab) => {
    if (tab === activeTab) return;
    setSearchParams(tab === DEFAULT_TAB ? {} : { tab });
  };
  const [unreadCount, setUnreadCount] = useState(0);
  // A chat chosen on the event volunteers screen opens once on arrival.
  const [chatTarget, setChatTarget] = useState(initialChat || null);

  useEffect(() => {
    if (initialChat) {
      onInitialConsumed && onInitialConsumed();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Poll unread messages while not on Messages tab ───────────────
  useEffect(() => {
    if (!email || activeTab === "messages") {
      return;
    }

    let isSubscribed = true;
    let inFlight = false;

    const fetchUnread = async () => {
      if (inFlight || document.visibilityState === "hidden") return;
      inFlight = true;
      try {
        const res = await authFetch(
          `${API_BASE}/conversations/${encodeURIComponent(email)}`
        );
        if (!res.ok) return;
        const convos = await res.json();
        if (isSubscribed && Array.isArray(convos)) {
          const total = convos.reduce(
            (sum, c) => sum + (Number(c.unread_count) || 0),
            0
          );
          setUnreadCount(total);
        }
      } catch {
        // ignore errors silently
      } finally {
        inFlight = false;
      }
    };

    fetchUnread();
    const intervalId = setInterval(fetchUnread, 8000);

    return () => {
      isSubscribed = false;
      clearInterval(intervalId);
    };
  }, [email, activeTab]);

  // Events tab state
  const [events, setEvents] = useState([]);
  const [loadingEvents, setLoadingEvents] = useState(true);
  // The event created a moment ago: shown with a short highlight.
  const [newEventId, setNewEventId] = useState(null);
  const highlightTimerRef = useRef(null);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({ ...EMPTY_EVENT });
  const [submitting, setSubmitting] = useState(false);
  const [editingEventId, setEditingEventId] = useState(null);

  // Reported-problems tab state
  const [issues, setIssues] = useState([]);
  const [loadingIssues, setLoadingIssues] = useState(true);
  const [expandedIssue, setExpandedIssue] = useState(null);
  const [expandedSolved, setExpandedSolved] = useState(null);

  // ── Fetch profile ───────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    const fetchProfile = async () => {
      setLoadingProfile(true);

      try {
        const res = await authFetch(
          `${API_BASE}/ngo-dashboard/${encodeURIComponent(email)}`
        );

        if (!res.ok) {
          throw new Error("Could not load your profile");
        }

        const data = await res.json();

        if (!cancelled) {
          setProfile(data);
        }
      } catch (err) {
        if (!cancelled) {
          showToast(err.message || "Unable to load dashboard", "error");
          // Still logged in, so /login must show the form (showLogin), not
          // send the user back to this dashboard.
          navigateRef.current(PATHS["dashboard-login"], {
            replace: true,
            state: { showLogin: true },
          });
        }
      } finally {
        if (!cancelled) {
          setLoadingProfile(false);
        }
      }
    };

    fetchProfile();

    return () => {
      cancelled = true;
    };
  }, [email, showToast]);

  useEffect(() => () => clearTimeout(highlightTimerRef.current), []);

  // ── Fetch events ────────────────────────────────────────────────
  const fetchEvents = async () => {
    setLoadingEvents(true);

    try {
      const res = await authFetch(
        `${API_BASE}/ngo-events/${encodeURIComponent(email)}?include_cancelled=true`
      );

      if (!res.ok) throw new Error("Could not load events");

      const data = await res.json();
      setEvents(data.events || []);
    } catch {
      // Non-critical — silently degrade
    } finally {
      setLoadingEvents(false);
    }
  };

  useEffect(() => {
    if (!email) return;

    let cancelled = false;

    const load = async () => {
      setLoadingEvents(true);

      try {
        const res = await authFetch(
          `${API_BASE}/ngo-events/${encodeURIComponent(email)}?include_cancelled=true`
        );

        if (!res.ok) throw new Error();

        const data = await res.json();

        if (!cancelled) {
          setEvents(data.events || []);
        }
      } catch {
        // silent
      } finally {
        if (!cancelled) setLoadingEvents(false);
      }
    };

    load();

    return () => {
      cancelled = true;
    };
  }, [email]);

  // Silent refresh so joined counts stay live (no loading flicker, no toasts).
  // editingEventId is a dependency so the tick can skip while the Edit form is open.
  useEffect(() => {
    if (!email) return;

    let cancelled = false;

    const refresh = async () => {
      if (editingEventId !== null) return;
      if (document.visibilityState === "hidden") return;

      try {
        const res = await authFetch(
          `${API_BASE}/ngo-events/${encodeURIComponent(email)}?include_cancelled=true`
        );

        if (!res.ok) return;

        const data = await res.json();

        if (!cancelled) {
          setEvents(data.events || []);
        }
      } catch {
        // silent
      }
    };

    const timer = setInterval(refresh, 10000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [email, editingEventId]);

  // ── Fetch reported problems ─────────────────────────────────────
  useEffect(() => {
    if (!email) return;

    let cancelled = false;

    // The first call shows the loading state; later (silent) calls do not.
    const loadIssues = async (silent) => {
      if (!silent) setLoadingIssues(true);

      try {
        const res = await authFetch(
          `${API_BASE}/ngo-issues/${encodeURIComponent(email)}`
        );

        if (!res.ok) throw new Error();

        const data = await res.json();

        if (!cancelled) {
          setIssues(data.issues || []);
        }
      } catch {
        // silent
      } finally {
        if (!silent && !cancelled) setLoadingIssues(false);
      }
    };

    loadIssues(false);

    // Silent refresh so proof statuses stay live (no loading flicker, no toasts).
    const timer = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      loadIssues(true);
    }, 10000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [email]);

  // ── Organize event submit ───────────────────────────────────────
  const handleOrganize = async (e) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      const body = {
        title: formData.title.trim(),
        required_skills: formData.required_skills.trim(),
        location: formData.location.trim() || "",
        // The day exactly as picked ("YYYY-MM-DD"); no time zone involved.
        event_date: formData.event_date || null,
        spots_available: formData.spots_available
          ? Number(formData.spots_available)
          : null,
      };

      const res = await authFetch(
        `${API_BASE}/organize-event/${encodeURIComponent(email)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(errorText(err, "Failed to create event"));
      }

      const created = await res.json().catch(() => null);

      showToast("Event created successfully!", "success");
      setFormData({ ...EMPTY_EVENT });
      setShowForm(false);
      await fetchEvents();

      if (created && created.id != null) {
        setNewEventId(created.id);
        clearTimeout(highlightTimerRef.current);
        highlightTimerRef.current = setTimeout(() => setNewEventId(null), NEW_EVENT_HIGHLIGHT_MS);
      }
    } catch (err) {
      showToast(err.message || "Failed to create event", "error");
    } finally {
      setSubmitting(false);
    }
  };

  // ── Update event (partial edit) ─────────────────────────────────
  const handleUpdateEvent = async (e) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      const body = {
        title: formData.title.trim(),
        required_skills: formData.required_skills.trim(),
        location: formData.location.trim() || "",
        // The day exactly as picked ("YYYY-MM-DD"); no time zone involved.
        event_date: formData.event_date || null,
        spots_available: formData.spots_available
          ? Number(formData.spots_available)
          : null,
      };

      const res = await authFetch(
        `${API_BASE}/update-event/${editingEventId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(errorText(err, "Failed to update event"));
      }

      showToast("Event updated successfully!", "success");
      setEditingEventId(null);
      setFormData({ ...EMPTY_EVENT });
      await fetchEvents();
    } catch (err) {
      showToast(err.message || "Failed to update event", "error");
    } finally {
      setSubmitting(false);
    }
  };

  // ── Cancel event ────────────────────────────────────────────────
  const handleCancel = async (eventId) => {
    try {
      const res = await authFetch(`${API_BASE}/event-status/${eventId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "Cancelled" }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Failed to cancel event");
      }

      showToast("Event cancelled", "success");
      await fetchEvents();
    } catch (err) {
      showToast(err.message || "Failed to cancel event", "error");
    }
  };

  // ── Mark event filled / reopen event ────────────────────────────
  const handleSetEventStatus = async (eventId, status, successMessage) => {
    try {
      const res = await authFetch(`${API_BASE}/event-status/${eventId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(
          typeof err.detail === "string" && err.detail
            ? err.detail
            : "Could not update the event"
        );
      }

      showToast(successMessage, "success");
      // PATCH replies carry no correct joined_count, so always refetch.
      await fetchEvents();
    } catch (err) {
      showToast(err.message || "Could not update the event", "error");
    }
  };

  // ── Helpers ─────────────────────────────────────────────────────
  const initials = (name) =>
    name
      ? name
          .split(" ")
          .map((p) => p[0])
          .slice(0, 2)
          .join("")
          .toUpperCase()
      : "";

  const formatDate = (iso) => formatTimestampDate(iso);

  // The pill reflects this NGO's own proof, never the shared issue status.
  const issuePillLabel = (iss) => {
    if (iss.resolution_status === "Under evaluation") return "Under evaluation";
    if (iss.resolution_status === "Rejected") return "Proof rejected";
    return "Reported";
  };

  // Paths only: AuthImage and openAuthedFile fetch them with the login token.
  const issuePhotoPath = (complaintId, index) =>
    `/issue-files/issue/${encodeURIComponent(complaintId)}/${index}`;

  const resolutionFilePath = (resolutionId, kind) =>
    `/issue-files/resolution/${resolutionId}/${kind}`;

  const onField = (field) => (e) =>
    setFormData((prev) => ({ ...prev, [field]: e.target.value }));

  // ── Loading state ───────────────────────────────────────────────
  if (loadingProfile) {
    return (
      <div className="page dashboard-page">
        <div className="dashboard-shell">
          <SkeletonList count={3} label="Loading your dashboard" />
        </div>
      </div>
    );
  }

  if (!profile) {
    return null;
  }

  // Completed events (phase from the server) move to the Activities tab;
  // cancelled ones stay in Events.
  const isDone = (ev) => isCompletedPhase(ev.phase) && ev.status !== "Cancelled";
  const completedEvents = events.filter(isDone);
  const listedEvents = events.filter((ev) => !isDone(ev));
  const minEventDay = tomorrowInIST();
  const photoOpenError = () =>
    showToast("Could not open the photo. Please try again.", "error");

  // Open problems stay in Reported Problems; problems this NGO solved move to Activities.
  const openIssues = issues.filter((iss) => !iss.solved);
  const solvedIssues = issues.filter((iss) => iss.solved && iss.solved_by_me);

  // Real numbers for the profile sidebar, all from the lists already loaded.
  const activeEventCount = listedEvents.filter((ev) => ev.status !== "Cancelled").length;
  const approvedVolunteerCount = events
    .filter((ev) => ev.status !== "Cancelled")
    .reduce((sum, ev) => sum + (ev.approved_count || 0), 0);

  const tabLabel = (tab) =>
    tab === "problems"
      ? "Reported Problems"
      : tab === "activity"
      ? "Activities"
      : tab.charAt(0).toUpperCase() + tab.slice(1);

  const openForm = () => {
    setEditingEventId(null);
    setFormData({ ...EMPTY_EVENT });
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setFormData({ ...EMPTY_EVENT });
  };

  const startEdit = (ev) => {
    setShowForm(false);
    setEditingEventId(ev.id);
    setFormData({
      title: ev.title || "",
      required_skills: ev.required_skills || "",
      location: ev.location || "",
      event_date: eventDayInputValue(ev.event_day),
      spots_available: ev.spots_available != null ? String(ev.spots_available) : "",
    });
  };

  const renderEditForm = (ev) => (
    <form className="event-form" onSubmit={handleUpdateEvent} aria-label={`Edit ${ev.title}`}>
      <div className="event-form__grid">
        <EventFormFields
          idPrefix={`edit-event-${ev.id}`}
          formData={formData}
          onField={onField}
          // An unchanged earlier day (an event happening today) must stay valid.
          minDate={
            ev.event_day && ev.event_day < minEventDay
              ? eventDayInputValue(ev.event_day)
              : minEventDay
          }
        />
      </div>
      <div className="event-form__actions">
        <button type="submit" className="ui-btn ui-btn--primary" disabled={submitting}>
          {submitting ? "Saving..." : "Save changes"}
        </button>
        <button
          type="button"
          className="ui-btn"
          onClick={() => {
            setEditingEventId(null);
            setFormData({ ...EMPTY_EVENT });
          }}
        >
          Cancel edit
        </button>
      </div>
    </form>
  );

  const renderEventCard = (ev) => (
    <EventCard
      key={ev.id}
      event={ev}
      isNew={ev.id === newEventId}
      editForm={editingEventId === ev.id ? renderEditForm(ev) : null}
      onManage={() => onViewVolunteers && onViewVolunteers(ev)}
      onEdit={() => startEdit(ev)}
      onMarkFilled={() => {
        if (window.confirm("Stop showing this event to volunteers?")) {
          handleSetEventStatus(ev.id, "Filled", "Event marked as filled");
        }
      }}
      onReopen={() => handleSetEventStatus(ev.id, "Active", "Event reopened")}
      onCancel={() => {
        if (window.confirm(`Cancel “${ev.title}”? A cancelled event cannot be reopened.`)) {
          handleCancel(ev.id);
        }
      }}
    />
  );

  const connectIcon = <Icon name="chat" size={15} />;

  return (
    <div className="page dashboard-page">
      <div className="dashboard-shell">
        <h1 className="sr-only">NGO dashboard</h1>

        {/* ── Subnav ──────────────────────────────────────────── */}
        <div className="dashboard-subnav">
          <div className="dashboard-subnav-tabs" role="group" aria-label="Dashboard sections">
            {NGO_TABS.map((tab) => (
              <button
                key={tab}
                type="button"
                className={`dashboard-subnav-tab ${activeTab === tab ? "active" : ""}`}
                aria-current={activeTab === tab ? "page" : undefined}
                onClick={() => {
                  if (tab === "messages") {
                    setChatTarget(null);
                  }
                  setActiveTab(tab);
                }}
              >
                {tabLabel(tab)}
                {tab === "messages" && unreadCount > 0 && (
                  <span className="dashboard-subnav-badge">{unreadCount}</span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* ── Messages tab ─────────────────────────────────────── */}
        {activeTab === "messages" && (
          <div className="msg-tab-wrapper">
            <Messages
              email={email}
              role="ngo"
              showToast={showToast}
              startWith={chatTarget}
              onUnreadChange={setUnreadCount}
            />
          </div>
        )}

        {/* ── Activities tab (completed events, solved problems) ── */}
        {activeTab === "activity" && (
          <>
            <div className="ui-section-head">
              <h2 className="ui-section-title">Completed events</h2>
              <span className="ui-section-sub">{completedEvents.length} total</span>
            </div>

            {loadingEvents && events.length === 0 ? (
              <SkeletonList count={2} label="Loading events" className="event-grid" />
            ) : completedEvents.length === 0 ? (
              <EmptyState icon="calendar" title="No completed events yet">
                Events appear here the day after their date, ready for you to rate the
                volunteers who took part.
              </EmptyState>
            ) : (
              <div className="event-grid">
                {[...completedEvents]
                  // Newest day first ("YYYY-MM-DD" sorts as text).
                  .sort((a, b) => String(b.event_day || "").localeCompare(String(a.event_day || "")))
                  .map(renderEventCard)}
              </div>
            )}

            <div className="ui-section-head">
              <h2 className="ui-section-title">Solved problems</h2>
              <span className="ui-section-sub">{solvedIssues.length} total</span>
            </div>

            {loadingIssues ? (
              <SkeletonList count={2} label="Loading solved problems" />
            ) : solvedIssues.length === 0 ? (
              <EmptyState icon="check" title="No solved problems yet">
                Problems you solve appear here once your proof is verified.
              </EmptyState>
            ) : (
              <div className="dash-list">
                {solvedIssues.map((iss) => {
                  const expanded = expandedSolved === iss.complaint_id;

                  return (
                    <div className="dash-row" key={iss.complaint_id}>
                      <div className="dash-row__main">
                        <div className="dash-row__info">
                          <p className="dash-row__title">{iss.location}</p>
                          <p className="dash-row__meta">
                            Solved on {formatDate(iss.solved_at)} · {iss.complaint_id}
                            {iss.reporter_name ? ` · Reported by ${iss.reporter_name}` : ""}
                          </p>
                        </div>

                        <div className="dash-row__actions">
                          <Badge tone="success">Solved</Badge>
                          <button
                            type="button"
                            className="ui-btn ui-btn--sm"
                            aria-expanded={expanded}
                            onClick={() => setExpandedSolved(expanded ? null : iss.complaint_id)}
                          >
                            {expanded ? "Hide" : "Details"}
                          </button>
                        </div>
                      </div>

                      {expanded && (
                        <div className="dash-row__detail">
                          <dl className="detail-list">
                            <div>
                              <dt>Description</dt>
                              <dd>{iss.user_description}</dd>
                            </div>
                            <div>
                              <dt>Solution</dt>
                              <dd>
                                {iss.solution_type === "document" ? (
                                  <button
                                    type="button"
                                    className="link-button"
                                    onClick={() =>
                                      openAuthedFile(
                                        resolutionFilePath(iss.resolution_id, "document")
                                      ).catch(() => showToast("Could not open the document", "error"))
                                    }
                                  >
                                    Open document ({iss.document_name})
                                  </button>
                                ) : (
                                  iss.solution_text
                                )}
                              </dd>
                            </div>
                          </dl>

                          {iss.resolution_id && (
                            <div className="ngo-photo-list">
                              <PhotoThumb
                                onOpenError={photoOpenError}
                                src={resolutionFilePath(iss.resolution_id, "before")}
                                alt="Before photo"
                                caption="Your before photo"
                              />
                              <PhotoThumb
                                onOpenError={photoOpenError}
                                src={resolutionFilePath(iss.resolution_id, "after")}
                                alt="After photo"
                                caption="Your after photo"
                              />
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* ── Settings ─────────────────────────────────────────── */}
        {activeTab === "settings" && (
          <AccountSettings
            role="ngo"
            email={email}
            showToast={showToast}
            onDeactivated={onAccountDeactivated}
            onOpenEvents={() => setActiveTab("events")}
            onProfileSaved={(saved) => setProfile((prev) => ({ ...prev, ...saved }))}
          />
        )}

        {/* ── Profile tab ─────────────────────────────────────── */}
        {activeTab === "profile" && (
          <>
            <div className="dashboard-profile-strip">
              <div className="dashboard-avatar-circle" aria-hidden="true">
                {initials(profile.name)}
              </div>

              <div className="dashboard-profile-info">
                <p className="dashboard-profile-name">{profile.name}</p>

                {profile.motto && (
                  <p className="dashboard-profile-motto">{profile.motto}</p>
                )}

                <Badge tone={verificationTone(profile.verification_status)} dot>
                  {profile.verification_status}
                </Badge>
              </div>
            </div>

            <div className="dashboard-content-grid">
              {/* Main column — org details */}
              <div className="dashboard-main-col">
                <div className="ui-section-head">
                  <h2 className="ui-section-title">Organization details</h2>
                </div>

                <dl className="ngo-detail-list">
                  <div className="ngo-detail-row">
                    <dt className="ngo-detail-label">Email</dt>
                    <dd className="ngo-detail-value">{profile.email || "—"}</dd>
                  </div>

                  <div className="ngo-detail-row">
                    <dt className="ngo-detail-label">Contact</dt>
                    <dd className="ngo-detail-value">{profile.contact_number || "—"}</dd>
                  </div>

                  <div className="ngo-detail-row">
                    <dt className="ngo-detail-label">Category</dt>
                    <dd className="ngo-detail-value">{profile.category || "—"}</dd>
                  </div>

                  <div className="ngo-detail-row">
                    <dt className="ngo-detail-label">Location</dt>
                    <dd className="ngo-detail-value">{profile.location || "—"}</dd>
                  </div>

                  <div className="ngo-detail-row">
                    <dt className="ngo-detail-label">Legal structure</dt>
                    <dd className="ngo-detail-value">{profile.legal_structure || "—"}</dd>
                  </div>

                  <div className="ngo-detail-row">
                    <dt className="ngo-detail-label">Year founded</dt>
                    <dd className="ngo-detail-value">{profile.year_founded || "—"}</dd>
                  </div>

                  <div className="ngo-detail-row">
                    <dt className="ngo-detail-label">Website</dt>
                    <dd className="ngo-detail-value">
                      {safeExternalUrl(profile.website_url) ? (
                        <a
                          href={safeExternalUrl(profile.website_url)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="ngo-detail-link"
                        >
                          {profile.website_url}
                        </a>
                      ) : (
                        profile.website_url || "—"
                      )}
                    </dd>
                  </div>
                </dl>
              </div>

              {/* Sidebar — real numbers from the lists above */}
              <aside className="dashboard-sidebar-col" aria-label="Your activity">
                <h2 className="dashboard-sidebar-heading">Your activity</h2>

                <div className="ui-stats">
                  <div className="ui-stat">
                    <span className="ui-stat__value">{activeEventCount}</span>
                    <span className="ui-stat__label">Current events</span>
                  </div>

                  <div className="ui-stat">
                    <span className="ui-stat__value">{completedEvents.length}</span>
                    <span className="ui-stat__label">Completed events</span>
                  </div>

                  <div className="ui-stat">
                    <span className="ui-stat__value">{approvedVolunteerCount}</span>
                    <span className="ui-stat__label">Volunteers approved</span>
                  </div>

                  <div className="ui-stat">
                    <span className="ui-stat__value">{solvedIssues.length}</span>
                    <span className="ui-stat__label">Problems solved</span>
                  </div>
                </div>

                <div className="dashboard-side-card">
                  <p className="dashboard-side-card__title">
                    Messages
                    {unreadCount > 0 && <Badge tone="success">{unreadCount} unread</Badge>}
                  </p>
                  <p className="dashboard-side-card__text">
                    Chat directly with volunteers and answer inquiries.
                  </p>
                  <button
                    type="button"
                    className="ui-btn ui-btn--block"
                    onClick={() => {
                      setChatTarget(null);
                      setActiveTab("messages");
                    }}
                  >
                    {connectIcon}
                    Open Messages
                    {unreadCount > 0 && ` (${unreadCount})`}
                  </button>
                </div>
              </aside>
            </div>
          </>
        )}

        {/* ── Events tab ──────────────────────────────────────── */}
        {activeTab === "events" && (
          <>
            <div className="ui-section-head event-toolbar">
              <div>
                <h2 className="ui-section-title">Your events</h2>
                <span className="ui-section-sub">
                  {listedEvents.length} {listedEvents.length === 1 ? "event" : "events"} · completed
                  events move to Activities
                </span>
              </div>

              {!showForm && (
                <button type="button" className="ui-btn ui-btn--primary" onClick={openForm}>
                  <Icon name="plus" />
                  Organize event
                </button>
              )}
            </div>

            {showForm && (
              <form
                className="event-form event-form--new"
                onSubmit={handleOrganize}
                aria-label="Organize an event"
              >
                <div className="event-form__head">
                  <h3 className="event-form__title">Organize an event</h3>
                  <button
                    type="button"
                    className="ui-btn ui-btn--ghost ui-btn--icon"
                    aria-label="Close form"
                    title="Close form"
                    onClick={closeForm}
                  >
                    <Icon name="close" size={18} />
                  </button>
                </div>

                <div className="event-form__grid">
                  <EventFormFields
                    idPrefix="new-event"
                    formData={formData}
                    onField={onField}
                    minDate={minEventDay}
                  />
                </div>

                <div className="event-form__actions">
                  <button type="submit" className="ui-btn ui-btn--primary" disabled={submitting}>
                    {submitting ? "Creating..." : "Create event"}
                  </button>
                  <button type="button" className="ui-btn" onClick={closeForm}>
                    Cancel
                  </button>
                </div>
              </form>
            )}

            {loadingEvents && events.length === 0 ? (
              <SkeletonList count={4} label="Loading events" className="event-grid" />
            ) : listedEvents.length === 0 ? (
              <EmptyState
                icon="calendar"
                title="No events yet"
                action={
                  !showForm && (
                    <button type="button" className="ui-btn ui-btn--primary" onClick={openForm}>
                      <Icon name="plus" />
                      Organize your first event
                    </button>
                  )
                }
              >
                Organize your first event to start connecting with volunteers whose skills match.
              </EmptyState>
            ) : (
              <div className="event-grid">{listedEvents.map(renderEventCard)}</div>
            )}
          </>
        )}

        {/* ── Reported Problems tab ────────────────────────────── */}
        {activeTab === "problems" && (
          <>
            <div className="ui-section-head">
              <h2 className="ui-section-title">Reported problems</h2>
              <span className="ui-section-sub">{openIssues.length} matched to you</span>
            </div>

            {loadingIssues ? (
              <SkeletonList count={3} label="Loading reported problems" />
            ) : openIssues.length === 0 ? (
              <EmptyState icon="flag" title="No reported problems yet">
                When citizens report issues that match your organization, they will appear here.
              </EmptyState>
            ) : (
              <div className="dash-list">
                {openIssues.map((iss) => {
                  const expanded = expandedIssue === iss.complaint_id;
                  const pill = issuePillLabel(iss);

                  return (
                    <div className="dash-row" key={iss.complaint_id}>
                      <div className="dash-row__main">
                        <div className="dash-row__info">
                          <p className="dash-row__title">{iss.location}</p>
                          <p className="dash-row__meta">
                            {formatDate(iss.created_at)} · {iss.complaint_id}
                            {iss.reporter_name ? ` · Reported by ${iss.reporter_name}` : ""}
                          </p>
                        </div>

                        <div className="dash-row__actions">
                          <Badge tone={ISSUE_TONES[pill] || "neutral"}>{pill}</Badge>
                          <Badge tone="success">{iss.match_percentage}% match</Badge>
                          <button
                            type="button"
                            className="ui-btn ui-btn--sm"
                            aria-expanded={expanded}
                            onClick={() => setExpandedIssue(expanded ? null : iss.complaint_id)}
                          >
                            {expanded ? "Hide" : "Details"}
                          </button>
                        </div>
                      </div>

                      {expanded && (
                        <div className="dash-row__detail">
                          <dl className="detail-list">
                            <div>
                              <dt>Description</dt>
                              <dd>{iss.user_description}</dd>
                            </div>
                            <div>
                              <dt>Reporter</dt>
                              <dd>
                                {[iss.reporter_name, iss.reporter_phone, iss.reporter_email]
                                  .filter(Boolean)
                                  .join(" · ") || "—"}
                              </dd>
                            </div>
                            <div>
                              <dt>Problem location</dt>
                              <dd>{iss.location}</dd>
                            </div>
                            <div>
                              <dt>AI image caption</dt>
                              <dd>{iss.ai_image_caption || "No image provided"}</dd>
                            </div>
                            <div>
                              <dt>Detected category</dt>
                              <dd>{iss.ai_scene_category || "—"}</dd>
                            </div>
                            <div>
                              <dt>Confidence</dt>
                              <dd className="detail-list__cap">{iss.confidence}</dd>
                            </div>
                          </dl>

                          {iss.explanation && (
                            <div className="ngo-issue-explanation">
                              <p className="ngo-issue-explanation-label">AI explanation</p>
                              <p className="ngo-issue-explanation-text">{iss.explanation}</p>
                            </div>
                          )}

                          {iss.image_count > 0 && (
                            <div className="ngo-photo-row">
                              <p className="ngo-photo-row-label">Photos</p>
                              <div className="ngo-photo-list">
                                {Array.from({ length: iss.image_count }, (_, index) => (
                                  <PhotoThumb
                                    onOpenError={photoOpenError}
                                    key={index}
                                    src={issuePhotoPath(iss.complaint_id, index)}
                                    alt={`Reported photo ${index + 1}`}
                                  />
                                ))}
                              </div>
                            </div>
                          )}

                          {iss.resolution_id && (
                            <div className="ngo-photo-list">
                              <PhotoThumb
                                onOpenError={photoOpenError}
                                src={resolutionFilePath(iss.resolution_id, "before")}
                                alt="Before photo"
                                caption="Your before photo"
                              />
                              <PhotoThumb
                                onOpenError={photoOpenError}
                                src={resolutionFilePath(iss.resolution_id, "after")}
                                alt="After photo"
                                caption="Your after photo"
                              />
                            </div>
                          )}

                          {iss.resolution_status === "Under evaluation" && (
                            <p className="ui-alert ui-alert--warning">
                              Your proof has been submitted for evaluation. If it is verified and the issue is solved, it will be listed in your Activities section.
                            </p>
                          )}

                          {iss.resolution_status === "Rejected" && (
                            <p className="ui-alert ui-alert--danger">
                              Your proof was not accepted: {iss.reject_reason}
                            </p>
                          )}

                          <div className="dash-row__footer">
                            {!iss.resolution_status && (
                              <button
                                type="button"
                                className="ui-btn ui-btn--primary"
                                onClick={() => onMarkSolved && onMarkSolved(iss)}
                              >
                                <Icon name="check" />
                                Mark as solved
                              </button>
                            )}

                            <button
                              type="button"
                              className="ui-btn dashboard-connect-btn"
                              disabled={!iss.reporter_email}
                              title={
                                !iss.reporter_email
                                  ? "This report has no linked volunteer account"
                                  : (iss.reporter_name ? `Connect with ${iss.reporter_name}` : "Connect with volunteer")
                              }
                              onClick={() => {
                                if (!iss.reporter_email) return;
                                setChatTarget({
                                  email: iss.reporter_email,
                                  name: iss.reporter_name,
                                });
                                setActiveTab("messages");
                              }}
                            >
                              {connectIcon}
                              Connect
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* ── Footer ──────────────────────────────────────────── */}
        <div className="dashboard-footer-actions">
          <button
            className="ui-btn ui-btn--ghost"
            type="button"
            onClick={() => navigate(PATHS.landing)}
          >
            <Icon name="arrowLeft" />
            Back to Home
          </button>
        </div>
      </div>
    </div>
  );
}

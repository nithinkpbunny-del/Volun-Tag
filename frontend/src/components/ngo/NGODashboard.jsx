import { useEffect, useState } from "react";
import Messages from "../messaging/Messages";
import "./NGODashboard.css";

const API_BASE = "http://127.0.0.1:8000";

// One clickable thumbnail; hidden entirely if the image cannot be loaded.
function PhotoThumb({ src, alt, caption }) {
  return (
    <div className="ngo-photo-item">
      <a href={src} target="_blank" rel="noreferrer">
        <img
          className="ngo-photo-thumb"
          src={src}
          alt={alt}
          loading="lazy"
          onError={(e) => {
            e.currentTarget.style.display = "none";
            e.currentTarget.closest(".ngo-photo-item").style.display = "none";
          }}
        />
      </a>
      {caption && <span className="ngo-photo-caption">{caption}</span>}
    </div>
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
  setPage,
  onViewVolunteers,
  onMarkSolved,
  initialTab,
  initialChat,
  onInitialConsumed,
}) {
  const [profile, setProfile] = useState(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  // The dashboard remounts on every page change, so these props only seed the initial state.
  const [activeTab, setActiveTab] = useState(
    initialChat ? "messages" : initialTab || "profile"
  );
  const [unreadCount, setUnreadCount] = useState(0);
  const [chatTarget, setChatTarget] = useState(initialChat || null);

  useEffect(() => {
    if (initialTab || initialChat) {
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
        const res = await fetch(
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
  const [totalEvents, setTotalEvents] = useState(0);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [expandedEvent, setExpandedEvent] = useState(null);
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
    if (!email) {
      setPage("dashboard-login");
      return;
    }

    let cancelled = false;

    const fetchProfile = async () => {
      setLoadingProfile(true);

      try {
        const res = await fetch(
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
          setPage("dashboard-login");
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
  }, [email, setPage, showToast]);

  // ── Fetch events ────────────────────────────────────────────────
  const fetchEvents = async () => {
    setLoadingEvents(true);

    try {
      const res = await fetch(
        `${API_BASE}/ngo-events/${encodeURIComponent(email)}?include_cancelled=true`
      );

      if (!res.ok) throw new Error("Could not load events");

      const data = await res.json();
      setEvents(data.events || []);
      setTotalEvents(data.total_events ?? 0);
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
        const res = await fetch(
          `${API_BASE}/ngo-events/${encodeURIComponent(email)}?include_cancelled=true`
        );

        if (!res.ok) throw new Error();

        const data = await res.json();

        if (!cancelled) {
          setEvents(data.events || []);
          setTotalEvents(data.total_events ?? 0);
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
        const res = await fetch(
          `${API_BASE}/ngo-events/${encodeURIComponent(email)}?include_cancelled=true`
        );

        if (!res.ok) return;

        const data = await res.json();

        if (!cancelled) {
          setEvents(data.events || []);
          setTotalEvents(data.total_events ?? 0);
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
        const res = await fetch(
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
        event_date: formData.event_date
          ? new Date(formData.event_date).toISOString()
          : null,
        spots_available: formData.spots_available
          ? Number(formData.spots_available)
          : null,
      };

      const res = await fetch(
        `${API_BASE}/organize-event/${encodeURIComponent(email)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Failed to create event");
      }

      showToast("Event created successfully!", "success");
      setFormData({ ...EMPTY_EVENT });
      setShowForm(false);
      await fetchEvents();
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
        event_date: formData.event_date
          ? new Date(formData.event_date).toISOString()
          : null,
        spots_available: formData.spots_available
          ? Number(formData.spots_available)
          : null,
      };

      const res = await fetch(
        `${API_BASE}/update-event/${editingEventId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Failed to update event");
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
      const res = await fetch(`${API_BASE}/event-status/${eventId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "Cancelled" }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Failed to cancel event");
      }

      showToast("Event cancelled", "success");
      setExpandedEvent(null);
      await fetchEvents();
    } catch (err) {
      showToast(err.message || "Failed to cancel event", "error");
    }
  };

  // ── Mark event filled / reopen event ────────────────────────────
  const handleSetEventStatus = async (eventId, status, successMessage) => {
    try {
      const res = await fetch(`${API_BASE}/event-status/${eventId}`, {
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

  const verificationClass = (status) => {
    if (status === "Approved") return "dashboard-verification-tag verification-approved";
    if (status === "Rejected") return "dashboard-verification-tag verification-rejected";
    return "dashboard-verification-tag verification-pending";
  };

  const formatDate = (iso) => {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  };

  // The pill reflects this NGO's own proof, never the shared issue status.
  const issuePillLabel = (iss) => {
    if (iss.resolution_status === "Under evaluation") return "Under evaluation";
    if (iss.resolution_status === "Rejected") return "Proof rejected";
    return "Reported";
  };

  const issuePhotoUrl = (complaintId, index) =>
    `${API_BASE}/issue-files/issue/${complaintId}/${index}?email=${encodeURIComponent(email)}`;

  const resolutionFileUrl = (resolutionId, kind) =>
    `${API_BASE}/issue-files/resolution/${resolutionId}/${kind}?email=${encodeURIComponent(email)}`;

  const onField = (field) => (e) =>
    setFormData((prev) => ({ ...prev, [field]: e.target.value }));

  // ── Loading state ───────────────────────────────────────────────
  if (loadingProfile) {
    return (
      <div className="page dashboard-page">
        <div className="dashboard-shell">
          <p className="dashboard-placeholder-text">Loading your dashboard...</p>
        </div>
      </div>
    );
  }

  if (!profile) {
    return null;
  }

  // Count only active events for the stat card
  const activeEventCount = events.filter((ev) => ev.status === "Active").length;

  // Completed (per the backend) events move to the Activities tab; cancelled ones stay in Events.
  const completedEvents = events.filter(
    (ev) => ev.is_completed && ev.status !== "Cancelled"
  );
  const listedEvents = events.filter(
    (ev) => !(ev.is_completed && ev.status !== "Cancelled")
  );

  // Open problems stay in Reported Problems; problems this NGO solved move to Activities.
  const openIssues = issues.filter((iss) => !iss.solved);
  const solvedIssues = issues.filter((iss) => iss.solved && iss.solved_by_me);

  return (
    <div className="page dashboard-page">
      <div className="dashboard-shell">
        {/* ── Subnav ──────────────────────────────────────────── */}
        <div className="dashboard-subnav">
          <div className="dashboard-subnav-tabs">
            {["profile", "events", "problems", "messages", "activity", "settings"].map((tab) => (
              <button
                key={tab}
                type="button"
                className={`dashboard-subnav-tab ${activeTab === tab ? "active" : ""}`}
                onClick={() => {
                  if (tab === "messages") {
                    setChatTarget(null);
                  }
                  setActiveTab(tab);
                }}
              >
                {tab === "problems"
                  ? "Reported Problems"
                  : tab === "activity"
                  ? "Activities"
                  : tab.charAt(0).toUpperCase() + tab.slice(1)}
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

        {/* ── Activities tab (completed events) ───────────────── */}
        {activeTab === "activity" && (
          <>
            <div className="dashboard-section-header">
              <span className="dashboard-section-title">Completed events</span>
              <span className="dashboard-section-sub">
                {completedEvents.length} total
              </span>
            </div>

            <div className="dashboard-ngo-list">
              {loadingEvents && (
                <p className="dashboard-placeholder-text">Loading events...</p>
              )}

              {!loadingEvents && completedEvents.length === 0 && (
                <div className="dashboard-placeholder-card" style={{ marginTop: "0.75rem" }}>
                  <p className="dashboard-placeholder-title">No completed events yet</p>
                  <p className="dashboard-placeholder-text">
                    Events appear here the day after their date.
                  </p>
                </div>
              )}

              {!loadingEvents &&
                [...completedEvents]
                  .sort((a, b) => new Date(b.event_date) - new Date(a.event_date))
                  .map((ev) => (
                    <div className="dashboard-ngo-row" key={ev.id}>
                      <div className="dashboard-ngo-row-main">
                        <div className="dashboard-ngo-info">
                          <p className="dashboard-ngo-name">{ev.title}</p>
                          <p className="dashboard-ngo-meta">
                            {ev.location || "No location"} · {formatDate(ev.event_date)}
                          </p>
                          <p className="dashboard-ngo-meta">
                            {ev.approved_count === 0
                              ? "No approved volunteers"
                              : `Feedback given: ${ev.feedback_count} of ${ev.approved_count}`}
                          </p>
                        </div>

                        <div className="dashboard-ngo-actions">
                          <span className="ngo-event-status-badge status-completed">
                            Completed
                          </span>

                          {ev.approved_count > 0 && (
                            <button
                              type="button"
                              className="dashboard-view-btn"
                              onClick={() => onViewVolunteers && onViewVolunteers(ev)}
                            >
                              {ev.feedback_count < ev.approved_count
                                ? "Rate volunteers"
                                : "View feedback"}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
            </div>

            {/* ── Solved problems ─────────────────────────────── */}
            <div className="dashboard-section-header ngo-solved-section">
              <span className="dashboard-section-title">Solved problems</span>
              <span className="dashboard-section-sub">
                {solvedIssues.length} total
              </span>
            </div>

            <div className="dashboard-ngo-list">
              {loadingIssues && (
                <p className="dashboard-placeholder-text">Loading solved problems...</p>
              )}

              {!loadingIssues && solvedIssues.length === 0 && (
                <div className="dashboard-placeholder-card" style={{ marginTop: "0.75rem" }}>
                  <p className="dashboard-placeholder-title">No solved problems yet</p>
                  <p className="dashboard-placeholder-text">
                    Problems you solve appear here once your proof is verified.
                  </p>
                </div>
              )}

              {!loadingIssues &&
                solvedIssues.map((iss) => (
                  <div className="dashboard-ngo-row" key={iss.complaint_id}>
                    <div className="dashboard-ngo-row-main">
                      <div className="dashboard-ngo-info">
                        <p className="dashboard-ngo-name">{iss.location}</p>
                        <p className="dashboard-ngo-meta">
                          Solved on {formatDate(iss.solved_at)} · {iss.complaint_id}
                          {iss.reporter_name ? ` · Reported by ${iss.reporter_name}` : ""}
                        </p>
                      </div>

                      <div className="dashboard-ngo-actions">
                        <span className="ngo-event-status-badge status-solved">
                          Solved
                        </span>

                        <button
                          type="button"
                          className="dashboard-view-btn"
                          onClick={() =>
                            setExpandedSolved(
                              expandedSolved === iss.complaint_id ? null : iss.complaint_id
                            )
                          }
                        >
                          {expandedSolved === iss.complaint_id ? "Hide" : "Details"}
                        </button>
                      </div>
                    </div>

                    {expandedSolved === iss.complaint_id && (
                      <div className="dashboard-ngo-detail">
                        <p>
                          <strong>Description:</strong> {iss.user_description}
                        </p>

                        <p className="ngo-solution-block">
                          <strong>Solution:</strong>{" "}
                          {iss.solution_type === "document" ? (
                            <a
                              href={resolutionFileUrl(iss.resolution_id, "document")}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Open document ({iss.document_name})
                            </a>
                          ) : (
                            iss.solution_text
                          )}
                        </p>

                        {iss.resolution_id && (
                          <div className="ngo-photo-list">
                            <PhotoThumb
                              src={resolutionFileUrl(iss.resolution_id, "before")}
                              alt="Before photo"
                              caption="Your before photo"
                            />
                            <PhotoThumb
                              src={resolutionFileUrl(iss.resolution_id, "after")}
                              alt="After photo"
                              caption="Your after photo"
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
            </div>
          </>
        )}

        {/* ── Settings placeholder ─────────────────────────────── */}
        {activeTab === "settings" && (
          <div className="dashboard-placeholder-card">
            <p className="dashboard-placeholder-title">Settings</p>
            <p className="dashboard-placeholder-text">
              Account settings are coming soon.
            </p>
          </div>
        )}

        {/* ── Profile tab ─────────────────────────────────────── */}
        {activeTab === "profile" && (
          <>
            <div className="dashboard-profile-strip">
              <div className="dashboard-avatar-circle">{initials(profile.name)}</div>

              <div className="dashboard-profile-info">
                <p className="dashboard-profile-name">{profile.name}</p>

                {profile.motto && (
                  <p className="dashboard-profile-motto">{profile.motto}</p>
                )}

                <span className={verificationClass(profile.verification_status)}>
                  {profile.verification_status}
                </span>
              </div>
            </div>

            <div className="dashboard-content-grid">
              {/* Main column — org details */}
              <div className="dashboard-main-col">
                <div className="dashboard-section-header">
                  <span className="dashboard-section-title">Organization Details</span>
                </div>

                <div className="ngo-detail-list">
                  <div className="ngo-detail-row">
                    <span className="ngo-detail-label">Email</span>
                    <span className="ngo-detail-value">{profile.email || "—"}</span>
                  </div>

                  <div className="ngo-detail-row">
                    <span className="ngo-detail-label">Contact</span>
                    <span className="ngo-detail-value">{profile.contact_number || "—"}</span>
                  </div>

                  <div className="ngo-detail-row">
                    <span className="ngo-detail-label">Category</span>
                    <span className="ngo-detail-value">{profile.category || "—"}</span>
                  </div>

                  <div className="ngo-detail-row">
                    <span className="ngo-detail-label">Location</span>
                    <span className="ngo-detail-value">{profile.location || "—"}</span>
                  </div>

                  <div className="ngo-detail-row">
                    <span className="ngo-detail-label">Legal Structure</span>
                    <span className="ngo-detail-value">{profile.legal_structure || "—"}</span>
                  </div>

                  <div className="ngo-detail-row">
                    <span className="ngo-detail-label">Year Founded</span>
                    <span className="ngo-detail-value">{profile.year_founded || "—"}</span>
                  </div>

                  <div className="ngo-detail-row">
                    <span className="ngo-detail-label">Website</span>
                    <span className="ngo-detail-value">
                      {profile.website_url ? (
                        <a
                          href={profile.website_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="ngo-detail-link"
                        >
                          {profile.website_url}
                        </a>
                      ) : (
                        "—"
                      )}
                    </span>
                  </div>
                </div>
              </div>

              {/* Sidebar — stats */}
              <div className="dashboard-sidebar-col">
                <p className="dashboard-sidebar-heading">Your activity</p>

                <div className="dashboard-stats-row">
                  <div className="dashboard-stat-card">
                    <span className="dashboard-stat-value">{activeEventCount}</span>
                    <span className="dashboard-stat-label">Events Hosted</span>
                  </div>

                  <div className="dashboard-stat-card">
                    <span className="dashboard-stat-value">0</span>
                    <span className="dashboard-stat-label">Volunteers Reached</span>
                  </div>
                </div>

                <div className="dashboard-placeholder-card">
                  <p className="dashboard-placeholder-title">
                    Messages
                    {unreadCount > 0 && (
                      <span className="dashboard-sidebar-unread-badge">
                        {unreadCount} unread
                      </span>
                    )}
                  </p>
                  <p className="dashboard-placeholder-text">
                    Chat directly with volunteers and answer inquiries.
                  </p>
                  <button
                    type="button"
                    className="dashboard-sidebar-msg-btn"
                    onClick={() => {
                      setChatTarget(null);
                      setActiveTab("messages");
                    }}
                  >
                    Open Messages
                    {unreadCount > 0 && ` (${unreadCount})`}
                  </button>
                </div>
              </div>
            </div>
          </>
        )}

        {/* ── Events tab ──────────────────────────────────────── */}
        {activeTab === "events" && (
          <>
            {/* Organize event toggle / form */}
            <div className="ngo-events-toolbar">
              <button
                type="button"
                className="dashboard-report-btn"
                onClick={() => setShowForm((prev) => !prev)}
              >
                {showForm ? "Close form" : "+ Organize event"}
              </button>
            </div>

            {showForm && (
              <form className="ngo-event-form" onSubmit={handleOrganize}>
                <input
                  type="text"
                  className="dashboard-search-input"
                  placeholder="Event title *"
                  value={formData.title}
                  onChange={onField("title")}
                  required
                />

                <input
                  type="text"
                  className="dashboard-search-input"
                  placeholder="Required skills *"
                  value={formData.required_skills}
                  onChange={onField("required_skills")}
                  required
                />

                <input
                  type="text"
                  className="dashboard-search-input"
                  placeholder="Location"
                  value={formData.location}
                  onChange={onField("location")}
                />

                <input
                  type="date"
                  className="dashboard-search-input"
                  placeholder="Event date"
                  value={formData.event_date}
                  onChange={onField("event_date")}
                />

                <input
                  type="number"
                  className="dashboard-search-input"
                  placeholder="Spots available"
                  min="1"
                  value={formData.spots_available}
                  onChange={onField("spots_available")}
                />

                <button
                  type="submit"
                  className="ngo-event-submit-btn"
                  disabled={submitting}
                >
                  {submitting ? "Creating..." : "Create event"}
                </button>
              </form>
            )}

            {/* Events list */}
            <div className="dashboard-section-header" style={{ marginTop: "1rem" }}>
              <span className="dashboard-section-title">Your Events</span>
              <span className="dashboard-section-sub">
                {listedEvents.length} total
              </span>
            </div>

            <div className="dashboard-ngo-list">
              {loadingEvents && (
                <p className="dashboard-placeholder-text">Loading events...</p>
              )}

              {!loadingEvents && listedEvents.length === 0 && (
                <div className="dashboard-placeholder-card" style={{ marginTop: "0.75rem" }}>
                  <p className="dashboard-placeholder-title">No events yet</p>
                  <p className="dashboard-placeholder-text">
                    Organize your first event to start connecting with volunteers.
                  </p>
                </div>
              )}

              {!loadingEvents &&
                listedEvents.map((ev) => (
                  <div className="dashboard-ngo-row" key={ev.id}>
                    <div className="dashboard-ngo-row-main">
                      <div className="dashboard-ngo-info">
                        <p className="dashboard-ngo-name">{ev.title}</p>
                        <p className="dashboard-ngo-meta">
                          {ev.location || "No location"} · {formatDate(ev.event_date)}
                        </p>
                      </div>

                      <div className="dashboard-ngo-actions">
                        <span
                          className={`ngo-event-status-badge status-${(ev.status || "active").toLowerCase()}`}
                        >
                          {ev.status || "Active"}
                        </span>

                        <button
                          type="button"
                          className="dashboard-view-btn"
                          onClick={() =>
                            setExpandedEvent(expandedEvent === ev.id ? null : ev.id)
                          }
                        >
                          {expandedEvent === ev.id ? "Hide" : "Details"}
                        </button>
                      </div>
                    </div>

                    {expandedEvent === ev.id && (
                      <div className="dashboard-ngo-detail">
                        {editingEventId === ev.id ? (
                          <form className="ngo-event-form" onSubmit={handleUpdateEvent}>
                            <input
                              type="text"
                              className="dashboard-search-input"
                              placeholder="Event title *"
                              value={formData.title}
                              onChange={onField("title")}
                              required
                            />

                            <input
                              type="text"
                              className="dashboard-search-input"
                              placeholder="Required skills *"
                              value={formData.required_skills}
                              onChange={onField("required_skills")}
                              required
                            />

                            <input
                              type="text"
                              className="dashboard-search-input"
                              placeholder="Location"
                              value={formData.location}
                              onChange={onField("location")}
                            />

                            <input
                              type="date"
                              className="dashboard-search-input"
                              placeholder="Event date"
                              value={formData.event_date}
                              onChange={onField("event_date")}
                            />

                            <input
                              type="number"
                              className="dashboard-search-input"
                              placeholder="Spots available"
                              min="1"
                              value={formData.spots_available}
                              onChange={onField("spots_available")}
                            />

                            <div style={{ display: "flex", gap: "0.5rem" }}>
                              <button
                                type="submit"
                                className="ngo-event-submit-btn"
                                disabled={submitting}
                              >
                                {submitting ? "Saving..." : "Save changes"}
                              </button>
                              <button
                                type="button"
                                className="dashboard-view-btn"
                                onClick={() => {
                                  setEditingEventId(null);
                                  setFormData({ ...EMPTY_EVENT });
                                }}
                              >
                                Cancel edit
                              </button>
                            </div>
                          </form>
                        ) : (
                          <>
                            <p>
                              <strong>Description:</strong>{" "}
                              {ev.description || "No description provided."}
                            </p>
                            <p>
                              <strong>Required Skills:</strong> {ev.required_skills}
                            </p>
                            <p>
                              <strong>Spots Available:</strong>{" "}
                              {ev.spots_available ?? "Unlimited"}
                            </p>
                            <p>
                              <strong>Volunteers joined:</strong>{" "}
                              {ev.joined_count}
                            </p>
                            <p>
                              <strong>Volunteers approved:</strong>{" "}
                              {ev.spots_available != null
                                ? `${ev.approved_count} of ${ev.spots_available}`
                                : ev.approved_count}
                            </p>

                            <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
                              {ev.status === "Active" && (
                                <button
                                  type="button"
                                  className="dashboard-view-btn"
                                  onClick={() => {
                                    setEditingEventId(ev.id);
                                    setFormData({
                                      title: ev.title || "",
                                      required_skills: ev.required_skills || "",
                                      location: ev.location || "",
                                      event_date: ev.event_date ? ev.event_date.slice(0, 10) : "",
                                      spots_available: ev.spots_available != null ? String(ev.spots_available) : "",
                                    });
                                  }}
                                >
                                  Edit
                                </button>
                              )}
                              {ev.status === "Active" && (
                                <button
                                  type="button"
                                  className="dashboard-view-btn"
                                  disabled={
                                    ev.spots_available == null ||
                                    ev.approved_count < ev.spots_available
                                  }
                                  title={
                                    ev.spots_available == null ||
                                    ev.approved_count < ev.spots_available
                                      ? "Waiting for more volunteers to be approved"
                                      : undefined
                                  }
                                  onClick={() => {
                                    if (window.confirm("Stop showing this event to volunteers?")) {
                                      handleSetEventStatus(ev.id, "Filled", "Event marked as filled");
                                    }
                                  }}
                                >
                                  Volunteers filled
                                </button>
                              )}
                              {ev.status === "Active" && (
                                <button
                                  type="button"
                                  className="ngo-cancel-event-btn"
                                  onClick={() => handleCancel(ev.id)}
                                >
                                  Cancel event
                                </button>
                              )}
                              {ev.status === "Filled" && (
                                <button
                                  type="button"
                                  className="dashboard-view-btn"
                                  onClick={() => handleSetEventStatus(ev.id, "Active", "Event reopened")}
                                >
                                  Reopen
                                </button>
                              )}
                              <button
                                type="button"
                                className="dashboard-view-btn"
                                onClick={() => onViewVolunteers && onViewVolunteers(ev)}
                              >
                                Manage volunteers
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                ))}
            </div>
          </>
        )}

        {/* ── Reported Problems tab ────────────────────────────── */}
        {activeTab === "problems" && (
          <>
            <div className="dashboard-section-header">
              <span className="dashboard-section-title">Reported Problems</span>
              <span className="dashboard-section-sub">
                {openIssues.length} matched
              </span>
            </div>

            <div className="dashboard-ngo-list">
              {loadingIssues && (
                <p className="dashboard-placeholder-text">Loading reported problems...</p>
              )}

              {!loadingIssues && openIssues.length === 0 && (
                <div className="dashboard-placeholder-card" style={{ marginTop: "0.75rem" }}>
                  <p className="dashboard-placeholder-title">No reported problems yet</p>
                  <p className="dashboard-placeholder-text">
                    When citizens report issues that match your organization, they will appear here.
                  </p>
                </div>
              )}

              {!loadingIssues &&
                openIssues.map((iss) => (
                  <div className="dashboard-ngo-row" key={iss.complaint_id}>
                    <div className="dashboard-ngo-row-main">
                      <div className="dashboard-ngo-info">
                        <p className="dashboard-ngo-name">{iss.location}</p>
                        <p className="dashboard-ngo-meta">
                          {formatDate(iss.created_at)} · {iss.complaint_id}
                          {iss.reporter_name ? ` · Reported by ${iss.reporter_name}` : ""}
                        </p>
                      </div>

                      <div className="dashboard-ngo-actions">
                        <span
                          className={`ngo-event-status-badge issue-status-${issuePillLabel(iss).toLowerCase().replace(/ /g, "-")}`}
                        >
                          {issuePillLabel(iss)}
                        </span>

                        <span className="ngo-issue-match-pct">
                          {iss.match_percentage}% match
                        </span>

                        <button
                          type="button"
                          className="dashboard-view-btn"
                          onClick={() =>
                            setExpandedIssue(
                              expandedIssue === iss.complaint_id ? null : iss.complaint_id
                            )
                          }
                        >
                          {expandedIssue === iss.complaint_id ? "Hide" : "Details"}
                        </button>
                      </div>
                    </div>

                    {expandedIssue === iss.complaint_id && (
                      <div className="dashboard-ngo-detail">
                        <p>
                          <strong>Description:</strong> {iss.user_description}
                        </p>

                        <p>
                          <strong>Reporter:</strong>{" "}
                          {[iss.reporter_name, iss.reporter_phone, iss.reporter_email]
                            .filter(Boolean)
                            .join(" · ") || "—"}
                        </p>

                        <p>
                          <strong>Problem location:</strong> {iss.location}
                        </p>

                        <p>
                          <strong>AI image caption:</strong>{" "}
                          {iss.ai_image_caption || "No image provided"}
                        </p>

                        <p>
                          <strong>Detected category:</strong>{" "}
                          {iss.ai_scene_category || "—"}
                        </p>

                        {iss.explanation && (
                          <div className="ngo-issue-explanation">
                            <p className="ngo-issue-explanation-label">AI Explanation</p>
                            <p className="ngo-issue-explanation-text">{iss.explanation}</p>
                          </div>
                        )}

                        <p className="ngo-issue-confidence">
                          <strong>Confidence:</strong> {iss.confidence}
                        </p>

                        <div className="ngo-issue-connect-row">
                          <button
                            type="button"
                            className="dashboard-connect-btn"
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
                            <svg
                              className="dashboard-chat-icon"
                              width="14"
                              height="14"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              aria-hidden="true"
                            >
                              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                            </svg>
                            Connect
                          </button>
                        </div>

                        {iss.image_count > 0 && (
                          <div className="ngo-photo-row">
                            <p className="ngo-photo-row-label">
                              <strong>Photos:</strong>
                            </p>
                            <div className="ngo-photo-list">
                              {Array.from({ length: iss.image_count }, (_, index) => (
                                <PhotoThumb
                                  key={index}
                                  src={issuePhotoUrl(iss.complaint_id, index)}
                                  alt={`Reported photo ${index + 1}`}
                                />
                              ))}
                            </div>
                          </div>
                        )}

                        {iss.resolution_id && (
                          <div className="ngo-photo-list">
                            <PhotoThumb
                              src={resolutionFileUrl(iss.resolution_id, "before")}
                              alt="Before photo"
                              caption="Your before photo"
                            />
                            <PhotoThumb
                              src={resolutionFileUrl(iss.resolution_id, "after")}
                              alt="After photo"
                              caption="Your after photo"
                            />
                          </div>
                        )}

                        {!iss.resolution_status && (
                          <div className="ngo-issue-connect-row">
                            <button
                              type="button"
                              className="dashboard-view-btn"
                              onClick={() => onMarkSolved && onMarkSolved(iss)}
                            >
                              Mark as solved
                            </button>
                          </div>
                        )}

                        {iss.resolution_status === "Under evaluation" && (
                          <p className="ngo-issue-note">
                            Your proof has been submitted for evaluation. If it is verified and the issue is solved, it will be listed in your Activities section.
                          </p>
                        )}

                        {iss.resolution_status === "Rejected" && (
                          <p className="ngo-issue-note">
                            Your proof was not accepted: {iss.reject_reason}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                ))}
            </div>
          </>
        )}

        {/* ── Footer ──────────────────────────────────────────── */}
        <div className="dashboard-footer-actions">
          <button
            className="form-back-btn"
            type="button"
            onClick={() => setPage("landing")}
          >
            &#8592; Back to Home
          </button>
        </div>
      </div>
    </div>
  );
}

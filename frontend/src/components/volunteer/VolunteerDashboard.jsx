import { useCallback, useEffect, useState } from "react";
import Messages from "../messaging/Messages";
import "./VolunteerDashboard.css";

const API_BASE = "http://127.0.0.1:8000";
const SECTORS = ["Education", "Health", "Environment", "Animal Welfare", "Social Services"];
export default function VolunteerDashboard({ email, showToast, setPage, onReportProblem }) {
  const [profile, setProfile] = useState(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [ngos, setNgos] = useState([]);
  const [loadingNgos, setLoadingNgos] = useState(true);
  const [activeTab, setActiveTab] = useState("profile");
  const [search, setSearch] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [sectorFilter, setSectorFilter] = useState("");
  const [expandedNgo, setExpandedNgo] = useState(null);
  const [matches, setMatches] = useState([]);
  const [chatTarget, setChatTarget] = useState(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [events, setEvents] = useState([]);
  const [joiningId, setJoiningId] = useState(null);

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

  const loadEvents = useCallback(async () => {
    if (!email) return;
    try {
      const res = await fetch(
        `${API_BASE}/volunteer-events/${encodeURIComponent(email)}`
      );
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data)) {
        setEvents(data);
      }
    } catch {
      // ignore errors silently so polling never shows a toast
    }
  }, [email]);

  useEffect(() => {
    if (!email) {
      return;
    }

    loadEvents();
    const eventsIntervalId = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      loadEvents();
    }, 10000);

    return () => {
      clearInterval(eventsIntervalId);
    };
  }, [email, loadEvents]);

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
          `${API_BASE}/volunteer-dashboard/${encodeURIComponent(email)}`
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

  useEffect(() => {
    let cancelled = false;

    const fetchNgos = async () => {
      setLoadingNgos(true);

      try {
        const res = await fetch(`${API_BASE}/ngos`);

        if (!res.ok) {
          throw new Error("Could not load NGOs");
        }

        const data = await res.json();

        if (!cancelled) {
          setNgos(data);
        }
      } catch (err) {
        if (!cancelled) {
          showToast(err.message || "Unable to load NGOs", "error");
        }
      } finally {
        if (!cancelled) {
          setLoadingNgos(false);
        }
      }
    };

    fetchNgos();

    return () => {
      cancelled = true;
    };
  }, [showToast]);

  useEffect(() => {
    if (!email) return;

    let cancelled = false;

    const fetchMatches = async () => {
      try {
        const res = await fetch(
          `${API_BASE}/volunteer-matches/${encodeURIComponent(email)}`
        );

        if (!res.ok) throw new Error();

        const data = await res.json();

        if (!cancelled) {
          setMatches(data.matches || []);
        }
      } catch {
        // Non-critical — silently ignore
      }
    };

    fetchMatches();

    return () => {
      cancelled = true;
    };
  }, [email]);

  const matchMap = new Map(
    matches.map((m) => [m.ngo_name, m])
  );

  const eventNgoGroups = (() => {
    const groups = new Map();
    events.forEach((ev) => {
      if (!groups.has(ev.ngo_name)) {
        groups.set(ev.ngo_name, {
          ngo_name: ev.ngo_name,
          ngo_category: ev.ngo_category,
          ngo_location: ev.ngo_location,
          ngo_email: ev.ngo_email,
          bestMatch: ev.match_percentage,
          events: [],
        });
      }
      const group = groups.get(ev.ngo_name);
      group.events.push(ev);
      if (ev.match_percentage > group.bestMatch) {
        group.bestMatch = ev.match_percentage;
      }
    });
    return Array.from(groups.values()).sort(
      (a, b) => b.bestMatch - a.bestMatch
    );
  })();

  const eventNgoNames = new Set(eventNgoGroups.map((g) => g.ngo_name));

  const joinActivity = async (ev) => {
    if (joiningId !== null || ev.joined) return;
    setJoiningId(ev.activity_id);
    try {
      const res = await fetch(
        `${API_BASE}/activities/${ev.activity_id}/join`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ volunteer_email: email }),
        }
      );
      if (res.ok) {
        showToast(`You joined ${ev.title}`);
        await loadEvents();
      } else {
        let message = "Could not join this activity";
        try {
          const data = await res.json();
          if (data && typeof data.detail === "string") {
            message = data.detail;
          }
        } catch {
          // keep the default message
        }
        showToast(message);
      }
    } catch {
      showToast("Could not join this activity");
    } finally {
      setJoiningId(null);
    }
  };

  const leaveActivity = async (ev) => {
    if (joiningId !== null) return;
    if (!window.confirm("Leave this activity?")) return;
    setJoiningId(ev.activity_id);
    try {
      const res = await fetch(
        `${API_BASE}/activities/${ev.activity_id}/join?volunteer_email=${encodeURIComponent(email)}`,
        { method: "DELETE" }
      );
      if (res.ok) {
        showToast(`You left ${ev.title}`);
        await loadEvents();
      } else {
        let message = "Could not leave this activity";
        try {
          const data = await res.json();
          if (data && typeof data.detail === "string") {
            message = data.detail;
          }
        } catch {
          // keep the default message
        }
        showToast(message);
      }
    } catch {
      showToast("Could not leave this activity");
    } finally {
      setJoiningId(null);
    }
  };

  const locations = Array.from(
    new Set(ngos.map((n) => n.location).filter(Boolean))
  ).sort();

  const filteredNgos = ngos
    .filter((n) =>
      n.name.toLowerCase().includes(search.trim().toLowerCase())
    )
    .filter((n) => !locationFilter || n.location === locationFilter)
    .filter((n) => !sectorFilter || n.category === sectorFilter)
    .filter((n) => !eventNgoNames.has(n.name))
    .sort((a, b) => a.name.localeCompare(b.name));


  const initials = (name) =>
    name
      ? name
          .split(" ")
          .map((p) => p[0])
          .slice(0, 2)
          .join("")
          .toUpperCase()
      : "";

  const skillList = profile?.skills
    ? profile.skills
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 4)
    : [];

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

  return (
    <div className="page dashboard-page">
      <div className="dashboard-shell">
        <div className="dashboard-subnav">
          <div className="dashboard-subnav-tabs">
            <button
              type="button"
              className={`dashboard-subnav-tab ${activeTab === "profile" ? "active" : ""}`}
              onClick={() => setActiveTab("profile")}
            >
              Profile
            </button>

            <button
              type="button"
              className={`dashboard-subnav-tab ${activeTab === "messages" ? "active" : ""}`}
              onClick={() => {
                setChatTarget(null);
                setActiveTab("messages");
              }}
            >
              Messages
              {unreadCount > 0 && (
                <span className="dashboard-subnav-badge">{unreadCount}</span>
              )}
            </button>

            <button
              type="button"
              className={`dashboard-subnav-tab ${activeTab === "activity" ? "active" : ""}`}
              onClick={() => setActiveTab("activity")}
            >
              My Activity
            </button>

            <button
              type="button"
              className={`dashboard-subnav-tab ${activeTab === "settings" ? "active" : ""}`}
              onClick={() => setActiveTab("settings")}
            >
              Settings
            </button>
          </div>

          <button
            type="button"
            className="dashboard-report-btn"
            onClick={() => onReportProblem(email)}
          >
            Report a problem
          </button>
        </div>

        {activeTab === "messages" && (
          <div className="msg-tab-wrapper">
            <Messages
              email={email}
              role="volunteer"
              showToast={showToast}
              startWith={chatTarget}
              onUnreadChange={setUnreadCount}
            />
          </div>
        )}

        {activeTab === "activity" && (
          <div className="dashboard-placeholder-card">
            <p className="dashboard-placeholder-title">My Activity</p>
            <p className="dashboard-placeholder-text">
              Your activity will appear here soon.
            </p>
          </div>
        )}

        {activeTab === "settings" && (
          <div className="dashboard-placeholder-card">
            <p className="dashboard-placeholder-title">Settings</p>
            <p className="dashboard-placeholder-text">
              Account settings are coming soon.
            </p>
          </div>
        )}

        {activeTab === "profile" && (
          <>
            <div className="dashboard-profile-strip">
              <div className="dashboard-avatar-circle">
                {initials(profile.name)}
              </div>

              <div className="dashboard-profile-info">
                <p className="dashboard-profile-name">{profile.name}</p>
                <p className="dashboard-profile-meta">
                  {profile.location || "—"} · {profile.availability || "—"}
                </p>

                <div className="dashboard-skill-row">
                  {skillList.map((skill) => (
                    <span key={skill} className="dashboard-skill-pill">
                      {skill}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div className="dashboard-content-grid">
              <div className="dashboard-main-col">
                <div className="dashboard-filters-row">
                  <input
                    type="text"
                    className="dashboard-search-input"
                    placeholder="Search NGOs by name"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />

                  <select
                    className="dashboard-filter-select"
                    value={locationFilter}
                    onChange={(e) => setLocationFilter(e.target.value)}
                  >
                    <option value="">All locations</option>
                    {locations.map((loc) => (
                      <option key={loc} value={loc}>
                        {loc}
                      </option>
                    ))}
                  </select>

                  <select
                    className="dashboard-filter-select"
                    value={sectorFilter}
                    onChange={(e) => setSectorFilter(e.target.value)}
                  >
                    <option value="">All sectors</option>
                    {SECTORS.map((sector) => (
                      <option key={sector} value={sector}>
                        {sector}
                      </option>
                    ))}
                  </select>
                </div>

                {eventNgoGroups.length > 0 && (
                  <>
                    <div className="dashboard-section-header">
                      <span className="dashboard-section-title">
                        NGOs with active events
                      </span>
                      <span className="dashboard-section-sub">
                        {eventNgoGroups.length} matching your skills
                      </span>
                    </div>

                    <div className="dashboard-ngo-list">
                      {eventNgoGroups.map((group) => (
                        <div
                          className="dashboard-ngo-row"
                          key={`event-${group.ngo_name}`}
                        >
                          <div className="dashboard-ngo-row-main">
                            <div className="dashboard-ngo-info">
                              <p className="dashboard-ngo-name">
                                {group.ngo_name}
                              </p>
                              <p className="dashboard-ngo-meta">
                                {group.ngo_category || "Uncategorized"} ·{" "}
                                {group.ngo_location || "—"}
                              </p>
                            </div>

                            <div className="dashboard-ngo-actions">
                              <span className="dashboard-match-badge">
                                {group.bestMatch}% match
                              </span>

                              <button
                                type="button"
                                className="dashboard-connect-btn"
                                disabled={!group.ngo_email}
                                title={
                                  !group.ngo_email
                                    ? "This NGO has no contact email"
                                    : `Connect with ${group.ngo_name}`
                                }
                                onClick={() => {
                                  if (!group.ngo_email) return;
                                  setChatTarget({
                                    email: group.ngo_email,
                                    name: group.ngo_name,
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
                          </div>

                          <div className="dashboard-event-list">
                            {group.events.map((ev) => (
                              <div
                                className="dashboard-event-item"
                                key={ev.activity_id}
                              >
                                <div className="dashboard-event-info">
                                  <p className="dashboard-event-title">
                                    {ev.title}
                                  </p>
                                  <p className="dashboard-event-meta">
                                    {ev.event_date
                                      ? new Date(ev.event_date).toLocaleDateString(
                                          "en-IN",
                                          {
                                            day: "numeric",
                                            month: "short",
                                            year: "numeric",
                                          }
                                        )
                                      : "Date to be announced"}
                                    {ev.location ? ` · ${ev.location}` : ""}
                                  </p>
                                  {ev.description && (
                                    <p className="dashboard-event-desc">
                                      {ev.description}
                                    </p>
                                  )}
                                  <p className="dashboard-event-skills">
                                    Skills: {ev.required_skills}
                                  </p>
                                </div>

                                {ev.joined && (
                                  <div className="dashboard-event-actions">
                                    <span className="dashboard-joined-label">
                                      Joined
                                    </span>
                                    <button
                                      type="button"
                                      className="dashboard-leave-btn"
                                      disabled={joiningId !== null}
                                      onClick={() => leaveActivity(ev)}
                                    >
                                      {joiningId === ev.activity_id
                                        ? "Leaving..."
                                        : "Leave activity"}
                                    </button>
                                  </div>
                                )}
                                {!ev.joined && (
                                <button
                                  type="button"
                                  className="dashboard-join-btn"
                                  disabled={ev.joined || joiningId !== null}
                                  onClick={() => joinActivity(ev)}
                                >
                                  {ev.joined
                                    ? "Joined"
                                    : joiningId === ev.activity_id
                                    ? "Joining..."
                                    : "Join activity"}
                                </button>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                <div className="dashboard-section-header">
                  <span className="dashboard-section-title">NGOs on VolunTag</span>
                  <span className="dashboard-section-sub">
                    {filteredNgos.length} sorted alphabetically
                  </span>
                </div>

                <div className="dashboard-ngo-list">
                  {loadingNgos && (
                    <p className="dashboard-placeholder-text">Loading NGOs...</p>
                  )}

                  {!loadingNgos && filteredNgos.length === 0 && (
                    <p className="dashboard-placeholder-text">
                      No NGOs match your filters.
                    </p>
                  )}

                  {!loadingNgos &&
                    filteredNgos.map((ngo) => (
                      <div className="dashboard-ngo-row" key={ngo.name}>
                        <div className="dashboard-ngo-row-main">
                          <div className="dashboard-ngo-info">
                            <p className="dashboard-ngo-name">{ngo.name}</p>
                            <p className="dashboard-ngo-meta">
                              {ngo.category || "Uncategorized"} ·{" "}
                              {ngo.location || "—"}
                            </p>
                          </div>

                          <div className="dashboard-ngo-actions">
                            {matchMap.has(ngo.name) &&
                              matchMap.get(ngo.name).level && (
                                <span
                                  className={`dashboard-level-badge level-${
                                    matchMap.get(ngo.name).level
                                  }`}
                                >
                                  {matchMap.get(ngo.name).level === "high"
                                    ? "High"
                                    : matchMap.get(ngo.name).level === "medium"
                                    ? "Medium"
                                    : "Low"}
                                </span>
                              )}

                            {matchMap.has(ngo.name) && (
                              <span className="dashboard-match-badge">
                                {matchMap.get(ngo.name).event_title
                                  ? `${matchMap.get(ngo.name).event_title} · `
                                  : ""}
                                {matchMap.get(ngo.name).match_percentage}% match
                              </span>
                            )}

                            <button
                              type="button"
                              className="dashboard-view-btn"
                              onClick={() =>
                                setExpandedNgo(
                                  expandedNgo === ngo.name ? null : ngo.name
                                )
                              }
                            >
                              {expandedNgo === ngo.name ? "Hide" : "View profile"}
                            </button>

                            <button
                              type="button"
                              className="dashboard-connect-btn"
                              disabled={!ngo.email}
                              title={
                                !ngo.email
                                  ? "This NGO has no contact email"
                                  : `Connect with ${ngo.name}`
                              }
                              onClick={() => {
                                if (!ngo.email) return;
                                setChatTarget({ email: ngo.email, name: ngo.name });
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
                        </div>

                        {expandedNgo === ngo.name && (
                          <div className="dashboard-ngo-detail">
                            <p>
                              {ngo.motto ||
                                "No motto provided."}
                            </p>

                            <span
                              className={`dashboard-verification-tag verification-${(
                                ngo.verification_status || "pending"
                              ).toLowerCase()}`}
                            >
                              {ngo.verification_status || "Pending"}
                            </span>
                          </div>
                        )}
                      </div>
                    ))}
                </div>
              </div>

              <div className="dashboard-sidebar-col">
                <p className="dashboard-sidebar-heading">Your activity</p>

                <div className="dashboard-stats-row">
                  <div className="dashboard-stat-card">
                    <span className="dashboard-stat-value">0</span>
                    <span className="dashboard-stat-label">Activities Joined</span>
                  </div>

                  <div className="dashboard-stat-card">
                    <span className="dashboard-stat-value">0</span>
                    <span className="dashboard-stat-label">Contributions</span>
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
                    Chat directly with NGOs and manage your conversations.
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

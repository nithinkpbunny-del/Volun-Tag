import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import Messages from "../messaging/Messages";
import AuthImage from "../AuthImage";
import PhaseBadge from "../PhaseBadge";
import "./VolunteerDashboard.css";
import { API_BASE } from "../../config";
import { authFetch } from "../../api";
import { PATHS } from "../../routes";
import { Badge, Chips, EmptyState, Icon, SkeletonList } from "../ui/ui";
import {
  formatEventDay,
  formatTimestampDate,
  isCompletedPhase,
  isOpenPhase,
} from "../../dates";

const ACTIVITY_TONES = {
  Cancelled: "danger",
  Attended: "success",
  "Not attended": "warning",
  "Awaiting NGO feedback": "info",
  Approved: "success",
  "Not selected": "neutral",
  "Waiting for approval": "warning",
};

const ISSUE_TONES = {
  Reported: "info",
  "Under evaluation": "warning",
  Completed: "success",
  Resolved: "success",
};

const LEVEL_TONES = { high: "success", medium: "warning", low: "neutral" };
const LEVEL_LABELS = { high: "High", medium: "Medium", low: "Low" };

const verificationTone = (status) =>
  status === "Approved" ? "success" : status === "Rejected" ? "danger" : "warning";

// Tabs, in the order shown; the current one is kept in the address (?tab=).
export const VOLUNTEER_TABS = ["profile", "messages", "activity", "settings"];
const DEFAULT_TAB = "profile";

const SECTORS = ["Education", "Health", "Environment", "Animal Welfare", "Social Services"];
const MAX_ISSUE_IMAGES = 6;
const MAX_ISSUE_IMAGE_BYTES = 10 * 1024 * 1024;

const readErrorDetail = async (res, fallback) => {
  try {
    const data = await res.json();
    if (data && typeof data.detail === "string") {
      return data.detail;
    }
  } catch {
    // keep the fallback message
  }
  return fallback;
};

// One clickable thumbnail of a reported photo; hidden if the image cannot be loaded.
function IssuePhotoThumb({ src, alt, onOpenError }) {
  const [failed, setFailed] = useState(false);

  if (failed) return null;

  return (
    <AuthImage
      src={src}
      alt={alt}
      linkClassName="dashboard-issue-photo"
      onFail={() => setFailed(true)}
      onOpenError={onOpenError}
    />
  );
}

export default function VolunteerDashboard({ email, showToast, onReportProblem }) {
  const navigate = useNavigate();
  // navigate changes whenever the address does; keep it out of effect
  // dependencies so the data below is not reloaded by a navigation.
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  const [profile, setProfile] = useState(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [ngos, setNgos] = useState([]);
  const [loadingNgos, setLoadingNgos] = useState(true);
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const activeTab = VOLUNTEER_TABS.includes(tabParam) ? tabParam : DEFAULT_TAB;
  // Each tab change is a history entry, so Back returns to the previous tab.
  const setActiveTab = (tab) => {
    if (tab === activeTab) return;
    setSearchParams(tab === DEFAULT_TAB ? {} : { tab });
  };
  const [search, setSearch] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [sectorFilter, setSectorFilter] = useState("");
  const [expandedNgo, setExpandedNgo] = useState(null);
  const [matches, setMatches] = useState([]);
  const [chatTarget, setChatTarget] = useState(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [events, setEvents] = useState([]);
  const [joiningId, setJoiningId] = useState(null);
  const [activityItems, setActivityItems] = useState([]);
  const [loadingActivity, setLoadingActivity] = useState(true);
  const [activitySubView, setActivitySubView] = useState("events");
  const [myIssues, setMyIssues] = useState([]);
  const [loadingIssues, setLoadingIssues] = useState(true);
  const [editingIssueId, setEditingIssueId] = useState(null);
  const [editForm, setEditForm] = useState({ user_description: "", location: "" });
  const [editImages, setEditImages] = useState([]);
  const [savingIssue, setSavingIssue] = useState(false);
  const [deletingIssueId, setDeletingIssueId] = useState(null);
  // Bumped after a save or delete so an older in-flight refresh cannot overwrite the result.
  const issuesEpochRef = useRef(0);

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

  const loadEvents = useCallback(async () => {
    if (!email) return;
    try {
      const res = await authFetch(
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

  // Loaded once for the sidebar numbers; refreshed every 10 seconds only
  // while My Activity is open.
  useEffect(() => {
    if (!email) {
      return;
    }

    let cancelled = false;

    const fetchActivity = async () => {
      try {
        const res = await authFetch(
          `${API_BASE}/volunteer-activity/${encodeURIComponent(email)}`
        );
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && Array.isArray(data)) {
          setActivityItems(data);
        }
      } catch {
        // ignore errors silently so polling never shows a toast
      } finally {
        if (!cancelled) setLoadingActivity(false);
      }
    };

    fetchActivity();

    if (activeTab !== "activity") {
      return () => {
        cancelled = true;
      };
    }

    const activityIntervalId = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      fetchActivity();
    }, 10000);

    return () => {
      cancelled = true;
      clearInterval(activityIntervalId);
    };
  }, [email, activeTab]);

  // Silent reload of the volunteer's reported problems. It only replaces the list;
  // the edit form lives in its own state, so typed text is never touched.
  const loadMyIssues = useCallback(async () => {
    if (!email) return;
    const epoch = issuesEpochRef.current;
    try {
      const res = await authFetch(
        `${API_BASE}/volunteer-issues/${encodeURIComponent(email)}`
      );
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data) && epoch === issuesEpochRef.current) {
        setMyIssues(data);
      }
    } catch {
      // ignore errors silently so polling never shows a toast
    } finally {
      setLoadingIssues(false);
    }
  }, [email]);

  useEffect(() => {
    if (!email || activeTab !== "activity") {
      return undefined;
    }

    loadMyIssues();

    if (activitySubView !== "problems") {
      return undefined;
    }

    const issuesIntervalId = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      loadMyIssues();
    }, 10000);

    return () => {
      clearInterval(issuesIntervalId);
    };
  }, [email, activeTab, activitySubView, loadMyIssues]);

  useEffect(() => {
    let cancelled = false;

    const fetchProfile = async () => {
      setLoadingProfile(true);

      try {
        const res = await authFetch(
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

  useEffect(() => {
    let cancelled = false;

    const fetchNgos = async () => {
      setLoadingNgos(true);

      try {
        // /ngos needs a login: it includes each NGO's contact email.
        const res = await authFetch(`${API_BASE}/ngos`);

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
        const res = await authFetch(
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
      const res = await authFetch(
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
      const res = await authFetch(
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

  // Path only: AuthImage fetches it with the login token.
  const issuePhotoPath = (complaintId, index) =>
    `/issue-files/issue/${encodeURIComponent(complaintId)}/${index}`;

  const startEditIssue = (iss) => {
    setEditingIssueId(iss.complaint_id);
    setEditForm({
      user_description: iss.user_description,
      location: iss.location,
    });
    setEditImages([]);
  };

  const cancelEditIssue = () => {
    setEditingIssueId(null);
    setEditImages([]);
  };

  // Photos can only be added: the picked files are checked against the free slots.
  const pickIssueImages = (iss) => (e) => {
    const files = Array.from(e.target.files || []);
    const freeSlots = MAX_ISSUE_IMAGES - iss.image_count;

    if (files.some((f) => !f.type.startsWith("image/"))) {
      showToast("Please choose image files only", "error");
      e.target.value = "";
      setEditImages([]);
      return;
    }

    if (files.some((f) => f.size > MAX_ISSUE_IMAGE_BYTES)) {
      showToast("Each photo must be 10 MB or smaller", "error");
      e.target.value = "";
      setEditImages([]);
      return;
    }

    if (files.length > freeSlots) {
      showToast(
        `You can add up to ${freeSlots} more photo${freeSlots === 1 ? "" : "s"}`,
        "error"
      );
      e.target.value = "";
      setEditImages([]);
      return;
    }

    setEditImages(files);
  };

  const saveIssue = async (iss) => {
    if (savingIssue) return;

    const description = editForm.user_description.trim();
    const issueLocation = editForm.location.trim();

    if (!description || !issueLocation) {
      showToast("Description and location are required", "error");
      return;
    }

    if (
      description === iss.user_description &&
      issueLocation === iss.location &&
      editImages.length === 0
    ) {
      showToast("No changes to save", "info");
      return;
    }

    setSavingIssue(true);

    const formData = new FormData();
    formData.append("user_description", description);
    formData.append("location", issueLocation);
    editImages.forEach((file) => {
      formData.append("images", file);
    });

    try {
      const res = await authFetch(
        `${API_BASE}/volunteer-issues/${encodeURIComponent(iss.complaint_id)}`,
        { method: "PATCH", body: formData }
      );
      if (res.ok) {
        const updated = await res.json();
        issuesEpochRef.current += 1;
        setMyIssues((prev) =>
          prev.map((item) =>
            item.complaint_id === updated.complaint_id ? updated : item
          )
        );
        setEditingIssueId(null);
        setEditImages([]);
        showToast("Your problem was updated");
      } else {
        showToast(
          await readErrorDetail(res, "Could not update this problem"),
          "error"
        );
        // The problem may have been locked meanwhile; pick up its new status.
        await loadMyIssues();
      }
    } catch {
      showToast("Could not update this problem", "error");
    } finally {
      setSavingIssue(false);
    }
  };

  const deleteIssue = async (iss) => {
    if (deletingIssueId !== null) return;
    if (!window.confirm("Delete this reported problem? This cannot be undone.")) return;
    setDeletingIssueId(iss.complaint_id);
    try {
      const res = await authFetch(
        `${API_BASE}/volunteer-issues/${encodeURIComponent(iss.complaint_id)}`,
        { method: "DELETE" }
      );
      if (res.ok) {
        issuesEpochRef.current += 1;
        setMyIssues((prev) =>
          prev.filter((item) => item.complaint_id !== iss.complaint_id)
        );
        showToast("Your problem was deleted");
      } else {
        showToast(
          await readErrorDetail(res, "Could not delete this problem"),
          "error"
        );
        await loadMyIssues();
      }
    } catch {
      showToast("Could not delete this problem", "error");
    } finally {
      setDeletingIssueId(null);
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

  const photoOpenError = () =>
    showToast("Could not open the photo. Please try again.", "error");

  const openChat = (target) => {
    setChatTarget(target);
    setActiveTab("messages");
  };

  const connectIcon = <Icon name="chat" size={15} />;

  // Real numbers for the sidebar, from the volunteer's own activity list.
  const joinedCount = activityItems.filter((item) => item.event_status !== "Cancelled").length;
  const attendedCount = activityItems.filter((item) => item.attendance_status === "attended").length;

  // My Activity: what is still ahead, then what is over.
  const isPastActivity = (item) =>
    item.event_status === "Cancelled" || isCompletedPhase(item.phase);
  const upcomingActivity = activityItems.filter((item) => !isPastActivity(item));
  const pastActivity = activityItems.filter(isPastActivity);

  const renderActivityItem = (item) => (
    <article className="activity-card" key={item.activity_id}>
      <div className="activity-card__main">
        <div className="activity-card__head">
          <h3 className="activity-card__title">{item.title}</h3>
          <div className="activity-card__badges">
            {item.event_status !== "Cancelled" && <PhaseBadge phase={item.phase} />}
            <Badge tone={ACTIVITY_TONES[item.status_label] || "neutral"}>{item.status_label}</Badge>
          </div>
        </div>

        <p className="activity-card__ngo">{item.ngo_name}</p>

        <ul className="event-card__meta">
          <li>
            <Icon name="calendar" />
            <span>{formatEventDay(item.event_day)}</span>
          </li>
          {item.location && (
            <li>
              <Icon name="pin" />
              <span>{item.location}</span>
            </li>
          )}
        </ul>

        {item.attendance_status === "attended" && (
          <div className="activity-card__feedback">
            <p className="activity-card__rating">
              <span className="sr-only">Your rating: {item.rating || 0} out of 5</span>
              <span className="rating-stars" aria-hidden="true">
                {"★".repeat(item.rating || 0)}
                <span className="rating-stars__empty">{"★".repeat(5 - (item.rating || 0))}</span>
              </span>
              <span className="activity-card__rating-label">Your rating</span>
            </p>
            {item.feedback && (
              <blockquote className="activity-card__quote">
                <span className="activity-card__quote-label">NGO feedback</span>
                {item.feedback}
              </blockquote>
            )}
          </div>
        )}
      </div>

      {item.ngo_email && (
        <div className="activity-card__side">
          <button
            type="button"
            className="ui-btn ui-btn--sm"
            onClick={() => openChat({ email: item.ngo_email, name: item.ngo_name })}
          >
            {connectIcon}
            Message NGO
          </button>
        </div>
      )}
    </article>
  );

  return (
    <div className="page dashboard-page">
      <div className="dashboard-shell">
        <h1 className="sr-only">Volunteer dashboard</h1>

        <div className="dashboard-subnav">
          <div className="dashboard-subnav-tabs" role="group" aria-label="Dashboard sections">
            <button
              type="button"
              className={`dashboard-subnav-tab ${activeTab === "profile" ? "active" : ""}`}
              aria-current={activeTab === "profile" ? "page" : undefined}
              onClick={() => setActiveTab("profile")}
            >
              Profile
            </button>

            <button
              type="button"
              className={`dashboard-subnav-tab ${activeTab === "messages" ? "active" : ""}`}
              aria-current={activeTab === "messages" ? "page" : undefined}
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
              aria-current={activeTab === "activity" ? "page" : undefined}
              onClick={() => setActiveTab("activity")}
            >
              My Activity
            </button>

            <button
              type="button"
              className={`dashboard-subnav-tab ${activeTab === "settings" ? "active" : ""}`}
              aria-current={activeTab === "settings" ? "page" : undefined}
              onClick={() => setActiveTab("settings")}
            >
              Settings
            </button>
          </div>

          <button
            type="button"
            className="ui-btn ui-btn--primary dashboard-report-btn"
            onClick={() => onReportProblem(email)}
          >
            <Icon name="flag" />
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

        {activeTab === "activity" && activitySubView === "events" && (
          <>
            <div className="dashboard-side-card dashboard-side-card--row">
              <div>
                <p className="dashboard-side-card__title">Reported problems</p>
                <p className="dashboard-side-card__text">
                  {loadingIssues
                    ? "Loading your reported problems..."
                    : myIssues.length === 0
                    ? "You haven't reported any problems yet."
                    : `${myIssues.length} reported. View, edit or delete them here.`}
                </p>
              </div>

              <button
                type="button"
                className="ui-btn"
                onClick={() => setActivitySubView("problems")}
              >
                View reported problems
              </button>
            </div>

            {loadingActivity ? (
              <SkeletonList count={3} label="Loading your activity" />
            ) : activityItems.length === 0 ? (
              <EmptyState
                icon="calendar"
                title="You haven't joined any events yet"
                action={
                  <button
                    type="button"
                    className="ui-btn ui-btn--primary"
                    onClick={() => setActiveTab("profile")}
                  >
                    Find events
                  </button>
                }
              >
                Events you join appear here, with the NGO's decision and, afterwards, your rating.
              </EmptyState>
            ) : (
              <>
                {upcomingActivity.length > 0 && (
                  <>
                    <div className="ui-section-head">
                      <h2 className="ui-section-title">Upcoming</h2>
                      <span className="ui-section-sub">{upcomingActivity.length} joined</span>
                    </div>
                    <div className="activity-list">{upcomingActivity.map(renderActivityItem)}</div>
                  </>
                )}

                {pastActivity.length > 0 && (
                  <>
                    <div className="ui-section-head">
                      <h2 className="ui-section-title">Past</h2>
                      <span className="ui-section-sub">{pastActivity.length} total</span>
                    </div>
                    <div className="activity-list">{pastActivity.map(renderActivityItem)}</div>
                  </>
                )}
              </>
            )}
          </>
        )}

        {activeTab === "activity" && activitySubView === "problems" && (
          <>
            <div className="dashboard-issue-back">
              <button
                type="button"
                className="ui-btn ui-btn--ghost"
                onClick={() => {
                  cancelEditIssue();
                  setActivitySubView("events");
                }}
              >
                <Icon name="arrowLeft" />
                Back to My Activity
              </button>
            </div>

            <div className="ui-section-head">
              <h2 className="ui-section-title">Reported problems</h2>
              <span className="ui-section-sub">{myIssues.length} total</span>
            </div>

            {loadingIssues ? (
              <SkeletonList count={2} label="Loading your reported problems" />
            ) : myIssues.length === 0 ? (
              <EmptyState
                icon="flag"
                title="You haven't reported any problems yet"
                action={
                  <button
                    type="button"
                    className="ui-btn ui-btn--primary"
                    onClick={() => onReportProblem(email)}
                  >
                    Report a problem
                  </button>
                }
              >
                Seen something in your area that needs fixing? Report it with a photo and VolunTag
                passes it to NGOs that can help.
              </EmptyState>
            ) : (
              <div className="activity-list">
                {myIssues.map((iss) => {
                  const pillLabel = iss.solved ? "Completed" : iss.status;
                  const isReported = iss.status === "Reported";
                  // A problem that gets locked while the form is open closes the form.
                  const isEditing =
                    isReported && editingIssueId === iss.complaint_id;
                  const freeSlots = MAX_ISSUE_IMAGES - iss.image_count;

                  return (
                    <article className="issue-card" key={iss.complaint_id}>
                      <div className="activity-card__head">
                        <h3 className="activity-card__title">{iss.location}</h3>
                        <Badge tone={ISSUE_TONES[pillLabel] || "neutral"}>{pillLabel}</Badge>
                      </div>

                      <p className="dash-row__meta">
                        {iss.complaint_id} · Reported on {formatTimestampDate(iss.created_at)}
                        {iss.solved && iss.solved_by_ngo ? ` · Solved by ${iss.solved_by_ngo}` : ""}
                      </p>

                      <p className="issue-card__desc">{iss.user_description}</p>

                      {iss.image_count > 0 && (
                        <div className="dashboard-issue-photos">
                          {Array.from({ length: iss.image_count }, (_, index) => (
                            <IssuePhotoThumb
                              key={index}
                              src={issuePhotoPath(iss.complaint_id, index)}
                              alt={`Reported photo ${index + 1}`}
                              onOpenError={photoOpenError}
                            />
                          ))}
                        </div>
                      )}

                      {isReported && !isEditing && (
                        <div className="issue-card__actions">
                          <button
                            type="button"
                            className="ui-btn ui-btn--sm"
                            disabled={deletingIssueId !== null}
                            onClick={() => startEditIssue(iss)}
                          >
                            <Icon name="edit" size={15} />
                            Edit
                          </button>
                          <button
                            type="button"
                            className="ui-btn ui-btn--danger ui-btn--sm"
                            disabled={deletingIssueId !== null}
                            onClick={() => deleteIssue(iss)}
                          >
                            {deletingIssueId === iss.complaint_id ? "Deleting..." : "Delete"}
                          </button>
                        </div>
                      )}

                      {!isReported && (
                        <p className="issue-card__note">
                          {iss.solved
                            ? "Locked: this problem has been solved."
                            : iss.status === "Under evaluation"
                            ? "Locked: an NGO's proof for this problem is under evaluation."
                            : "Locked: this problem can no longer be edited or deleted."}
                        </p>
                      )}

                      {isEditing && (
                        <div className="issue-card__form">
                          <div className="ui-field">
                            <label htmlFor={`issue-desc-${iss.complaint_id}`}>Description</label>
                            <textarea
                              id={`issue-desc-${iss.complaint_id}`}
                              className="ui-textarea"
                              rows={4}
                              maxLength={5000}
                              value={editForm.user_description}
                              onChange={(e) =>
                                setEditForm((prev) => ({
                                  ...prev,
                                  user_description: e.target.value,
                                }))
                              }
                            />
                          </div>

                          <div className="ui-field">
                            <label htmlFor={`issue-loc-${iss.complaint_id}`}>Location</label>
                            <input
                              id={`issue-loc-${iss.complaint_id}`}
                              className="ui-input"
                              type="text"
                              maxLength={500}
                              value={editForm.location}
                              onChange={(e) =>
                                setEditForm((prev) => ({
                                  ...prev,
                                  location: e.target.value,
                                }))
                              }
                            />
                          </div>

                          <div className="ui-field">
                            <label htmlFor={`issue-photos-${iss.complaint_id}`}>Add photos</label>
                            <input
                              id={`issue-photos-${iss.complaint_id}`}
                              className="ui-file"
                              type="file"
                              accept="image/*"
                              multiple
                              disabled={freeSlots <= 0}
                              onChange={pickIssueImages(iss)}
                            />
                            <span className="ui-hint">
                              {freeSlots <= 0
                                ? `This problem already has the maximum of ${MAX_ISSUE_IMAGES} photos.`
                                : `You can add up to ${freeSlots} more photo${freeSlots === 1 ? "" : "s"}, 10 MB each. Photos you already uploaded cannot be removed.`}
                            </span>
                            {editImages.length > 0 && (
                              <p className="dashboard-issue-files">
                                {editImages.map((f) => f.name).join(", ")}
                              </p>
                            )}
                          </div>

                          <div className="issue-card__actions">
                            <button
                              type="button"
                              className="ui-btn ui-btn--primary"
                              disabled={savingIssue}
                              onClick={() => saveIssue(iss)}
                            >
                              {savingIssue ? "Saving..." : "Save changes"}
                            </button>
                            <button
                              type="button"
                              className="ui-btn"
                              disabled={savingIssue}
                              onClick={cancelEditIssue}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </>
        )}

        {activeTab === "settings" && (
          <EmptyState icon="spark" title="Settings">
            Account settings are coming soon.
          </EmptyState>
        )}

        {activeTab === "profile" && (
          <>
            <div className="dashboard-profile-strip">
              <div className="dashboard-avatar-circle" aria-hidden="true">
                {initials(profile.name)}
              </div>

              <div className="dashboard-profile-info">
                <p className="dashboard-profile-name">{profile.name}</p>
                <p className="dashboard-profile-meta">
                  {profile.location || "—"} · {profile.availability || "—"}
                </p>

                <Chips items={profile.skills} max={6} label="Your skills" />
              </div>
            </div>

            <div className="dashboard-content-grid">
              <div className="dashboard-main-col">
                {eventNgoGroups.length > 0 && (
                  <>
                    <div className="ui-section-head">
                      <h2 className="ui-section-title">Events for you</h2>
                      <span className="ui-section-sub">
                        {eventNgoGroups.length}{" "}
                        {eventNgoGroups.length === 1 ? "NGO" : "NGOs"} matching your skills
                      </span>
                    </div>

                    <div className="ngo-group-list">
                      {eventNgoGroups.map((group) => (
                        <section
                          className="ngo-group"
                          key={`event-${group.ngo_name}`}
                          aria-label={`Events by ${group.ngo_name}`}
                        >
                          <header className="ngo-group__head">
                            <div className="ngo-group__info">
                              <h3 className="ngo-group__name">{group.ngo_name}</h3>
                              <p className="dash-row__meta">
                                {group.ngo_category || "Uncategorized"} ·{" "}
                                {group.ngo_location || "—"}
                              </p>
                            </div>

                            <div className="ngo-group__actions">
                              <Badge tone="success">{group.bestMatch}% match</Badge>

                              <button
                                type="button"
                                className="ui-btn ui-btn--sm dashboard-connect-btn"
                                disabled={!group.ngo_email}
                                title={
                                  !group.ngo_email
                                    ? "This NGO has no contact email"
                                    : `Connect with ${group.ngo_name}`
                                }
                                onClick={() => {
                                  if (!group.ngo_email) return;
                                  openChat({ email: group.ngo_email, name: group.ngo_name });
                                }}
                              >
                                {connectIcon}
                                Connect
                              </button>
                            </div>
                          </header>

                          <div className="vol-event-list">
                            {group.events.map((ev) => (
                              <article className="vol-event" key={ev.activity_id} data-event-card>
                                <div className="vol-event__body">
                                  <div className="activity-card__head">
                                    <h4 className="vol-event__title">{ev.title}</h4>
                                    <PhaseBadge phase={ev.phase} />
                                  </div>

                                  <ul className="event-card__meta">
                                    <li>
                                      <Icon name="calendar" />
                                      <span>{formatEventDay(ev.event_day)}</span>
                                    </li>
                                    {ev.location && (
                                      <li>
                                        <Icon name="pin" />
                                        <span>{ev.location}</span>
                                      </li>
                                    )}
                                  </ul>

                                  {ev.description && (
                                    <p className="event-card__desc">{ev.description}</p>
                                  )}

                                  <Chips items={ev.required_skills} max={5} label="Required skills" />

                                  {ev.explanation && ev.explanation.summary && (
                                    <p className="vol-event__why">
                                      <Icon name="spark" size={14} />
                                      <span>{ev.explanation.summary}</span>
                                    </p>
                                  )}
                                </div>

                                <div className="vol-event__actions">
                                  {ev.approved && (
                                    <Badge tone="success" dot>
                                      Approved
                                    </Badge>
                                  )}

                                  {ev.joined && !ev.approved && (
                                    <>
                                      <Badge tone="warning" dot>
                                        Joined
                                      </Badge>
                                      {/* Leaving is possible only until the event day starts. */}
                                      {isOpenPhase(ev.phase) && (
                                        <button
                                          type="button"
                                          className="ui-btn ui-btn--danger ui-btn--sm"
                                          disabled={joiningId !== null}
                                          onClick={() => leaveActivity(ev)}
                                        >
                                          {joiningId === ev.activity_id
                                            ? "Leaving..."
                                            : "Leave activity"}
                                        </button>
                                      )}
                                    </>
                                  )}

                                  {!ev.joined && isOpenPhase(ev.phase) && (
                                    <button
                                      type="button"
                                      className="ui-btn ui-btn--primary"
                                      disabled={joiningId !== null}
                                      onClick={() => joinActivity(ev)}
                                    >
                                      {joiningId === ev.activity_id
                                        ? "Joining..."
                                        : "Join activity"}
                                    </button>
                                  )}
                                </div>
                              </article>
                            ))}
                          </div>
                        </section>
                      ))}
                    </div>
                  </>
                )}

                <div className="ui-section-head">
                  <h2 className="ui-section-title">NGOs on VolunTag</h2>
                  <span className="ui-section-sub">
                    {filteredNgos.length} sorted alphabetically
                  </span>
                </div>

                <div className="dashboard-filters-row">
                  <input
                    type="search"
                    className="ui-input dashboard-search-input"
                    aria-label="Search NGOs by name"
                    placeholder="Search NGOs by name"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />

                  <select
                    className="ui-select"
                    aria-label="Filter NGOs by location"
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
                    className="ui-select"
                    aria-label="Filter NGOs by sector"
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

                {loadingNgos ? (
                  <SkeletonList count={4} label="Loading NGOs" />
                ) : filteredNgos.length === 0 ? (
                  <EmptyState icon="search" title="No NGOs match your filters">
                    Try a different name, location or sector.
                  </EmptyState>
                ) : (
                  <div className="dash-list">
                    {filteredNgos.map((ngo) => {
                      const match = matchMap.get(ngo.name);
                      const expanded = expandedNgo === ngo.name;

                      return (
                        <div className="dash-row" key={ngo.name}>
                          <div className="dash-row__main">
                            <div className="dash-row__info">
                              <p className="dash-row__title">{ngo.name}</p>
                              <p className="dash-row__meta">
                                {ngo.category || "Uncategorized"} · {ngo.location || "—"}
                              </p>
                            </div>

                            <div className="dash-row__actions">
                              {match && (
                                <Badge tone={LEVEL_TONES[match.level] || "neutral"}>
                                  {match.level ? `${LEVEL_LABELS[match.level] || "Low"} · ` : ""}
                                  {match.match_percentage}% match
                                </Badge>
                              )}

                              <button
                                type="button"
                                className="ui-btn ui-btn--ghost ui-btn--sm"
                                aria-expanded={expanded}
                                onClick={() => setExpandedNgo(expanded ? null : ngo.name)}
                              >
                                {expanded ? "Hide" : "View profile"}
                              </button>

                              <button
                                type="button"
                                className="ui-btn ui-btn--sm dashboard-connect-btn"
                                disabled={!ngo.email}
                                title={
                                  !ngo.email
                                    ? "This NGO has no contact email"
                                    : `Connect with ${ngo.name}`
                                }
                                onClick={() => {
                                  if (!ngo.email) return;
                                  openChat({ email: ngo.email, name: ngo.name });
                                }}
                              >
                                {connectIcon}
                                Connect
                              </button>
                            </div>
                          </div>

                          {expanded && (
                            <div className="dash-row__detail">
                              <p className="dash-row__motto">{ngo.motto || "No motto provided."}</p>

                              <div className="dash-row__detail-badges">
                                <Badge tone={verificationTone(ngo.verification_status)} dot>
                                  {ngo.verification_status || "Pending"}
                                </Badge>
                                {match && match.event_title && (
                                  <Badge tone="neutral">Latest event: {match.event_title}</Badge>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <aside className="dashboard-sidebar-col" aria-label="Your activity">
                <h2 className="dashboard-sidebar-heading">Your activity</h2>

                <div className="ui-stats">
                  <div className="ui-stat">
                    <span className="ui-stat__value">{loadingActivity ? "–" : joinedCount}</span>
                    <span className="ui-stat__label">Events joined</span>
                  </div>

                  <div className="ui-stat">
                    <span className="ui-stat__value">{loadingActivity ? "–" : attendedCount}</span>
                    <span className="ui-stat__label">Events attended</span>
                  </div>
                </div>

                <div className="dashboard-side-card">
                  <p className="dashboard-side-card__title">
                    Messages
                    {unreadCount > 0 && <Badge tone="success">{unreadCount} unread</Badge>}
                  </p>
                  <p className="dashboard-side-card__text">
                    Chat directly with NGOs and manage your conversations.
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

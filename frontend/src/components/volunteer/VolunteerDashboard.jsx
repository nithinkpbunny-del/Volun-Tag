import { useCallback, useEffect, useRef, useState } from "react";
import Messages from "../messaging/Messages";
import "./VolunteerDashboard.css";

const API_BASE = "http://127.0.0.1:8000";
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
function IssuePhotoThumb({ src, alt }) {
  return (
    <a
      className="dashboard-issue-photo"
      href={src}
      target="_blank"
      rel="noreferrer"
    >
      <img
        src={src}
        alt={alt}
        loading="lazy"
        onError={(e) => {
          e.currentTarget.style.display = "none";
          e.currentTarget.parentNode.style.display = "none";
        }}
      />
    </a>
  );
}

export default function VolunteerDashboard({ email, showToast, setPage, onReportProblem, initialTab, onInitialConsumed }) {
  const [profile, setProfile] = useState(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [ngos, setNgos] = useState([]);
  const [loadingNgos, setLoadingNgos] = useState(true);
  const [activeTab, setActiveTab] = useState(initialTab || "profile");
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
    if (initialTab) {
      onInitialConsumed && onInitialConsumed();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    if (!email || activeTab !== "activity") {
      return;
    }

    let cancelled = false;

    const fetchActivity = async () => {
      try {
        const res = await fetch(
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
      const res = await fetch(
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

  const issuePhotoUrl = (complaintId, index) =>
    `${API_BASE}/issue-files/issue/${encodeURIComponent(complaintId)}/${index}?email=${encodeURIComponent(email)}`;

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
      const res = await fetch(
        `${API_BASE}/volunteer-issues/${encodeURIComponent(iss.complaint_id)}?email=${encodeURIComponent(email)}`,
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
      const res = await fetch(
        `${API_BASE}/volunteer-issues/${encodeURIComponent(iss.complaint_id)}?email=${encodeURIComponent(email)}`,
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

        {activeTab === "activity" && activitySubView === "events" && (
          <div className="dashboard-activity-list dashboard-issue-summary">
            <div className="dashboard-activity-item">
              <div className="dashboard-activity-info">
                <p className="dashboard-event-title">Reported problems</p>
                <p className="dashboard-event-meta">
                  {loadingIssues
                    ? "Loading your reported problems..."
                    : myIssues.length === 0
                    ? "You haven't reported any problems yet."
                    : `${myIssues.length} reported. View, edit or delete them here.`}
                </p>
              </div>

              <div className="dashboard-activity-side">
                <button
                  type="button"
                  className="dashboard-sidebar-msg-btn dashboard-activity-msg-btn"
                  onClick={() => setActivitySubView("problems")}
                >
                  View reported problems
                </button>
              </div>
            </div>
          </div>
        )}

        {activeTab === "activity" && activitySubView === "problems" && (
          <>
            <div className="dashboard-issue-back">
              <button
                type="button"
                className="dashboard-view-btn"
                onClick={() => {
                  cancelEditIssue();
                  setActivitySubView("events");
                }}
              >
                &#8592; Back to My Activity
              </button>
            </div>

            <div className="dashboard-section-header">
              <span className="dashboard-section-title">Reported problems</span>
              <span className="dashboard-section-sub">
                {myIssues.length} total
              </span>
            </div>

            <div className="dashboard-issue-list">
              {loadingIssues && (
                <p className="dashboard-placeholder-text">Loading your reported problems...</p>
              )}

              {!loadingIssues && myIssues.length === 0 && (
                <p className="dashboard-placeholder-text">
                  You haven't reported any problems yet.
                </p>
              )}

              {!loadingIssues &&
                myIssues.map((iss) => {
                  const pillLabel = iss.solved ? "Completed" : iss.status;
                  const isReported = iss.status === "Reported";
                  // A problem that gets locked while the form is open closes the form.
                  const isEditing =
                    isReported && editingIssueId === iss.complaint_id;
                  const freeSlots = MAX_ISSUE_IMAGES - iss.image_count;

                  return (
                    <div className="dashboard-issue-item" key={iss.complaint_id}>
                      <div className="dashboard-issue-head">
                        <div className="dashboard-issue-info">
                          <p className="dashboard-event-title">{iss.location}</p>
                          <p className="dashboard-event-meta">
                            {iss.complaint_id} · Reported on{" "}
                            {new Date(iss.created_at).toLocaleDateString("en-IN", {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                            })}
                          </p>
                          {iss.solved && iss.solved_by_ngo && (
                            <p className="dashboard-event-meta">
                              Solved by {iss.solved_by_ngo}
                            </p>
                          )}
                          <p className="dashboard-issue-desc">{iss.user_description}</p>
                        </div>

                        <div className="dashboard-activity-side">
                          <span
                            className={`dashboard-issue-pill issue-${pillLabel
                              .toLowerCase()
                              .replace(/ /g, "-")}`}
                          >
                            {pillLabel}
                          </span>
                        </div>
                      </div>

                      {iss.image_count > 0 && (
                        <div className="dashboard-issue-photos">
                          {Array.from({ length: iss.image_count }, (_, index) => (
                            <IssuePhotoThumb
                              key={index}
                              src={issuePhotoUrl(iss.complaint_id, index)}
                              alt={`Reported photo ${index + 1}`}
                            />
                          ))}
                        </div>
                      )}

                      {isReported && !isEditing && (
                        <div className="dashboard-issue-actions">
                          <button
                            type="button"
                            className="dashboard-view-btn"
                            disabled={deletingIssueId !== null}
                            onClick={() => startEditIssue(iss)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="dashboard-issue-delete-btn"
                            disabled={deletingIssueId !== null}
                            onClick={() => deleteIssue(iss)}
                          >
                            {deletingIssueId === iss.complaint_id ? "Deleting..." : "Delete"}
                          </button>
                        </div>
                      )}

                      {!isReported && (
                        <p className="dashboard-issue-note">
                          {iss.solved
                            ? "Locked: this problem has been solved."
                            : iss.status === "Under evaluation"
                            ? "Locked: an NGO's proof for this problem is under evaluation."
                            : "Locked: this problem can no longer be edited or deleted."}
                        </p>
                      )}

                      {isEditing && (
                        <div className="dashboard-issue-form">
                          <div className="form-group">
                            <label htmlFor={`issue-desc-${iss.complaint_id}`}>Description</label>
                            <textarea
                              id={`issue-desc-${iss.complaint_id}`}
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

                          <div className="form-group">
                            <label htmlFor={`issue-loc-${iss.complaint_id}`}>Location</label>
                            <input
                              id={`issue-loc-${iss.complaint_id}`}
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

                          <div className="form-group">
                            <label htmlFor={`issue-photos-${iss.complaint_id}`}>Add photos</label>
                            <input
                              id={`issue-photos-${iss.complaint_id}`}
                              type="file"
                              accept="image/*"
                              multiple
                              disabled={freeSlots <= 0}
                              onChange={pickIssueImages(iss)}
                            />
                            <span className="form-hint">
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

                          <div className="dashboard-issue-actions">
                            <button
                              type="button"
                              className="dashboard-issue-save-btn"
                              disabled={savingIssue}
                              onClick={() => saveIssue(iss)}
                            >
                              {savingIssue ? "Saving..." : "Save changes"}
                            </button>
                            <button
                              type="button"
                              className="dashboard-view-btn"
                              disabled={savingIssue}
                              onClick={cancelEditIssue}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          </>
        )}

        {activeTab === "activity" && activitySubView === "events" && (
          <div className="dashboard-activity-list">
            {loadingActivity && (
              <p className="dashboard-placeholder-text">Loading your activity...</p>
            )}

            {!loadingActivity && activityItems.length === 0 && (
              <p className="dashboard-placeholder-text">
                You haven't joined any events yet.
              </p>
            )}

            {!loadingActivity &&
              activityItems.map((item) => (
                <div className="dashboard-activity-item" key={item.activity_id}>
                  <div className="dashboard-activity-info">
                    <p className="dashboard-event-title">{item.title}</p>
                    <p className="dashboard-event-meta">{item.ngo_name}</p>
                    <p className="dashboard-event-meta">
                      {item.event_date
                        ? new Date(item.event_date).toLocaleDateString("en-IN", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })
                        : "Date to be announced"}
                      {item.location ? ` · ${item.location}` : ""}
                    </p>

                    {item.attendance_status === "attended" && (
                      <>
                        <p className="dashboard-activity-rating">
                          Your rating:{" "}
                          {"★".repeat(item.rating || 0) +
                            "☆".repeat(5 - (item.rating || 0))}
                        </p>
                        {item.feedback && (
                          <div className="dashboard-activity-feedback">
                            <span className="dashboard-activity-feedback-label">
                              NGO feedback:
                            </span>
                            <p>{item.feedback}</p>
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  <div className="dashboard-activity-side">
                    <span
                      className={`dashboard-activity-pill activity-${item.status_label
                        .toLowerCase()
                        .replace(/ /g, "-")}`}
                    >
                      {item.status_label}
                    </span>

                    {item.ngo_email && (
                      <button
                        type="button"
                        className="dashboard-sidebar-msg-btn dashboard-activity-msg-btn"
                        onClick={() => {
                          setChatTarget({
                            email: item.ngo_email,
                            name: item.ngo_name,
                          });
                          setActiveTab("messages");
                        }}
                      >
                        Message NGO
                      </button>
                    )}
                  </div>
                </div>
              ))}
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

                                {ev.approved && (
                                  <div className="dashboard-event-actions">
                                    <span className="dashboard-approved-label">
                                      Approved
                                    </span>
                                  </div>
                                )}
                                {ev.joined && !ev.approved && (
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

import { useEffect, useState } from "react";
import "./VolunteerDashboard.css";

const API_BASE = "http://127.0.0.1:8000";
const SECTORS = ["Education", "Health", "Environment", "Animal Welfare", "Social Services"];

export default function VolunteerDashboard({ email, showToast, setPage }) {
  const [profile, setProfile] = useState(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [ngos, setNgos] = useState([]);
  const [loadingNgos, setLoadingNgos] = useState(true);
  const [activeTab, setActiveTab] = useState("profile");
  const [search, setSearch] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [sectorFilter, setSectorFilter] = useState("");
  const [expandedNgo, setExpandedNgo] = useState(null);

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

  const locations = Array.from(
    new Set(ngos.map((n) => n.location).filter(Boolean))
  ).sort();

  const filteredNgos = ngos
    .filter((n) =>
      n.name.toLowerCase().includes(search.trim().toLowerCase())
    )
    .filter((n) => !locationFilter || n.location === locationFilter)
    .filter((n) => !sectorFilter || n.category === sectorFilter)
    .sort((a, b) => a.name.localeCompare(b.name));

  const urgencyClass = (urgency) => {
    if (urgency === "high") return "dashboard-urgency-badge urgency-high";
    if (urgency === "low") return "dashboard-urgency-badge urgency-low";
    return "dashboard-urgency-badge urgency-medium";
  };

  const urgencyLabel = (urgency) => {
    if (!urgency) return "Medium";
    return urgency.charAt(0).toUpperCase() + urgency.slice(1);
  };

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
              onClick={() => setActiveTab("messages")}
            >
              Messages
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
            onClick={() => setPage("report")}
          >
            Report a problem
          </button>
        </div>

        {activeTab !== "profile" ? (
          <div className="dashboard-placeholder-card">
            <p className="dashboard-placeholder-title">
              {activeTab === "messages" ? "Messages" : "Settings"}
            </p>
            <p className="dashboard-placeholder-text">
              {activeTab === "messages"
                ? "Direct messaging with NGOs is coming soon."
                : "Account settings are coming soon."}
            </p>
          </div>
        ) : (
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
                            <span className={urgencyClass(ngo.urgency)}>
                              {urgencyLabel(ngo.urgency)}
                            </span>

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
                          </div>
                        </div>

                        {expandedNgo === ngo.name && (
                          <div className="dashboard-ngo-detail">
                            <p>
                              {ngo.requirement ||
                                "No requirement details provided."}
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
                  <p className="dashboard-placeholder-title">Messages</p>
                  <p className="dashboard-placeholder-text">
                    Direct messaging with NGOs is coming soon.
                  </p>
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

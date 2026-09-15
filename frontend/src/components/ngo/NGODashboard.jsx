import { useEffect, useState } from "react";
import "./NGODashboard.css";

const API_BASE = "http://127.0.0.1:8000";

export default function NGODashboard({ email, showToast, setPage }) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!email) {
      setPage("dashboard-login");
      return;
    }

    let cancelled = false;

    const fetchProfile = async () => {
      setLoading(true);

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
          setLoading(false);
        }
      }
    };

    fetchProfile();

    return () => {
      cancelled = true;
    };
  }, [email, setPage, showToast]);

  const badgeClass = (status) => {
    if (status === "Approved") return "verification-badge verification-approved";
    if (status === "Rejected") return "verification-badge verification-rejected";
    return "verification-badge verification-pending";
  };

  if (loading) {
    return (
      <div className="page form-page">
        <div className="form-card ngo-dashboard-card">
          <p className="form-subtitle">Loading your dashboard...</p>
        </div>
      </div>
    );
  }

  if (!profile) {
    return null;
  }

  return (
    <div className="page form-page">
      <div className="form-card ngo-dashboard-card">
        <div className="form-header">
          <div className="form-icon-wrap ngo-icon">
            <svg
              width="26"
              height="26"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--sage)"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 21h18" />
              <path d="M5 21V7l7-4 7 4v14" />
              <path d="M9 21v-6h6v6" />
            </svg>
          </div>

          <h2 className="form-title">{profile.name}</h2>

          <span className={badgeClass(profile.verification_status)}>
            {profile.verification_status}
          </span>

          <p className="form-subtitle">NGO Dashboard</p>
        </div>

        <div className="dashboard-stats-row">
          <div className="dashboard-stat-card">
            <span className="dashboard-stat-value">0</span>
            <span className="dashboard-stat-label">Workshops Hosted</span>
          </div>

          <div className="dashboard-stat-card">
            <span className="dashboard-stat-value">0</span>
            <span className="dashboard-stat-label">Contributions</span>
          </div>
        </div>

        <div className="form-section">
          <div className="form-section-header">
            <span className="form-section-title">Organization Details</span>
          </div>

          <div className="dashboard-detail-row">
            <span className="dashboard-detail-label">Email</span>
            <span className="dashboard-detail-value">{profile.email || "—"}</span>
          </div>

          <div className="dashboard-detail-row">
            <span className="dashboard-detail-label">Contact Number</span>
            <span className="dashboard-detail-value">{profile.contact_number || "—"}</span>
          </div>

          <div className="dashboard-detail-row">
            <span className="dashboard-detail-label">Category</span>
            <span className="dashboard-detail-value">{profile.category || "—"}</span>
          </div>

          <div className="dashboard-detail-row">
            <span className="dashboard-detail-label">Location</span>
            <span className="dashboard-detail-value">{profile.location || "—"}</span>
          </div>

          <div className="dashboard-detail-row">
            <span className="dashboard-detail-label">Requirement</span>
            <span className="dashboard-detail-value">{profile.requirement || "—"}</span>
          </div>

          <div className="dashboard-detail-row">
            <span className="dashboard-detail-label">Year Founded</span>
            <span className="dashboard-detail-value">{profile.year_founded || "—"}</span>
          </div>

          <div className="dashboard-detail-row">
            <span className="dashboard-detail-label">Website</span>
            <span className="dashboard-detail-value">
              {profile.website_url ? (
                <a
                  href={profile.website_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="dashboard-link"
                >
                  {profile.website_url}
                </a>
              ) : (
                "—"
              )}
            </span>
          </div>
        </div>

        <div className="form-actions">
          <button
            className="form-back-btn"
            onClick={() => setPage("landing")}
            type="button"
          >
            &#8592; Back to Home
          </button>
        </div>
      </div>
    </div>
  );
}

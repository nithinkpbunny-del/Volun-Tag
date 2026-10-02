import { useState } from "react";
import "./DashboardLogin.css";

const API_BASE = "http://127.0.0.1:8000";

export default function DashboardLogin({ showToast, setPage, setDashboardEmail }) {
  const [role, setRole] = useState("volunteer");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    const trimmedEmail = email.trim();

    if (!trimmedEmail) {
      showToast("Please enter your registered email", "error");
      return;
    }

    setLoading(true);

    const endpoint =
      role === "volunteer"
        ? `${API_BASE}/volunteer-dashboard/${encodeURIComponent(trimmedEmail)}`
        : `${API_BASE}/ngo-dashboard/${encodeURIComponent(trimmedEmail)}`;

    try {
      const res = await fetch(endpoint);

      if (!res.ok) {
        let data = {};

        try {
          data = await res.json();
        } catch {
          data = {};
        }

        throw new Error(data.detail || "No matching profile found");
      }

      setDashboardEmail(trimmedEmail);
      setPage(role === "volunteer" ? "volunteer-dashboard" : "ngo-dashboard");
    } catch (err) {
      showToast(err.message || "Unable to connect to backend", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page form-page">
      <div className="form-card dashboard-login-card">
        <div className="form-header">
          <h2 className="form-title">View My Dashboard</h2>
          <p className="form-subtitle">
            Enter your registered email to view your profile
          </p>
        </div>

        <div className="form-step fade-in">
          <div className="form-group">
            <label>I am a</label>

            <div className="radio-group" role="radiogroup" aria-label="Role">
              <label className="radio-option">
                <input
                  type="radio"
                  name="dashboard-role"
                  value="volunteer"
                  checked={role === "volunteer"}
                  onChange={() => setRole("volunteer")}
                />
                <span className="radio-custom" />
                <span className="radio-label-text">Volunteer</span>
              </label>

              <label className="radio-option">
                <input
                  type="radio"
                  name="dashboard-role"
                  value="ngo"
                  checked={role === "ngo"}
                  onChange={() => setRole("ngo")}
                />
                <span className="radio-custom" />
                <span className="radio-label-text">NGO</span>
              </label>
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="dashboard-login-email">
              Registered Email <span className="required">*</span>
            </label>

            <input
              id="dashboard-login-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="form-actions">
            <button
              className="form-back-btn"
              onClick={() => setPage("landing")}
              type="button"
            >
              &#8592; Back
            </button>

            <button
              className={`submit-btn ${loading ? "loading" : ""}`}
              onClick={handleSubmit}
              disabled={loading}
              id="dashboard-login-submit"
            >
              {loading ? "Loading..." : "View Dashboard"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

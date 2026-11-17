import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import "./DashboardLogin.css";
import { loginUser } from "../api";
import { PATHS, dashboardFor } from "../routes";

const ROLES = ["volunteer", "ngo"];

export default function DashboardLogin({ showToast, onLogin }) {
  const navigate = useNavigate();
  const { state } = useLocation();
  // The reset-password page sends the user here with the role they reset.
  const [role, setRole] = useState(() =>
    state && ROLES.includes(state.role) ? state.role : "volunteer"
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (loading) return;

    const trimmedEmail = email.trim();

    if (!trimmedEmail) {
      showToast("Please enter your registered email", "error");
      return;
    }

    if (!password) {
      showToast("Please enter your password", "error");
      return;
    }

    setLoading(true);

    try {
      // Sent exactly as typed. A locked account comes back as the server's 429 message.
      const account = await loginUser(role, trimmedEmail, password);

      setPassword("");
      onLogin({ role, email: account.email || trimmedEmail });
      // Replace the /login entry so Back does not return to the login form.
      navigate(dashboardFor(role), { replace: true });
    } catch (err) {
      // The password stays in the field so a typo can be corrected.
      showToast(err.message || "Unable to connect to backend", "error");
      setLoading(false);
    }
  };

  return (
    <div className="page form-page">
      <div className="form-card dashboard-login-card">
        <div className="form-header">
          <h1 className="form-title">View My Dashboard</h1>
          <p className="form-subtitle">
            Enter your registered email and password to view your profile
          </p>
        </div>

        <form className="form-step fade-in" onSubmit={handleSubmit} noValidate>
          <div className="form-group">
            <span className="form-label" id="dashboard-login-role-label">
              I am a
            </span>

            <div
              className="radio-group"
              role="radiogroup"
              aria-labelledby="dashboard-login-role-label"
            >
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
              autoComplete="email"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="dashboard-login-password">
              Password <span className="required">*</span>
            </label>

            <input
              id="dashboard-login-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />

            <Link
              className="dashboard-login-forgot"
              to={`${PATHS["forgot-password"]}?role=${role}`}
            >
              Forgot password?
            </Link>
          </div>

          <div className="form-actions">
            <button
              className="form-back-btn"
              onClick={() => navigate(PATHS.landing)}
              type="button"
            >
              &#8592; Back
            </button>

            <button
              type="submit"
              className={`submit-btn ${loading ? "loading" : ""}`}
              disabled={loading}
              id="dashboard-login-submit"
            >
              {loading ? "Loading..." : "View Dashboard"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

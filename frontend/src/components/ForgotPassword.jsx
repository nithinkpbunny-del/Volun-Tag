import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import "./DashboardLogin.css";
import { API_BASE } from "../config";
import { errorText } from "../api";
import { PATHS } from "../routes";

const ROLES = ["volunteer", "ngo"];

// The server answers the same way whether or not the account exists, so the
// page never says which emails are registered.
const SENT_FALLBACK = "If an account exists for that email, a reset link has been sent.";

export default function ForgotPassword() {
  const [searchParams] = useSearchParams();
  const roleParam = searchParams.get("role");
  const [role, setRole] = useState(ROLES.includes(roleParam) ? roleParam : "volunteer");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("idle"); // idle | sending | sent
  const [sentMessage, setSentMessage] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (status === "sending") return;

    const trimmed = email.trim();

    if (!trimmed) {
      setError("Please enter the email you registered with.");
      return;
    }

    setError("");
    setStatus("sending");

    try {
      const res = await fetch(`${API_BASE}/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, email: trimmed }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(errorText(data, "Could not send the reset link. Please try again."));
        setStatus("idle");
        return;
      }

      setSentMessage(typeof data.message === "string" && data.message ? data.message : SENT_FALLBACK);
      setStatus("sent");
    } catch {
      setError("Could not reach VolunTag. Check your connection and try again.");
      setStatus("idle");
    }
  };

  return (
    <div className="page form-page">
      <div className="form-card dashboard-login-card">
        <div className="form-header">
          <h1 className="form-title">Forgot your password?</h1>
          <p className="form-subtitle">
            Enter the email you registered with and we will send you a link to choose a new password.
          </p>
        </div>

        {status === "sent" ? (
          <div className="form-step fade-in">
            <div className="auth-message auth-message--success" role="status">
              <p>{sentMessage}</p>
              <p>
                Check your inbox (and the spam folder). The link works once and expires after
                30 minutes. Requesting a new link cancels the old one.
              </p>
            </div>

            <div className="auth-links">
              <Link className="auth-link" to={PATHS["dashboard-login"]} state={{ role }}>
                Back to log in
              </Link>
              <button
                type="button"
                className="auth-link auth-link-button"
                onClick={() => {
                  setStatus("idle");
                  setSentMessage("");
                }}
              >
                Send another link
              </button>
            </div>
          </div>
        ) : (
          <form className="form-step fade-in" onSubmit={handleSubmit} noValidate>
            <div className="form-group">
              <span className="form-label" id="forgot-role-label">
                I am a
              </span>

              <div className="radio-group" role="radiogroup" aria-labelledby="forgot-role-label">
                {ROLES.map((value) => (
                  <label className="radio-option" key={value}>
                    <input
                      type="radio"
                      name="forgot-role"
                      value={value}
                      checked={role === value}
                      onChange={() => setRole(value)}
                    />
                    <span className="radio-custom" />
                    <span className="radio-label-text">
                      {value === "ngo" ? "NGO" : "Volunteer"}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="forgot-email">
                Registered Email <span className="required">*</span>
              </label>
              <input
                id="forgot-email"
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setError("");
                }}
                autoComplete="email"
                required
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? "forgot-error" : undefined}
              />
            </div>

            {error && (
              <div className="auth-message auth-message--error" role="alert" id="forgot-error">
                <p>{error}</p>
              </div>
            )}

            <div className="form-actions">
              <Link className="form-back-btn" to={PATHS["dashboard-login"]} state={{ role }}>
                &#8592; Back to log in
              </Link>

              <button
                type="submit"
                className={`submit-btn ${status === "sending" ? "loading" : ""}`}
                disabled={status === "sending"}
              >
                {status === "sending" ? "Sending..." : "Send reset link"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

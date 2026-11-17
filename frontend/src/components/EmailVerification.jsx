import { useState } from "react";
import { Link } from "react-router-dom";
import "./DashboardLogin.css";
import { resendVerification } from "../api";
import { PATHS } from "../routes";
import { Icon } from "./ui/ui";

const ROLES = ["volunteer", "ngo"];

/**
 * "Send a new link" for a known role and email (after registration, or on
 * the login screen). The server answers the same way whether or not the
 * account exists, so the text here never says which.
 */
export function ResendButton({ role, email, label = "Send a new link" }) {
  const [status, setStatus] = useState("idle"); // idle | sending | sent
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const send = async () => {
    if (status === "sending") return;
    setStatus("sending");
    setError("");

    try {
      setMessage(await resendVerification(role, email));
      setStatus("sent");
    } catch (err) {
      setError(err.message || "Could not send a new link. Please try again.");
      setStatus("idle");
    }
  };

  return (
    <div className="resend-block">
      {status === "sent" ? (
        <p className="resend-note" role="status">
          {message} It can take a minute to arrive.
        </p>
      ) : (
        <button
          type="button"
          className="auth-link auth-link-button resend-button"
          onClick={send}
          disabled={status === "sending"}
        >
          {status === "sending" ? "Sending..." : label}
        </button>
      )}
      {error && (
        <p className="resend-note resend-note--error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** Role + email form for asking a new link when nothing is known yet (expired link). */
export function ResendForm({ initialRole = "volunteer" }) {
  const [role, setRole] = useState(ROLES.includes(initialRole) ? initialRole : "volunteer");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("idle");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (status === "sending") return;

    if (!email.trim()) {
      setError("Please enter the email you registered with.");
      return;
    }

    setStatus("sending");
    setError("");

    try {
      setMessage(await resendVerification(role, email));
      setStatus("sent");
    } catch (err) {
      setError(err.message || "Could not send a new link. Please try again.");
      setStatus("idle");
    }
  };

  if (status === "sent") {
    return (
      <div className="auth-message auth-message--success" role="status">
        <p>{message}</p>
        <p>Check your inbox (and the spam folder). Only the newest link works.</p>
      </div>
    );
  }

  return (
    <form className="form-step fade-in" onSubmit={handleSubmit} noValidate>
      <div className="form-group">
        <span className="form-label" id="resend-role-label">
          I am a
        </span>
        <div className="radio-group" role="radiogroup" aria-labelledby="resend-role-label">
          {ROLES.map((value) => (
            <label className="radio-option" key={value}>
              <input
                type="radio"
                name="resend-role"
                value={value}
                checked={role === value}
                onChange={() => setRole(value)}
              />
              <span className="radio-custom" />
              <span className="radio-label-text">{value === "ngo" ? "NGO" : "Volunteer"}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="form-group">
        <label htmlFor="resend-email">
          Registered Email <span className="required">*</span>
        </label>
        <input
          id="resend-email"
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setError("");
          }}
          autoComplete="email"
          required
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "resend-error" : undefined}
        />
      </div>

      {error && (
        <div className="auth-message auth-message--error" role="alert" id="resend-error">
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
          {status === "sending" ? "Sending..." : "Send a new link"}
        </button>
      </div>
    </form>
  );
}

/**
 * Shown after both registration forms when the server asks for email
 * confirmation. The same screen appears whether or not the address already
 * had an account (the server mails that owner a notice instead), so it
 * never reveals which emails are registered.
 */
export function CheckEmail({ role, email }) {
  const roleName = role === "ngo" ? "NGO" : "volunteer";

  return (
    <div className="page form-page">
      <div className="form-card dashboard-login-card check-email-card fade-in">
        <div className="check-email-icon" aria-hidden="true">
          <Icon name="inbox" size={28} />
        </div>

        <div className="form-header">
          <h1 className="form-title">Check your email</h1>
          <p className="form-subtitle">
            We have sent a message to <strong className="check-email-address">{email}</strong>.
          </p>
        </div>

        <div className="auth-message" role="status">
          <p>
            Open the link in it to confirm your address and finish creating your {roleName}{" "}
            account. The link works once and for 24 hours.
          </p>
          <p>You can log in as soon as your email is confirmed.</p>
        </div>

        <div className="check-email-help">
          <p className="check-email-help-title">Nothing arrived?</p>
          <p className="check-email-help-text">
            Look in the spam folder, check that the address above is right, or ask for a new link.
          </p>
          <ResendButton role={role} email={email} />
        </div>

        <div className="auth-links">
          <Link className="auth-link" to={PATHS["dashboard-login"]} state={{ role }}>
            Go to log in
          </Link>
          <Link className="auth-link" to={PATHS.landing}>
            Back to home
          </Link>
        </div>
      </div>
    </div>
  );
}

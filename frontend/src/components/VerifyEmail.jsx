import { useEffect, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import "./DashboardLogin.css";
import { verifyEmailToken } from "../api";
import { PATHS } from "../routes";
import { Icon } from "./ui/ui";
import { ResendForm } from "./EmailVerification";

const TITLES = {
  checking: "Confirming your email",
  verified: "Email confirmed",
  used: "Already confirmed",
  expired: "This link has expired",
  invalid: "This link does not work",
  error: "Could not confirm your email",
};

/**
 * Opened from the link in the confirmation email: /verify-email?token=...
 *
 * The token is read once and removed from the address bar straight away, so
 * it does not stay in the history or leak through a Referer header. The
 * page then confirms it with a POST (a link checker that only opens the
 * address confirms nothing).
 *
 * States: checking -> verified | used | expired | invalid | error.
 * Expired and invalid links offer a form for a new link.
 */
export default function VerifyEmail() {
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  const [token] = useState(() => searchParams.get("token") || "");
  const [result, setResult] = useState(() =>
    token ? { status: "checking" } : { status: "invalid" }
  );
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (window.location.search.includes("token=")) {
      window.history.replaceState(window.history.state, "", pathname);
    }
  }, [pathname]);

  useEffect(() => {
    if (!token) return undefined;

    let cancelled = false;

    verifyEmailToken(token).then((answer) => {
      if (!cancelled) setResult(answer);
    });

    return () => {
      cancelled = true;
    };
  }, [token, attempt]);

  const { status } = result;
  const role = result.role || "volunteer";
  const good = status === "verified" || status === "used";

  return (
    <div className="page form-page">
      <div className="form-card dashboard-login-card check-email-card">
        <div
          className={`check-email-icon ${good ? "check-email-icon--done" : ""} ${
            status === "expired" || status === "invalid" || status === "error"
              ? "check-email-icon--problem"
              : ""
          }`}
          aria-hidden="true"
        >
          <Icon name={good ? "check" : status === "checking" ? "inbox" : "alert"} size={28} />
        </div>

        <div className="form-header">
          <h1 className="form-title">{TITLES[status] || TITLES.error}</h1>
        </div>

        {status === "checking" && (
          <p className="auth-message" role="status">
            Checking your confirmation link...
          </p>
        )}

        {status === "verified" && (
          <div className="form-step fade-in">
            <div className="auth-message auth-message--success" role="status">
              <p>Thank you. Your email address is confirmed and your account is ready.</p>
            </div>
            <div className="form-actions form-actions--single">
              <Link
                className="submit-btn submit-btn-link"
                to={PATHS["dashboard-login"]}
                state={{ role, showLogin: true }}
              >
                Log in
              </Link>
            </div>
          </div>
        )}

        {status === "used" && (
          <div className="form-step fade-in">
            <div className="auth-message auth-message--success" role="status">
              <p>This link has already been used, so your email is confirmed.</p>
              <p>You can log in with your email and password.</p>
            </div>
            <div className="form-actions form-actions--single">
              <Link
                className="submit-btn submit-btn-link"
                to={PATHS["dashboard-login"]}
                state={{ showLogin: true }}
              >
                Log in
              </Link>
            </div>
          </div>
        )}

        {(status === "expired" || status === "invalid") && (
          <div className="form-step fade-in">
            <div className="auth-message auth-message--error" role="alert">
              {status === "expired" ? (
                <p>
                  Confirmation links work for 24 hours, and asking for a new link makes the older
                  ones expire.
                </p>
              ) : (
                <p>
                  The link is incomplete or not valid. Check that you opened the whole link from the
                  email.
                </p>
              )}
              <p>Enter your email below and we will send a new link.</p>
            </div>
            <ResendForm />
          </div>
        )}

        {status === "error" && (
          <div className="form-step fade-in">
            <div className="auth-message auth-message--error" role="alert">
              <p>{result.message}</p>
            </div>
            <div className="form-actions">
              <Link className="form-back-btn" to={PATHS["dashboard-login"]}>
                &#8592; Back to log in
              </Link>
              <button
                type="button"
                className="submit-btn"
                onClick={() => {
                  setResult({ status: "checking" });
                  setAttempt((n) => n + 1);
                }}
              >
                Try again
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

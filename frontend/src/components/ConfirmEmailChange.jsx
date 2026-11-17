import { useEffect, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import "./DashboardLogin.css";
import { getSession, saveSession } from "../api";
import { PATHS, dashboardFor } from "../routes";
import { Icon } from "./ui/ui";
import { confirmEmailChange } from "./settings/settingsApi";

const TITLES = {
  checking: "Confirming your new email",
  changed: "Email address changed",
  used: "Already confirmed",
  expired: "This link has expired",
  invalid: "This link does not work",
  unavailable: "This address cannot be used",
  error: "Could not confirm your new email",
};

/**
 * Opened from the link mailed to the NEW address: /confirm-email-change?token=...
 *
 * Same pattern as VerifyEmail: the token is read once and removed from the
 * address bar straight away, then confirmed with a POST. If this browser is
 * logged in to the same account, it stays logged in with the new address;
 * every other session of the account ends.
 */
export default function ConfirmEmailChange({ onEmailChanged }) {
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  const [token] = useState(() => searchParams.get("token") || "");
  const [result, setResult] = useState(() => (token ? { status: "checking" } : { status: "invalid" }));

  useEffect(() => {
    if (window.location.search.includes("token=")) {
      window.history.replaceState(window.history.state, "", pathname);
    }
  }, [pathname]);

  useEffect(() => {
    if (!token) return undefined;

    let cancelled = false;

    confirmEmailChange(token).then((answer) => {
      if (cancelled) return;

      if (answer.status === "changed" && answer.keptSession) {
        const session = getSession();
        if (session) {
          saveSession({ ...session, email: answer.email });
          onEmailChanged?.({ role: answer.role, email: answer.email });
        }
      }

      setResult(answer);
    });

    return () => {
      cancelled = true;
    };
    // The token is read once; onEmailChanged only updates the app's state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const { status } = result;
  const good = status === "changed" || status === "used";

  return (
    <div className="page form-page">
      <div className="form-card dashboard-login-card check-email-card">
        <div
          className={`check-email-icon ${good ? "check-email-icon--done" : ""} ${
            !good && status !== "checking" ? "check-email-icon--problem" : ""
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
            Checking your link...
          </p>
        )}

        {status === "changed" && (
          <div className="form-step fade-in">
            <div className="auth-message auth-message--success" role="status">
              <p>
                Your account now uses <strong>{result.email}</strong>. Use it to log in from now on.
              </p>
              <p>Other devices were logged out, and your old address got a short notice.</p>
            </div>
            <div className="form-actions form-actions--single">
              {result.keptSession ? (
                <Link className="submit-btn submit-btn-link" to={`${dashboardFor(result.role)}?tab=settings&section=email`}>
                  Back to Settings
                </Link>
              ) : (
                <Link
                  className="submit-btn submit-btn-link"
                  to={PATHS["dashboard-login"]}
                  state={{ role: result.role, showLogin: true }}
                >
                  Log in with your new address
                </Link>
              )}
            </div>
          </div>
        )}

        {status !== "checking" && status !== "changed" && (
          <div className="form-step fade-in">
            <div
              className={`auth-message ${status === "used" ? "auth-message--success" : "auth-message--error"}`}
              role={status === "used" ? "status" : "alert"}
            >
              <p>{result.message || "This link does not work. Ask for a new one in Settings."}</p>
            </div>
            <div className="form-actions form-actions--single">
              <Link className="submit-btn submit-btn-link" to={PATHS["dashboard-login"]} state={{ showLogin: true }}>
                Go to log in
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

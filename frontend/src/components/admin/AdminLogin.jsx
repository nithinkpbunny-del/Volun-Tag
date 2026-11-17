import { useEffect, useRef, useState } from "react";
import { loginRequest } from "./adminApi";

export default function AdminLogin({ onLoggedIn }) {
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef(null);

  // The input is disabled while a request runs; give focus back for the next try.
  useEffect(() => {
    if (!loading && inputRef.current) inputRef.current.focus();
  }, [loading]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!password || loading) return;

    setLoading(true);
    setError("");

    const attempt = password;
    setPassword("");

    try {
      const data = await loginRequest(attempt);
      onLoggedIn(data.token);
    } catch (err) {
      setError(err.message || "Login failed");
      setLoading(false);
    }
  };

  return (
    <div className="adm-login-page">
      <form className="adm-login-card" onSubmit={handleSubmit} noValidate>
        <div className="adm-login-brand" aria-hidden="true">
          Volun<span className="adm-wordmark-accent">Tag</span>
        </div>
        <h1 className="adm-login-title">VolunTag Admin</h1>
        <p className="adm-login-sub">Sign in to review proofs and manage the platform.</p>

        <label className="adm-field-label" htmlFor="adm-password">
          Admin password
        </label>
        <div className="adm-password-wrap">
          <input
            id="adm-password"
            ref={inputRef}
            className="adm-input adm-password-input"
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            disabled={loading}
            aria-invalid={error ? "true" : "false"}
            aria-describedby={error ? "adm-login-error" : undefined}
          />
          <button
            type="button"
            className="adm-password-toggle"
            onClick={() => setShowPassword((v) => !v)}
            aria-pressed={showPassword}
            aria-label={showPassword ? "Hide password" : "Show password"}
          >
            {showPassword ? "Hide" : "Show"}
          </button>
        </div>

        {error && (
          <p className="adm-login-error" id="adm-login-error" role="alert">
            {error}
          </p>
        )}

        <button
          type="submit"
          className="adm-btn adm-btn--primary adm-btn--block"
          disabled={loading || !password}
        >
          {loading ? (
            <>
              <span className="adm-spinner adm-spinner--light" aria-hidden="true" />
              Logging in…
            </>
          ) : (
            "Log in"
          )}
        </button>

        <a className="adm-login-back" href="/">
          ← Back to VolunTag
        </a>
      </form>
    </div>
  );
}

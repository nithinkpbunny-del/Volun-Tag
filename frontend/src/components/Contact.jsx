import { useState } from "react";
import "./DashboardLogin.css";
import "./InfoPages.css";
import { API_BASE } from "../config";
import { errorText, getSession } from "../api";
import { CONTACT_EMAIL, REPO_URL } from "../content/contact";

// Same limits as the server (ContactRequest in backend/schemas.py).
const LIMITS = {
  nameMin: 2,
  nameMax: 100,
  subjectMax: 150,
  messageMin: 10,
  messageMax: 2000,
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ROLE_OPTIONS = [
  { value: "", label: "Prefer not to say" },
  { value: "volunteer", label: "A volunteer" },
  { value: "ngo", label: "An NGO" },
  { value: "other", label: "Someone else" },
];

const FIELDS = ["name", "email", "subject", "message", "role"];

const emptyForm = (email = "") => ({
  name: "",
  email,
  subject: "",
  message: "",
  role: "",
});

function validate(form) {
  const errors = {};
  const name = form.name.trim();
  const email = form.email.trim();
  const message = form.message.trim();

  if (name.length < LIMITS.nameMin) errors.name = "Please enter your name (at least 2 characters).";
  else if (name.length > LIMITS.nameMax) errors.name = `Please keep your name under ${LIMITS.nameMax} characters.`;

  if (!email) errors.email = "Please enter your email so we can get back to you.";
  else if (!EMAIL_PATTERN.test(email)) errors.email = "Please enter a valid email address.";

  if (form.subject.trim().length > LIMITS.subjectMax) {
    errors.subject = `Please keep the subject under ${LIMITS.subjectMax} characters.`;
  }

  if (message.length < LIMITS.messageMin) {
    errors.message = `Please write a little more (at least ${LIMITS.messageMin} characters).`;
  } else if (message.length > LIMITS.messageMax) {
    errors.message = `Please keep the message under ${LIMITS.messageMax} characters.`;
  }

  return errors;
}

/** Field errors from a FastAPI 422 list ({detail: [{loc: [..., "field"], msg}]}). */
function serverFieldErrors(data) {
  const errors = {};

  if (!data || !Array.isArray(data.detail)) return errors;

  data.detail.forEach((item) => {
    const field = Array.isArray(item.loc) ? item.loc[item.loc.length - 1] : "";
    if (FIELDS.includes(field) && !errors[field]) {
      errors[field] = String(item.msg || "This value is not valid.").replace(/^Value error, /, "");
    }
  });

  return errors;
}

export default function Contact() {
  const [form, setForm] = useState(() => {
    // A logged-in user does not need to type their email again.
    const session = getSession();
    return emptyForm(session ? session.email : "");
  });
  // The honeypot: hidden from people, bots tend to fill it in.
  const [website, setWebsite] = useState("");
  const [errors, setErrors] = useState({});
  const [status, setStatus] = useState("idle"); // idle | sending | sent
  const [serverError, setServerError] = useState("");

  const onField = (field) => (e) => {
    const value = e.target.value;
    setForm((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: "" }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (status === "sending") return;

    const found = validate(form);
    setErrors(found);
    setServerError("");

    if (Object.keys(found).length > 0) return;

    setStatus("sending");

    try {
      const res = await fetch(`${API_BASE}/contact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          email: form.email.trim(),
          subject: form.subject.trim(),
          message: form.message.trim(),
          role: form.role || null,
          website,
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.ok) {
        setStatus("sent");
        setForm(emptyForm());
        setErrors({});
        return;
      }

      if (res.status === 422) {
        const fieldErrors = serverFieldErrors(data);
        setErrors(fieldErrors);
        if (Object.keys(fieldErrors).length === 0) {
          setServerError(errorText(data, "Please check the form and try again."));
        }
      } else if (res.status === 429) {
        setServerError(
          errorText(data, "You have sent several messages recently. Please try again later.")
        );
      } else {
        setServerError("Your message could not be sent right now. Please try again in a moment.");
      }

      setStatus("idle");
    } catch {
      setServerError("Could not reach VolunTag. Check your connection and try again.");
      setStatus("idle");
    }
  };

  const describedBy = (field, extra) =>
    [errors[field] ? `contact-${field}-error` : "", extra || ""].filter(Boolean).join(" ") ||
    undefined;

  const messageLength = form.message.trim().length;

  return (
    <div className="page info-page">
      <div className="info-container">
        <header className="info-hero">
          <h1 className="info-title">Contact us</h1>
          <p className="info-lead">
            Questions about VolunTag, a problem with your account, or an idea for the project? Send
            us a message.
          </p>
        </header>

        <div className="contact-layout">
          <section className="form-card dashboard-login-card contact-card" aria-labelledby="contact-form-heading">
            <h2 className="info-section-title" id="contact-form-heading">
              Send a message
            </h2>

            {status === "sent" ? (
              <div className="form-step fade-in">
                <div className="auth-message auth-message--success" role="status">
                  <p>Thanks, we received your message.</p>
                  <p>We’ll read it and get back to you.</p>
                </div>
                <button
                  type="button"
                  className="auth-link auth-link-button"
                  onClick={() => setStatus("idle")}
                >
                  Send another message
                </button>
              </div>
            ) : (
              <form className="form-step" onSubmit={handleSubmit} noValidate>
                <div className="form-group">
                  <label htmlFor="contact-name">
                    Name <span className="required">*</span>
                  </label>
                  <input
                    id="contact-name"
                    type="text"
                    value={form.name}
                    onChange={onField("name")}
                    autoComplete="name"
                    maxLength={LIMITS.nameMax}
                    required
                    className={errors.name ? "input-error" : ""}
                    aria-invalid={errors.name ? true : undefined}
                    aria-describedby={describedBy("name")}
                  />
                  {errors.name && (
                    <span className="error-text" id="contact-name-error">{errors.name}</span>
                  )}
                </div>

                <div className="form-group">
                  <label htmlFor="contact-email">
                    Email <span className="required">*</span>
                  </label>
                  <input
                    id="contact-email"
                    type="email"
                    value={form.email}
                    onChange={onField("email")}
                    autoComplete="email"
                    required
                    className={errors.email ? "input-error" : ""}
                    aria-invalid={errors.email ? true : undefined}
                    aria-describedby={describedBy("email")}
                  />
                  {errors.email && (
                    <span className="error-text" id="contact-email-error">{errors.email}</span>
                  )}
                </div>

                <div className="form-group">
                  <label htmlFor="contact-role">I am</label>
                  <select id="contact-role" value={form.role} onChange={onField("role")}>
                    {ROLE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label htmlFor="contact-subject">Subject (optional)</label>
                  <input
                    id="contact-subject"
                    type="text"
                    value={form.subject}
                    onChange={onField("subject")}
                    maxLength={LIMITS.subjectMax}
                    className={errors.subject ? "input-error" : ""}
                    aria-invalid={errors.subject ? true : undefined}
                    aria-describedby={describedBy("subject")}
                  />
                  {errors.subject && (
                    <span className="error-text" id="contact-subject-error">{errors.subject}</span>
                  )}
                </div>

                <div className="form-group">
                  <label htmlFor="contact-message">
                    Message <span className="required">*</span>
                  </label>
                  <textarea
                    id="contact-message"
                    rows={6}
                    value={form.message}
                    onChange={onField("message")}
                    maxLength={LIMITS.messageMax}
                    required
                    className={errors.message ? "input-error" : ""}
                    aria-invalid={errors.message ? true : undefined}
                    aria-describedby={describedBy("message", "contact-message-count")}
                  />
                  <span className="form-hint" id="contact-message-count">
                    {messageLength} / {LIMITS.messageMax} characters
                  </span>
                  {errors.message && (
                    <span className="error-text" id="contact-message-error">{errors.message}</span>
                  )}
                </div>

                {/* Honeypot: people never see or reach this field. */}
                <div className="contact-honeypot" aria-hidden="true">
                  <label htmlFor="contact-website">Website</label>
                  <input
                    id="contact-website"
                    name="website"
                    type="text"
                    tabIndex={-1}
                    autoComplete="off"
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                  />
                </div>

                {serverError && (
                  <div className="auth-message auth-message--error" role="alert">
                    <p>{serverError}</p>
                    <p>Your message is still here, so you can send it again.</p>
                  </div>
                )}

                <div className="form-actions">
                  <button
                    type="submit"
                    className={`submit-btn ${status === "sending" ? "loading" : ""}`}
                    disabled={status === "sending"}
                  >
                    {status === "sending" ? "Sending..." : serverError ? "Try again" : "Send message"}
                  </button>
                </div>
              </form>
            )}
          </section>

          <aside className="info-card contact-aside" aria-labelledby="contact-other-heading">
            <h2 className="info-section-title" id="contact-other-heading">
              Other ways to reach us
            </h2>
            <dl className="contact-details">
              <dt>Email</dt>
              <dd>
                <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
              </dd>
              <dt>Source code</dt>
              <dd>
                <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
                  VolunTag on GitHub
                </a>
              </dd>
            </dl>
            <p className="info-muted">
              For a problem in your area, log in as a volunteer and use “Report a problem” instead,
              so it reaches the NGOs that work on it.
            </p>
          </aside>
        </div>
      </div>
    </div>
  );
}

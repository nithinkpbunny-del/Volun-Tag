import { useCallback, useEffect, useRef, useState } from "react";
import AdminConversation, { startConversationRequest } from "./AdminConversation";
import AdminNGODetail, {
  ATTENDANCE_LABELS,
  EVENT_PILL,
  InfoField,
  ROLE_LABELS,
  countText,
  ratingText,
} from "./AdminNGODetail";
import { StatusPill } from "./AdminProofDetail";
import { formatIST, getVolunteer, orNotProvided } from "./adminApi";

const TABS = [
  { id: "profile", label: "Profile" },
  { id: "activity", label: "Activity" },
  { id: "problems", label: "Reported problems" },
  { id: "messages", label: "Messages" },
];

/**
 * One volunteer, loaded once on open. NGO pages and conversations open in
 * place so Back returns here with the tab intact.
 */
export default function AdminVolunteerDetail({
  volunteerId,
  showToast,
  onBack,
  backLabel = "Back to volunteers",
  onDataChanged,
}) {
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [tab, setTab] = useState("profile");
  const [ngoView, setNgoView] = useState(null); // { id, ngoId, eventId }
  const [conversation, setConversation] = useState(null);

  const requestSeq = useRef(0);
  const started = useRef(false);
  const nestedChanged = useRef(false);
  const viewSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++requestSeq.current;
    setLoadError("");

    try {
      const result = await getVolunteer(volunteerId);
      if (seq === requestSeq.current) setData(result);
    } catch (err) {
      if (seq === requestSeq.current && err.status !== 401) {
        setLoadError(err.message || "Could not load this volunteer");
      }
    }
  }, [volunteerId]);

  // Load once on open (the guard also covers StrictMode's double effect).
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    load();
  }, [load]);

  const openNgo = (entry) => {
    if (entry.ngo_id === null || entry.ngo_id === undefined) return;

    viewSeq.current += 1;
    setNgoView({ id: viewSeq.current, ngoId: entry.ngo_id, eventId: entry.event_id });
    window.scrollTo({ top: 0, behavior: "instant" });
  };

  const closeNgo = () => {
    setNgoView(null);
    window.scrollTo({ top: 0, behavior: "instant" });
    // Reload only if a proof was approved or rejected from the NGO page.
    if (nestedChanged.current) {
      nestedChanged.current = false;
      load();
    }
  };

  const handleNestedChanged = () => {
    nestedChanged.current = true;
    if (onDataChanged) onDataChanged();
  };

  // The audited request starts here, in the click handler, exactly once per click.
  const openConversation = (summary) => {
    const volunteerEmail = data && data.profile.email;
    if (!volunteerEmail) return;

    viewSeq.current += 1;
    setConversation({
      id: viewSeq.current,
      a: volunteerEmail,
      b: summary.email,
      request: startConversationRequest(volunteerEmail, summary.email),
    });
    window.scrollTo({ top: 0, behavior: "instant" });
  };

  const closeConversation = () => {
    setConversation(null);
    window.scrollTo({ top: 0, behavior: "instant" });
  };

  const volunteerName = data ? data.profile.name : "volunteer";

  if (ngoView) {
    return (
      <AdminNGODetail
        key={ngoView.id}
        ngoId={ngoView.ngoId}
        showToast={showToast}
        onBack={closeNgo}
        backLabel={`Back to ${volunteerName}`}
        onDataChanged={handleNestedChanged}
        initialTab="events"
        initialEventId={ngoView.eventId}
      />
    );
  }

  if (conversation) {
    return (
      <AdminConversation
        key={conversation.id}
        a={conversation.a}
        b={conversation.b}
        initialRequest={conversation.request}
        onBack={closeConversation}
        backLabel={`Back to ${volunteerName}`}
      />
    );
  }

  const backButton = (
    <button type="button" className="adm-back" onClick={onBack}>
      <span aria-hidden="true">←</span> {backLabel}
    </button>
  );

  if (!data) {
    return (
      <section className="adm-page">
        {backButton}
        {loadError ? (
          <div className="adm-state adm-state--error" role="alert">
            <p>{loadError}</p>
            <button type="button" className="adm-btn adm-btn--secondary" onClick={load}>
              Try again
            </button>
          </div>
        ) : (
          <div className="adm-state" role="status">
            <span className="adm-spinner" aria-hidden="true" />
            Loading volunteer…
          </div>
        )}
      </section>
    );
  }

  const { profile, stats } = data;
  const activity = data.activity || [];
  const problems = data.problems || [];
  const conversations = data.conversations || [];

  return (
    <section className="adm-page" aria-labelledby="adm-volunteer-title">
      {backButton}

      <header className="adm-detail-header">
        <div>
          <p className="adm-eyebrow">Volunteer #{data.id}</p>
          <h1 className="adm-page-title" id="adm-volunteer-title">{profile.name}</h1>
          <p className="adm-page-sub">{orNotProvided(profile.email, "No email on file")}</p>
        </div>
      </header>

      <dl className="adm-mini-stats">
        <div className="adm-mini-stat">
          <dt>Signups</dt>
          <dd>
            <span className="adm-mini-stat-value">{countText(stats.signups_total)}</span>
            <span className="adm-mini-stat-sub">{countText(stats.signups_approved)} approved</span>
          </dd>
        </div>
        <div className="adm-mini-stat">
          <dt>Events attended</dt>
          <dd>
            <span className="adm-mini-stat-value">{countText(stats.events_attended)}</span>
            <span className="adm-mini-stat-sub">{countText(stats.events_not_attended)} not attended</span>
          </dd>
        </div>
        <div className="adm-mini-stat">
          <dt>Average rating received</dt>
          <dd>
            <span className="adm-mini-stat-value">
              {ratingText(stats.average_rating_received, "No ratings yet")}
            </span>
          </dd>
        </div>
        <div className="adm-mini-stat">
          <dt>Issues reported</dt>
          <dd>
            <span className="adm-mini-stat-value">{countText(stats.issues_reported)}</span>
            <span className="adm-mini-stat-sub">{countText(stats.issues_resolved)} resolved</span>
          </dd>
        </div>
      </dl>

      <div className="adm-tabs" role="group" aria-label="Volunteer sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-pressed={t.id === tab}
            className={`adm-tab${t.id === tab ? " adm-tab--active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Profile ── */}
      {tab === "profile" && (
        <article className="adm-card">
          <h2 className="adm-card-title">Registration details</h2>
          <dl className="adm-fields">
            <InfoField label="Name">{orNotProvided(profile.name)}</InfoField>
            <InfoField label="Email">{orNotProvided(profile.email)}</InfoField>
            <InfoField label="Contact number">{orNotProvided(profile.contact_number)}</InfoField>
            <InfoField label="Age">{orNotProvided(profile.age)}</InfoField>
            <InfoField label="Designation">{orNotProvided(profile.designation)}</InfoField>
            <InfoField label="Gender">{orNotProvided(profile.gender)}</InfoField>
            <InfoField label="Skills">
              <span className="adm-cell-wrap">{orNotProvided(profile.skills)}</span>
            </InfoField>
            <InfoField label="Location">{orNotProvided(profile.location)}</InfoField>
            <InfoField label="Availability">{orNotProvided(profile.availability)}</InfoField>
            <InfoField label="Experience">
              <span className="adm-cell-wrap">{orNotProvided(profile.experience)}</span>
            </InfoField>
          </dl>
        </article>
      )}

      {/* ── Activity ── */}
      {tab === "activity" && (
        <article className="adm-card">
          <h2 className="adm-card-title">Event activity</h2>
          {activity.length === 0 ? (
            <p className="adm-muted">This volunteer has not signed up for any events.</p>
          ) : (
            <div className="adm-table-wrap">
              <table className="adm-table">
                <thead>
                  <tr>
                    <th scope="col">Event</th>
                    <th scope="col">NGO</th>
                    <th scope="col">Date</th>
                    <th scope="col">Status</th>
                    <th scope="col">Signup</th>
                    <th scope="col">Attendance</th>
                    <th scope="col">Rating</th>
                    <th scope="col">Feedback</th>
                  </tr>
                </thead>
                <tbody>
                  {activity.map((entry) => (
                    <tr key={`${entry.event_id}-${entry.signed_up_at}`}>
                      <td className="adm-cell-wrap">{orNotProvided(entry.event_title, "Unknown event")}</td>
                      <td>
                        {entry.ngo_id !== null && entry.ngo_id !== undefined ? (
                          <button
                            type="button"
                            className="adm-link-btn adm-link-btn--strong"
                            onClick={() => openNgo(entry)}
                            title="Open this NGO on its Events tab"
                          >
                            {orNotProvided(entry.ngo_name, "Unknown NGO")}
                          </button>
                        ) : (
                          orNotProvided(entry.ngo_name, "—")
                        )}
                      </td>
                      <td className="adm-nowrap">
                        {entry.event_date ? formatIST(entry.event_date) : "No date set"}
                      </td>
                      <td>
                        <span
                          className={`adm-pill adm-pill--${EVENT_PILL[entry.event_status_label] || "closed"}`}
                        >
                          {orNotProvided(entry.event_status_label, "Unknown")}
                        </span>
                      </td>
                      <td className="adm-nowrap">{orNotProvided(entry.signup_status, "—")}</td>
                      <td className="adm-nowrap">{ATTENDANCE_LABELS[entry.attendance_status] || "—"}</td>
                      <td className="adm-nowrap">{ratingText(entry.rating)}</td>
                      <td className="adm-cell-wrap">{orNotProvided(entry.feedback, "—")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </article>
      )}

      {/* ── Reported problems ── */}
      {tab === "problems" && (
        <article className="adm-card">
          <h2 className="adm-card-title">Reported problems</h2>
          {problems.length === 0 ? (
            <p className="adm-muted">This volunteer has not reported any problems.</p>
          ) : (
            <div className="adm-table-wrap">
              <table className="adm-table">
                <thead>
                  <tr>
                    <th scope="col">Complaint ID</th>
                    <th scope="col">Location</th>
                    <th scope="col">Status</th>
                    <th scope="col">Reported</th>
                    <th scope="col">Solved by</th>
                  </tr>
                </thead>
                <tbody>
                  {problems.map((problem) => (
                    <tr key={problem.complaint_id}>
                      <td className="adm-id adm-nowrap">{problem.complaint_id}</td>
                      <td className="adm-cell-wrap">{orNotProvided(problem.location)}</td>
                      <td><StatusPill status={problem.status} /></td>
                      <td className="adm-nowrap">{formatIST(problem.created_at)}</td>
                      <td>{orNotProvided(problem.solved_by, "—")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </article>
      )}

      {/* ── Messages ── */}
      {tab === "messages" && (
        <article className="adm-card">
          <h2 className="adm-card-title">Conversations</h2>
          <p className="adm-muted adm-card-note">
            Opening a conversation is recorded in the audit log.
          </p>
          {conversations.length === 0 ? (
            <p className="adm-muted">This volunteer has no conversations.</p>
          ) : (
            <ul className="adm-conv-list">
              {conversations.map((c) => (
                <li key={c.email}>
                  <button
                    type="button"
                    className="adm-conv-row"
                    onClick={() => openConversation(c)}
                  >
                    <span className="adm-conv-who">
                      <span className="adm-conv-name">{orNotProvided(c.name, c.email)}</span>
                      <span className="adm-conv-meta">
                        {ROLE_LABELS[c.role] || "Unknown"} · {c.email}
                      </span>
                    </span>
                    <span className="adm-conv-count">
                      {c.message_count} {c.message_count === 1 ? "message" : "messages"}
                    </span>
                    <span className="adm-conv-date">Last activity {formatIST(c.last_message_at)}</span>
                    <span className="adm-proof-row-open" aria-hidden="true">→</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </article>
      )}
    </section>
  );
}

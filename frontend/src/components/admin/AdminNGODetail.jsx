import { useCallback, useEffect, useRef, useState } from "react";
import AdminConversation, { startConversationRequest } from "./AdminConversation";
import AdminDocumentViewer from "./AdminDocumentViewer";
import AdminProofDetail, { StatusPill, solutionTypeLabel } from "./AdminProofDetail";
import { formatIST, getEvent, getNGO, orNotProvided } from "./adminApi";

const TABS = [
  { id: "profile", label: "Profile" },
  { id: "events", label: "Events" },
  { id: "problems", label: "Problems" },
  { id: "messages", label: "Messages" },
];

const EVENT_PILL = {
  Upcoming: "pending",
  Completed: "approved",
  Cancelled: "rejected",
  Filled: "closed",
};

const ATTENDANCE_LABELS = { attended: "Attended", not_attended: "Not attended" };

const ROLE_LABELS = { ngo: "NGO", volunteer: "Volunteer" };

const EVENT_COLUMNS = 8;

function InfoField({ label, children }) {
  return (
    <div className="adm-field">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function ratingText(value, empty = "—") {
  return value === null || value === undefined ? empty : `${value} / 5`;
}

function countText(value) {
  return value === null || value === undefined ? "—" : String(value);
}

function WebsiteValue({ url }) {
  const text = orNotProvided(url);
  if (text === "Not provided") return text;

  // Only http(s) links are clickable; anything else stays plain text.
  if (/^https?:\/\//i.test(text)) {
    return (
      <a className="adm-text-link" href={text} target="_blank" rel="noopener noreferrer">
        {text}
      </a>
    );
  }
  return text;
}

function EventVolunteers({ entry, onRetry }) {
  if (!entry || entry.status === "loading") {
    return (
      <p className="adm-inline-state" role="status">
        <span className="adm-spinner" aria-hidden="true" />
        Loading volunteers…
      </p>
    );
  }

  if (entry.status === "error") {
    return (
      <div className="adm-inline-state adm-inline-state--error" role="alert">
        <span>{entry.error}</span>
        <button type="button" className="adm-btn adm-btn--secondary adm-btn--sm" onClick={onRetry}>
          Try again
        </button>
      </div>
    );
  }

  const volunteers = entry.data.volunteers || [];

  if (volunteers.length === 0) {
    return <p className="adm-inline-state">No volunteers have signed up for this event.</p>;
  }

  return (
    <div className="adm-table-wrap">
      <table className="adm-table adm-table--nested">
        <thead>
          <tr>
            <th scope="col">Volunteer</th>
            <th scope="col">Email</th>
            <th scope="col">Signup</th>
            <th scope="col">Attendance</th>
            <th scope="col">Rating</th>
            <th scope="col">Feedback</th>
          </tr>
        </thead>
        <tbody>
          {volunteers.map((v) => (
            <tr key={`${v.volunteer_id}-${v.created_at}`}>
              <td>{orNotProvided(v.name, "Unknown volunteer")}</td>
              <td>{orNotProvided(v.email, "—")}</td>
              <td>{orNotProvided(v.signup_status, "—")}</td>
              <td>{ATTENDANCE_LABELS[v.attendance_status] || "—"}</td>
              <td>{ratingText(v.rating)}</td>
              <td className="adm-cell-wrap">{orNotProvided(v.feedback, "—")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * One NGO, loaded once on open. Proof details and conversations open in
 * place so Back returns here with the tab and expanded events intact.
 */
export default function AdminNGODetail({
  ngoId,
  showToast,
  onBack,
  backLabel = "Back to NGOs",
  onDataChanged,
  initialTab = "profile",
  initialEventId = null,
  initialEvent = null,
}) {
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [tab, setTab] = useState(initialTab);

  const [expanded, setExpanded] = useState(() =>
    initialEventId !== null ? { [initialEventId]: true } : {}
  );
  const [eventCache, setEventCache] = useState(() =>
    initialEvent ? { [initialEvent.id]: { status: "ready", data: initialEvent } } : {}
  );

  const [proofId, setProofId] = useState(null);
  const [conversation, setConversation] = useState(null);

  const requestSeq = useRef(0);
  const started = useRef(false);
  const proofChanged = useRef(false);
  const conversationSeq = useRef(0);
  const scrolledToEvent = useRef(false);

  // Event ids whose volunteers are loaded or loading, so each is fetched once.
  const eventRequests = useRef(new Set(initialEvent ? [initialEvent.id] : []));

  const load = useCallback(async () => {
    const seq = ++requestSeq.current;
    setLoadError("");

    try {
      const result = await getNGO(ngoId);
      if (seq === requestSeq.current) setData(result);
    } catch (err) {
      if (seq === requestSeq.current && err.status !== 401) {
        setLoadError(err.message || "Could not load this NGO");
      }
    }
  }, [ngoId]);

  // Load once on open (the guard also covers StrictMode's double effect).
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    load();
  }, [load]);

  const loadEvent = useCallback(async (eventId) => {
    if (eventRequests.current.has(eventId)) return;
    eventRequests.current.add(eventId);

    setEventCache((cache) => ({ ...cache, [eventId]: { status: "loading" } }));

    try {
      const result = await getEvent(eventId);
      setEventCache((cache) => ({ ...cache, [eventId]: { status: "ready", data: result } }));
    } catch (err) {
      eventRequests.current.delete(eventId);
      if (err.status !== 401) {
        setEventCache((cache) => ({
          ...cache,
          [eventId]: { status: "error", error: err.message || "Could not load volunteers" },
        }));
      }
    }
  }, []);

  // An event opened from the Overview feed starts expanded.
  useEffect(() => {
    if (initialEventId !== null) loadEvent(initialEventId);
  }, [initialEventId, loadEvent]);

  useEffect(() => {
    if (!data || initialEventId === null || tab !== "events" || scrolledToEvent.current) return;
    scrolledToEvent.current = true;
    const row = document.getElementById(`adm-event-row-${initialEventId}`);
    if (row) row.scrollIntoView({ block: "center" });
  }, [data, initialEventId, tab]);

  const toggleEvent = (eventId) => {
    const opening = !expanded[eventId];
    setExpanded((current) => ({ ...current, [eventId]: opening }));
    if (opening) loadEvent(eventId);
  };

  const openProof = (id) => {
    setProofId(id);
    window.scrollTo({ top: 0, behavior: "instant" });
  };

  const closeProof = () => {
    setProofId(null);
    window.scrollTo({ top: 0, behavior: "instant" });
    // Reload only if the admin approved or rejected something while away.
    if (proofChanged.current) {
      proofChanged.current = false;
      load();
    }
  };

  const handleProofChanged = () => {
    proofChanged.current = true;
    if (onDataChanged) onDataChanged();
  };

  // The audited request starts here, in the click handler, exactly once per click.
  const openConversation = (summary) => {
    const ngoEmail = data && data.profile.email;
    if (!ngoEmail) return;

    conversationSeq.current += 1;
    setConversation({
      id: conversationSeq.current,
      a: ngoEmail,
      b: summary.email,
      request: startConversationRequest(ngoEmail, summary.email),
    });
    window.scrollTo({ top: 0, behavior: "instant" });
  };

  const closeConversation = () => {
    setConversation(null);
    window.scrollTo({ top: 0, behavior: "instant" });
  };

  const ngoName = data ? data.profile.name : "NGO";

  if (proofId !== null) {
    return (
      <AdminProofDetail
        key={proofId}
        resolutionId={proofId}
        showToast={showToast}
        onBack={closeProof}
        onOpenProof={openProof}
        onChanged={handleProofChanged}
        backLabel={`Back to ${ngoName}`}
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
        backLabel={`Back to ${ngoName}`}
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
            Loading NGO…
          </div>
        )}
      </section>
    );
  }

  const { profile, stats } = data;
  const documents = data.documents || [];
  const events = data.events || [];
  const matchedOpen = (data.problems && data.problems.matched_open) || [];
  const proofs = (data.problems && data.problems.proofs) || [];
  const conversations = data.conversations || [];

  return (
    <section className="adm-page" aria-labelledby="adm-ngo-title">
      {backButton}

      <header className="adm-detail-header">
        <div>
          <p className="adm-eyebrow">NGO #{data.id}</p>
          <h1 className="adm-page-title" id="adm-ngo-title">{profile.name}</h1>
          <p className="adm-page-sub">{orNotProvided(profile.email, "No email on file")}</p>
        </div>
        <StatusPill status={profile.verification_status} />
      </header>

      <dl className="adm-mini-stats">
        <div className="adm-mini-stat">
          <dt>Events</dt>
          <dd>
            <span className="adm-mini-stat-value">{countText(stats.events_total)}</span>
            <span className="adm-mini-stat-sub">
              {countText(stats.events_upcoming)} upcoming · {countText(stats.events_completed)} completed
              · {countText(stats.events_cancelled)} cancelled
            </span>
          </dd>
        </div>
        <div className="adm-mini-stat">
          <dt>Problems solved</dt>
          <dd><span className="adm-mini-stat-value">{countText(stats.problems_solved)}</span></dd>
        </div>
        <div className="adm-mini-stat">
          <dt>Proofs pending</dt>
          <dd><span className="adm-mini-stat-value">{countText(stats.proofs_pending)}</span></dd>
        </div>
        <div className="adm-mini-stat">
          <dt>Volunteers engaged</dt>
          <dd><span className="adm-mini-stat-value">{countText(stats.volunteers_engaged)}</span></dd>
        </div>
        <div className="adm-mini-stat">
          <dt>Average rating given</dt>
          <dd>
            <span className="adm-mini-stat-value">
              {ratingText(stats.average_rating_given, "No ratings yet")}
            </span>
          </dd>
        </div>
      </dl>

      <div className="adm-tabs" role="group" aria-label="NGO sections">
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
        <>
          <article className="adm-card">
            <h2 className="adm-card-title">Registration details</h2>
            <dl className="adm-fields">
              <InfoField label="Name">{orNotProvided(profile.name)}</InfoField>
              <InfoField label="Email">{orNotProvided(profile.email)}</InfoField>
              <InfoField label="Contact number">{orNotProvided(profile.contact_number)}</InfoField>
              <InfoField label="Category">{orNotProvided(profile.category)}</InfoField>
              <InfoField label="Location">{orNotProvided(profile.location)}</InfoField>
              <InfoField label="Motto">
                <span className="adm-cell-wrap">{orNotProvided(profile.motto)}</span>
              </InfoField>
              <InfoField label="Legal structure">{orNotProvided(profile.legal_structure)}</InfoField>
              <InfoField label="Year founded">{orNotProvided(profile.year_founded)}</InfoField>
              <InfoField label="Website"><WebsiteValue url={profile.website_url} /></InfoField>
              <InfoField label="Verification">
                <StatusPill status={profile.verification_status} />
              </InfoField>
              <InfoField label="Verification notes">
                <span className="adm-cell-wrap">{orNotProvided(profile.verification_notes)}</span>
              </InfoField>
              <InfoField label="Verified at">
                {profile.verified_at ? formatIST(profile.verified_at) : "Not provided"}
              </InfoField>
            </dl>
          </article>

          <article className="adm-card adm-section-card">
            <h2 className="adm-card-title">Documents</h2>
            {documents.length === 0 ? (
              <p className="adm-muted">No documents are listed for this NGO.</p>
            ) : (
              <ul className="adm-doc-list">
                {documents.map((doc) => (
                  <AdminDocumentViewer
                    key={doc.key}
                    ngoId={data.id}
                    doc={doc}
                    showToast={showToast}
                  />
                ))}
              </ul>
            )}
          </article>
        </>
      )}

      {/* ── Events ── */}
      {tab === "events" && (
        <article className="adm-card">
          <h2 className="adm-card-title">Events</h2>
          {events.length === 0 ? (
            <p className="adm-muted">This NGO has not created any events yet.</p>
          ) : (
            <div className="adm-table-wrap">
              <table className="adm-table">
                <thead>
                  <tr>
                    <th scope="col">Event</th>
                    <th scope="col">Date</th>
                    <th scope="col">Status</th>
                    <th scope="col" className="adm-num">Spots</th>
                    <th scope="col" className="adm-num">Signups</th>
                    <th scope="col" className="adm-num">Approved</th>
                    <th scope="col" className="adm-num">Attended</th>
                    <th scope="col">Avg rating</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((event) => {
                    const isOpen = Boolean(expanded[event.id]);

                    return [
                      <tr
                        key={event.id}
                        id={`adm-event-row-${event.id}`}
                        className={`adm-table-row--link${isOpen ? " adm-table-row--open" : ""}`}
                        onClick={() => toggleEvent(event.id)}
                      >
                        <td>
                          <button
                            type="button"
                            className="adm-link-btn"
                            aria-expanded={isOpen}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleEvent(event.id);
                            }}
                          >
                            <span className="adm-caret" aria-hidden="true">{isOpen ? "▾" : "▸"}</span>
                            {orNotProvided(event.title, "Untitled event")}
                          </button>
                        </td>
                        <td className="adm-nowrap">
                          {event.event_date ? formatIST(event.event_date) : "No date set"}
                        </td>
                        <td>
                          <span className={`adm-pill adm-pill--${EVENT_PILL[event.status_label] || "closed"}`}>
                            {orNotProvided(event.status_label, "Unknown")}
                          </span>
                        </td>
                        <td className="adm-num">{countText(event.spots_available)}</td>
                        <td className="adm-num">{countText(event.signups)}</td>
                        <td className="adm-num">{countText(event.approved)}</td>
                        <td className="adm-num">{countText(event.attended)}</td>
                        <td className="adm-nowrap">{ratingText(event.average_rating, "No ratings")}</td>
                      </tr>,
                      isOpen && (
                        <tr key={`${event.id}-volunteers`} className="adm-expand-row">
                          <td colSpan={EVENT_COLUMNS}>
                            <EventVolunteers
                              entry={eventCache[event.id]}
                              onRetry={() => loadEvent(event.id)}
                            />
                          </td>
                        </tr>
                      ),
                    ];
                  })}
                </tbody>
              </table>
            </div>
          )}
        </article>
      )}

      {/* ── Problems ── */}
      {tab === "problems" && (
        <>
          <article className="adm-card">
            <h2 className="adm-card-title">Matched open problems</h2>
            {matchedOpen.length === 0 ? (
              <p className="adm-muted">No open problems are matched to this NGO.</p>
            ) : (
              <div className="adm-table-wrap">
                <table className="adm-table">
                  <thead>
                    <tr>
                      <th scope="col">Complaint ID</th>
                      <th scope="col">Location</th>
                      <th scope="col">Status</th>
                      <th scope="col">Reported</th>
                    </tr>
                  </thead>
                  <tbody>
                    {matchedOpen.map((issue) => (
                      <tr key={issue.complaint_id}>
                        <td className="adm-id adm-nowrap">{issue.complaint_id}</td>
                        <td className="adm-cell-wrap">{orNotProvided(issue.location)}</td>
                        <td><StatusPill status={issue.status} /></td>
                        <td className="adm-nowrap">{formatIST(issue.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </article>

          <article className="adm-card adm-section-card">
            <h2 className="adm-card-title">Proofs submitted by this NGO</h2>
            {proofs.length === 0 ? (
              <p className="adm-muted">This NGO has not submitted any proofs.</p>
            ) : (
              <div className="adm-table-wrap">
                <table className="adm-table">
                  <thead>
                    <tr>
                      <th scope="col">Proof</th>
                      <th scope="col">Complaint ID</th>
                      <th scope="col">Status</th>
                      <th scope="col">Solution</th>
                      <th scope="col">Submitted</th>
                      <th scope="col">Decided</th>
                    </tr>
                  </thead>
                  <tbody>
                    {proofs.map((proof) => (
                      <tr
                        key={proof.id}
                        className="adm-table-row--link"
                        onClick={() => openProof(proof.id)}
                      >
                        <td>
                          <button
                            type="button"
                            className="adm-link-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              openProof(proof.id);
                            }}
                          >
                            #{proof.id}
                          </button>
                        </td>
                        <td className="adm-id adm-nowrap">{proof.complaint_id}</td>
                        <td><StatusPill status={proof.status} /></td>
                        <td>{solutionTypeLabel(proof.solution_type)}</td>
                        <td className="adm-nowrap">{formatIST(proof.submitted_at)}</td>
                        <td className="adm-nowrap">
                          {proof.decided_at ? formatIST(proof.decided_at) : "Not decided"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </article>
        </>
      )}

      {/* ── Messages ── */}
      {tab === "messages" && (
        <article className="adm-card">
          <h2 className="adm-card-title">Conversations</h2>
          <p className="adm-muted adm-card-note">
            Opening a conversation is recorded in the audit log.
          </p>
          {conversations.length === 0 ? (
            <p className="adm-muted">This NGO has no conversations.</p>
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

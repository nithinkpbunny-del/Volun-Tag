import { useEffect, useState } from "react";
import { formatIST, getConversation } from "./adminApi";

/**
 * Start one audited conversation request. Called only from click handlers
 * (opening a conversation, or Retry), never from effects or timers, because
 * every request writes an audit row on the server.
 */
export function startConversationRequest(a, b) {
  const request = getConversation(a, b);
  // The viewer handles the error; this stops an "unhandled rejection" warning
  // if the viewer is gone before the request settles.
  request.catch(() => {});
  return request;
}

const ROLE_LABELS = { ngo: "NGO", volunteer: "Volunteer" };

function roleLabel(role) {
  return ROLE_LABELS[role] || "Unknown";
}

function formatBytes(size) {
  if (size === null || size === undefined || Number.isNaN(Number(size))) {
    return "Unknown size";
  }
  const bytes = Number(size);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function hasNumber(value) {
  return value !== null && value !== undefined && !Number.isNaN(Number(value));
}

function MessageContent({ message }) {
  if (message.message_type === "text") {
    return <p className="adm-msg-text">{message.body || ""}</p>;
  }

  if (message.message_type === "location") {
    return (
      <p className="adm-msg-attachment">
        <strong>Location shared</strong>
        <span>
          {hasNumber(message.latitude) && hasNumber(message.longitude)
            ? `${message.latitude}, ${message.longitude}`
            : "Coordinates unavailable"}
        </span>
      </p>
    );
  }

  if (message.message_type === "image" || message.message_type === "document") {
    return (
      <p className="adm-msg-attachment">
        <strong>{message.file_name || "Unnamed file"}</strong>
        <span>
          {formatBytes(message.file_size)} · {message.mime_type || "Unknown type"}
        </span>
      </p>
    );
  }

  return (
    <p className="adm-msg-text">
      {message.body || `Unsupported message type: ${message.message_type || "unknown"}`}
    </p>
  );
}

/**
 * Read-only thread between two emails. `initialRequest` is the promise from
 * startConversationRequest(); this component only awaits it, so React's
 * StrictMode double effect cannot send a second audited request.
 */
export default function AdminConversation({
  a,
  b,
  initialRequest,
  onBack,
  backLabel = "Back",
}) {
  const [request, setRequest] = useState(initialRequest);
  const [state, setState] = useState({ status: "loading", data: null, error: "" });

  useEffect(() => {
    let cancelled = false;

    setState({ status: "loading", data: null, error: "" });

    request
      .then((data) => {
        if (!cancelled) setState({ status: "ready", data, error: "" });
      })
      .catch((err) => {
        // A 401 already sent the admin back to the login screen.
        if (!cancelled && err.status !== 401) {
          setState({
            status: "error",
            data: null,
            error: err.message || "Could not load this conversation",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [request]);

  // Retry is a deliberate new view, so it sends one new audited request.
  const handleRetry = () => {
    setRequest(startConversationRequest(a, b));
  };

  const data = state.data;
  const participants = data ? [data.a, data.b] : [];
  const nameByEmail = Object.fromEntries(
    participants.map((p) => [String(p.email).toLowerCase(), p.name])
  );
  const aEmail = data ? String(data.a.email).toLowerCase() : "";

  return (
    <section className="adm-page" aria-labelledby="adm-conversation-title">
      <button type="button" className="adm-back" onClick={onBack}>
        <span aria-hidden="true">←</span> {backLabel}
      </button>

      <header className="adm-page-header">
        <h1 className="adm-page-title" id="adm-conversation-title">Conversation</h1>
      </header>

      <p className="adm-audit-note" role="note">
        Viewing this conversation is recorded in the audit log.
      </p>

      {state.status === "loading" && (
        <div className="adm-state" role="status">
          <span className="adm-spinner" aria-hidden="true" />
          Loading conversation…
        </div>
      )}

      {state.status === "error" && (
        <div className="adm-state adm-state--error" role="alert">
          <p>{state.error}</p>
          <button type="button" className="adm-btn adm-btn--secondary" onClick={handleRetry}>
            Try again
          </button>
        </div>
      )}

      {state.status === "ready" && (
        <>
          <div className="adm-participants">
            {participants.map((p, index) => (
              <div
                key={`${index}-${p.email}`}
                className={`adm-participant adm-participant--${index === 0 ? "a" : "b"}`}
              >
                <span className="adm-participant-name">{p.name || p.email}</span>
                <span className="adm-participant-meta">
                  {roleLabel(p.role)} · {p.email}
                </span>
              </div>
            ))}
          </div>

          {data.messages.length === 0 ? (
            <div className="adm-state adm-state--empty">
              <p>No messages</p>
            </div>
          ) : (
            <ol className="adm-thread">
              {data.messages.map((m) => {
                const sender = String(m.sender_email || "").toLowerCase();
                const side = sender === aEmail ? "a" : "b";

                return (
                  <li key={m.id} className={`adm-msg adm-msg--${side}`}>
                    <div className="adm-msg-bubble">
                      <MessageContent message={m} />
                    </div>
                    <p className="adm-msg-meta">
                      <span>{nameByEmail[sender] || m.sender_email}</span>
                      <span aria-hidden="true">·</span>
                      <span>{formatIST(m.created_at)}</span>
                      <span aria-hidden="true">·</span>
                      <span>{m.read_at ? "Read" : "Unread"}</span>
                    </p>
                  </li>
                );
              })}
            </ol>
          )}
        </>
      )}
    </section>
  );
}

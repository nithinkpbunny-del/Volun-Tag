import { useCallback, useEffect, useRef, useState } from "react";
import {
  changeContactMessage,
  formatIST,
  getContactMessage,
  getContactMessages,
  replyMailto,
  useVisibleInterval,
} from "./adminApi";

const SEARCH_DEBOUNCE_MS = 300;
const PAGE_SIZE = 20;

// `value` is the exact status the API takes.
const STATUS_FILTERS = [
  { value: "inbox", label: "Inbox" },
  { value: "unread", label: "Unread" },
  { value: "read", label: "Read" },
  { value: "archived", label: "Archived" },
  { value: "all", label: "All" },
];

const EMPTY_TEXT = {
  inbox: "No messages yet. Messages sent through the Contact page appear here.",
  unread: "No unread messages.",
  read: "No read messages.",
  archived: "No archived messages.",
  all: "No messages yet. Messages sent through the Contact page appear here.",
};

const ROLE_LABELS = { volunteer: "Volunteer", ngo: "NGO", other: "Someone else" };

const ACTION_DONE = {
  read: "Marked as read.",
  unread: "Marked as unread.",
  archive: "Message archived.",
  unarchive: "Message moved back to the inbox.",
};

/** Subject, or the start of the message when there is no subject. */
function headline(item) {
  return (item.subject || "").trim() || item.preview || "(No subject)";
}

/** Copy text to the clipboard; resolves true on success. */
async function copyText(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the textarea fallback.
  }

  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand && document.execCommand("copy");
    document.body.removeChild(area);
    return Boolean(ok);
  } catch {
    return false;
  }
}

function MessageDetail({ message, loading, error, busy, onAction, onRetry, onBack, showToast }) {
  if (error) {
    return (
      <div className="adm-state adm-state--error" role="alert">
        <p>{error}</p>
        <button type="button" className="adm-btn adm-btn--secondary" onClick={onRetry}>
          Try again
        </button>
      </div>
    );
  }

  if (loading || !message) {
    return (
      <div className="adm-state" role="status">
        <span className="adm-spinner" aria-hidden="true" />
        Loading message…
      </div>
    );
  }

  const mailto = replyMailto(message.email, message.subject);

  const handleCopy = async () => {
    const ok = await copyText(message.email);
    showToast(
      ok ? "Email address copied." : "Could not copy. Select the address and copy it by hand.",
      ok ? "success" : "error"
    );
  };

  return (
    <article className="adm-card adm-cm-detail" aria-labelledby="adm-cm-detail-title">
      <button type="button" className="adm-back adm-cm-back" onClick={onBack}>
        ← Back to messages
      </button>

      <div className="adm-cm-detail-head">
        <h2 className="adm-cm-detail-title" id="adm-cm-detail-title">
          {(message.subject || "").trim() || "(No subject)"}
        </h2>
        <div className="adm-cm-pills">
          {message.is_archived && <span className="adm-pill adm-pill--closed">Archived</span>}
          <span className={`adm-pill adm-pill--${message.is_read ? "approved" : "pending"}`}>
            {message.is_read ? "Read" : "Unread"}
          </span>
        </div>
      </div>

      <dl className="adm-fields adm-cm-fields">
        <div className="adm-field">
          <dt>From</dt>
          <dd>{message.name}</dd>
        </div>
        <div className="adm-field">
          <dt>Email</dt>
          <dd className="adm-cm-email">{message.email}</dd>
        </div>
        <div className="adm-field">
          <dt>Sent</dt>
          <dd>{formatIST(message.created_at)}</dd>
        </div>
        {message.role && (
          <div className="adm-field">
            <dt>Says they are</dt>
            <dd>{ROLE_LABELS[message.role] || message.role}</dd>
          </div>
        )}
      </dl>

      <h3 className="adm-subheading">Message</h3>
      {/* Plain text only: React escapes it, and pre-wrap keeps the line breaks. */}
      <div className="adm-cm-body" tabIndex={0} aria-label="Message text">
        {message.message}
      </div>

      <div className="adm-btn-row adm-cm-actions">
        <button
          type="button"
          className="adm-btn adm-btn--primary adm-btn--sm"
          disabled={busy}
          onClick={() => onAction(message.is_read ? "unread" : "read")}
        >
          {message.is_read ? "Mark as unread" : "Mark as read"}
        </button>
        <button
          type="button"
          className="adm-btn adm-btn--secondary adm-btn--sm"
          disabled={busy}
          onClick={() => onAction(message.is_archived ? "unarchive" : "archive")}
        >
          {message.is_archived ? "Move to inbox" : "Archive"}
        </button>
        <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={handleCopy}>
          Copy email
        </button>
        {mailto ? (
          <a className="adm-btn adm-btn--ghost adm-btn--sm" href={mailto}>
            Reply by email
          </a>
        ) : (
          <span className="adm-muted adm-cm-note">
            This address cannot be used for a mail link.
          </span>
        )}
      </div>
    </article>
  );
}

export default function AdminContactMessages({ showToast, onDataChanged }) {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("inbox");
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null); // null until the first successful load
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [busy, setBusy] = useState(false);

  // Only the newest request may update the list or the detail panel.
  const listSeq = useRef(0);
  const detailSeq = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // A new filter or search starts again from page 1.
  useEffect(() => {
    setPage(1);
  }, [search, status]);

  const load = useCallback(
    async ({ silent = false } = {}) => {
      const seq = ++listSeq.current;

      if (!silent) {
        setLoading(true);
        setError("");
      }

      try {
        const result = await getContactMessages({ status, q: search, page, pageSize: PAGE_SIZE });
        if (seq !== listSeq.current) return;
        setData(result && Array.isArray(result.items) ? result : { items: [], total: 0, unread_count: 0 });
        setError("");
      } catch (err) {
        if (seq !== listSeq.current || silent || err.status === 401) return;
        setError(err.message || "Could not load contact messages");
      } finally {
        if (seq === listSeq.current && !silent) setLoading(false);
      }
    },
    [status, search, page]
  );

  useEffect(() => {
    load();
  }, [load]);

  useVisibleInterval(() => load({ silent: true }));

  const loadDetail = useCallback(async (id) => {
    const seq = ++detailSeq.current;
    setDetailLoading(true);
    setDetailError("");

    try {
      const message = await getContactMessage(id);
      if (seq !== detailSeq.current) return;
      setDetail(message);
    } catch (err) {
      if (seq !== detailSeq.current || err.status === 401) return;
      setDetailError(err.message || "Could not load this message");
    } finally {
      if (seq === detailSeq.current) setDetailLoading(false);
    }
  }, []);

  const openMessage = (id) => {
    setSelectedId(id);
    setDetail(null);
    loadDetail(id);
  };

  const closeMessage = () => {
    detailSeq.current += 1;
    setSelectedId(null);
    setDetail(null);
    setDetailError("");
  };

  const handleAction = async (action) => {
    if (!detail || busy) return;
    setBusy(true);

    try {
      const updated = await changeContactMessage(detail.id, action);
      setDetail(updated);
      setData((prev) =>
        prev
          ? {
              ...prev,
              unread_count: updated.unread_count,
              items: prev.items.map((item) =>
                item.id === updated.id
                  ? { ...item, is_read: updated.is_read, is_archived: updated.is_archived }
                  : item
              ),
            }
          : prev
      );
      showToast(ACTION_DONE[action], "success");
      if (onDataChanged) onDataChanged();
      load({ silent: true });
    } catch (err) {
      if (err.status !== 401) {
        showToast(err.message || "Could not update this message", "error");
      }
    } finally {
      setBusy(false);
    }
  };

  const items = data ? data.items : [];
  const total = data ? data.total : 0;
  const unread = data ? data.unread_count : 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);

  let list;
  if (error) {
    list = (
      <div className="adm-state adm-state--error" role="alert">
        <p>{error}</p>
        <button type="button" className="adm-btn adm-btn--secondary" onClick={() => load()}>
          Try again
        </button>
      </div>
    );
  } else if (data === null) {
    list = (
      <div className="adm-state" role="status">
        <span className="adm-spinner" aria-hidden="true" />
        Loading messages…
      </div>
    );
  } else if (items.length === 0) {
    list = (
      <div className="adm-state adm-state--empty">
        <span className="adm-state-icon" aria-hidden="true">✉</span>
        <p>{search ? `No messages match “${search}”.` : EMPTY_TEXT[status]}</p>
      </div>
    );
  } else {
    list = (
      <>
        <ul className="adm-cm-list" aria-label="Contact messages">
          {items.map((item) => {
            const isOpen = item.id === selectedId;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  className={
                    "adm-cm-row" +
                    (item.is_read ? "" : " adm-cm-row--unread") +
                    (isOpen ? " adm-cm-row--open" : "")
                  }
                  aria-current={isOpen ? "true" : undefined}
                  onClick={() => openMessage(item.id)}
                >
                  <span className="adm-cm-dot" aria-hidden="true" />
                  <span className="adm-cm-row-main">
                    <span className="adm-cm-row-top">
                      <span className="adm-cm-sender">{item.name}</span>
                      <span className="adm-cm-date">{formatIST(item.created_at, { time: false })}</span>
                    </span>
                    <span className="adm-cm-subject">{headline(item)}</span>
                    <span className="adm-visually-hidden">
                      {item.is_read ? "Read" : "Unread"}
                      {item.is_archived ? ", archived" : ""}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        {total > PAGE_SIZE && (
          <nav className="adm-cm-pager" aria-label="Pages">
            <button
              type="button"
              className="adm-btn adm-btn--secondary adm-btn--sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </button>
            <span className="adm-cm-pager-text">
              {from}–{to} of {total}
            </span>
            <button
              type="button"
              className="adm-btn adm-btn--secondary adm-btn--sm"
              disabled={page >= lastPage}
              onClick={() => setPage((p) => Math.min(lastPage, p + 1))}
            >
              Next
            </button>
          </nav>
        )}
      </>
    );
  }

  const hasSelection = selectedId !== null;

  return (
    <section className="adm-page" aria-labelledby="adm-cm-title">
      <header className="adm-page-header">
        <h1 className="adm-page-title" id="adm-cm-title">Contact messages</h1>
        <p className="adm-page-sub">
          Messages sent through the public Contact page, newest first.
          {data !== null && (unread > 0 ? ` ${unread} unread.` : " Nothing unread.")}
        </p>
      </header>

      <div className="adm-toolbar">
        <label className="adm-search">
          <span className="adm-visually-hidden">Search messages</span>
          <input
            type="search"
            className="adm-input"
            placeholder="Search name, email, subject or message"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </label>

        <div className="adm-tabs adm-tabs--inline" role="group" aria-label="Filter messages">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              aria-pressed={f.value === status}
              className={`adm-tab${f.value === status ? " adm-tab--active" : ""}`}
              onClick={() => setStatus(f.value)}
            >
              {f.label}
            </button>
          ))}
        </div>

        {loading && data !== null && (
          <span className="adm-toolbar-status" role="status">
            <span className="adm-spinner" aria-hidden="true" />
            Updating…
          </span>
        )}
      </div>

      <div className={`adm-cm-layout${hasSelection ? " adm-cm-layout--detail" : ""}`}>
        <div className="adm-cm-list-pane">{list}</div>

        <div className="adm-cm-detail-pane">
          {hasSelection ? (
            <MessageDetail
              message={detail}
              loading={detailLoading}
              error={detailError}
              busy={busy}
              onAction={handleAction}
              onRetry={() => loadDetail(selectedId)}
              onBack={closeMessage}
              showToast={showToast}
            />
          ) : (
            <div className="adm-state adm-cm-placeholder">
              <p>Choose a message to read it.</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

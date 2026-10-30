import { useCallback, useEffect, useRef, useState } from "react";
import AdminImage from "./AdminImage";
import {
  PENDING_STATUS,
  adminFetch,
  fetchFileUrl,
  formatIST,
  statusModifier,
  useVisibleInterval,
} from "./adminApi";

const APPROVE_CONFIRM =
  "Approve this proof? The problem will be marked as solved, any other " +
  "pending proofs for it will be closed, and the reporter will get a " +
  "message from this NGO.";

const REASON_MAX = 1000;

// Revoking a blob URL right after link.click() can cancel the download in some browsers.
const DOWNLOAD_URL_LIFETIME_MS = 60000;

export function StatusPill({ status }) {
  return (
    <span className={`adm-pill adm-pill--${statusModifier(status)}`}>
      {status || "Unknown"}
    </span>
  );
}

export function solutionTypeLabel(type) {
  return type === "document" ? "Document" : "Written";
}

function Field({ label, children }) {
  return (
    <div className="adm-field">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Decision({ proof }) {
  const when = formatIST(proof.decided_at);

  if (proof.status === "Approved") {
    return (
      <p className="adm-decision adm-decision--approved">
        Approved on {when}.
      </p>
    );
  }

  const verb = proof.status === "Rejected" ? "Rejected" : "Closed";

  return (
    <div className={`adm-decision adm-decision--${statusModifier(proof.status)}`}>
      <p>{verb} on {when}.</p>
      {proof.reject_reason && (
        <p className="adm-decision-reason">
          <strong>Reason:</strong> {proof.reject_reason}
        </p>
      )}
    </div>
  );
}

export default function AdminProofDetail({
  resolutionId,
  showToast,
  onBack,
  onOpenProof,
  onChanged,
}) {
  const [proof, setProof] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(null); // "approve" | "reject" | null
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [docUrl, setDocUrl] = useState(null); // PDF preview panel is open when set
  const [docLoading, setDocLoading] = useState(false);

  const requestSeq = useRef(0);
  const reasonRef = useRef(null);

  // The preview's blob URL, and a counter that makes late document fetches no-ops.
  const docUrlRef = useRef(null);
  const docRequest = useRef(0);

  const discardDocument = useCallback(() => {
    docRequest.current += 1;
    if (docUrlRef.current) {
      URL.revokeObjectURL(docUrlRef.current);
      docUrlRef.current = null;
    }
    setDocUrl(null);
    setDocLoading(false);
  }, []);

  // Release the preview when the proof changes and on unmount.
  useEffect(() => discardDocument, [resolutionId, discardDocument]);

  const load = useCallback(
    async ({ silent = false } = {}) => {
      const seq = ++requestSeq.current;

      try {
        const data = await adminFetch(`/admin/resolutions/${resolutionId}`);
        if (seq !== requestSeq.current) return;
        setProof(data);
        setLoadError("");
      } catch (err) {
        if (seq !== requestSeq.current || silent) return;
        setLoadError(err.message || "Could not load this proof");
      }
    },
    [resolutionId]
  );

  useEffect(() => {
    load();
  }, [load]);

  // Pause while approve/reject runs so a refresh cannot show stale buttons.
  useVisibleInterval(() => load({ silent: true }), busy === null);

  useEffect(() => {
    if (rejectOpen && reasonRef.current) reasonRef.current.focus();
  }, [rejectOpen]);

  const trimmedReason = reason.trim();
  const reasonValid =
    trimmedReason.length >= 1 && trimmedReason.length <= REASON_MAX;

  const runAction = async (kind, request, successMessage) => {
    setBusy(kind);

    try {
      await request();
    } catch (err) {
      // A 401 already sent the admin back to the login screen.
      if (err.status !== 401) {
        showToast(err.message || "Something went wrong", "error");
        await load({ silent: true });
        setBusy(null);
      }
      return false;
    }

    showToast(successMessage, "success");
    if (onChanged) onChanged();
    await load({ silent: true });
    setBusy(null);
    return true;
  };

  const handleApprove = async () => {
    if (!window.confirm(APPROVE_CONFIRM)) return;

    await runAction(
      "approve",
      () => adminFetch(`/admin/resolutions/${resolutionId}/approve`, { method: "POST" }),
      "Proof approved. The problem is now marked as solved."
    );
  };

  const handleReject = async (e) => {
    e.preventDefault();
    if (!reasonValid || busy) return;

    const ok = await runAction(
      "reject",
      () =>
        adminFetch(`/admin/resolutions/${resolutionId}/reject`, {
          method: "POST",
          body: JSON.stringify({ reason: trimmedReason }),
        }),
      "Proof rejected. The NGO will see your reason."
    );

    if (ok) {
      setReason("");
      setRejectOpen(false);
    }
  };

  const cancelReject = () => {
    setRejectOpen(false);
    setReason("");
  };

  /** Fetch the proof document once; returns its blob URL, or null if it failed or was superseded. */
  const fetchDocument = async () => {
    const seq = ++docRequest.current;
    setDocLoading(true);

    try {
      const url = await fetchFileUrl(`/issue-files/resolution/${proof.id}/document`);

      if (seq !== docRequest.current) {
        URL.revokeObjectURL(url);
        return null;
      }
      return url;
    } catch (err) {
      if (seq === docRequest.current && err.status !== 401) {
        showToast(err.message || "Could not load the document", "error");
      }
      return null;
    } finally {
      if (seq === docRequest.current) setDocLoading(false);
    }
  };

  const handleViewDocument = async () => {
    if (docLoading || docUrl) return;

    const url = await fetchDocument();
    if (!url) return;

    docUrlRef.current = url;
    setDocUrl(url);
  };

  // Browsers cannot preview Word files, so they are downloaded instead.
  const handleDownloadDocument = async () => {
    if (docLoading) return;

    const url = await fetchDocument();
    if (!url) return;

    const link = document.createElement("a");
    link.href = url;
    link.download = proof.document_name || "document";
    document.body.appendChild(link);
    link.click();
    link.remove();

    setTimeout(() => URL.revokeObjectURL(url), DOWNLOAD_URL_LIFETIME_MS);
  };

  const backButton = (
    <button type="button" className="adm-back" onClick={onBack}>
      <span aria-hidden="true">←</span> Back to proof reviews
    </button>
  );

  if (!proof) {
    return (
      <section className="adm-page">
        {backButton}
        {loadError ? (
          <div className="adm-state adm-state--error" role="alert">
            <p>{loadError}</p>
            <button type="button" className="adm-btn adm-btn--secondary" onClick={() => load()}>
              Try again
            </button>
          </div>
        ) : (
          <div className="adm-state" role="status">
            <span className="adm-spinner" aria-hidden="true" />
            Loading proof…
          </div>
        )}
      </section>
    );
  }

  const { issue, ngo } = proof;
  const isPending = proof.status === PENDING_STATUS;
  const others = proof.other_resolutions || [];
  const hasDocument = proof.solution_type === "document" && Boolean(proof.document_name);
  const isPdf = /\.pdf$/i.test(proof.document_name || "");

  return (
    <section className="adm-page" aria-labelledby="adm-detail-title">
      {backButton}

      <header className="adm-detail-header">
        <div>
          <p className="adm-eyebrow">Proof #{proof.id}</p>
          <h1 className="adm-page-title adm-id-title" id="adm-detail-title">
            {proof.complaint_id}
          </h1>
        </div>
        <StatusPill status={proof.status} />
      </header>

      <div className="adm-detail-grid">
        {/* ── Reported problem ── */}
        <article className="adm-card" aria-labelledby="adm-problem-title">
          <h2 className="adm-card-title" id="adm-problem-title">Reported problem</h2>

          {issue ? (
            <>
              <dl className="adm-fields">
                <Field label="Complaint ID">
                  <span className="adm-id">{issue.complaint_id}</span>
                </Field>
                <Field label="Status">
                  <StatusPill status={issue.status} />
                </Field>
                <Field label="Reporter">{issue.reporter_name || "—"}</Field>
                <Field label="Reporter email">{issue.reporter_email || "—"}</Field>
                <Field label="Location">{issue.location || "—"}</Field>
                <Field label="Reported">{formatIST(issue.created_at)}</Field>
              </dl>

              <h3 className="adm-subheading">Description</h3>
              <p className="adm-prose">{issue.user_description}</p>

              <h3 className="adm-subheading">Photos</h3>
              {issue.image_count > 0 ? (
                <div className="adm-photo-grid">
                  {Array.from({ length: issue.image_count }, (_, index) => (
                    <AdminImage
                      key={index}
                      src={`/issue-files/issue/${encodeURIComponent(issue.complaint_id)}/${index}`}
                      alt={`Problem photo ${index + 1}`}
                    />
                  ))}
                </div>
              ) : (
                <p className="adm-muted">No photos were attached.</p>
              )}
            </>
          ) : (
            <p className="adm-muted">The reported problem could not be found.</p>
          )}
        </article>

        {/* ── NGO's proof ── */}
        <article className="adm-card" aria-labelledby="adm-proof-title">
          <h2 className="adm-card-title" id="adm-proof-title">NGO's proof</h2>

          <dl className="adm-fields">
            <Field label="NGO">{ngo ? ngo.name : "NGO record not found"}</Field>
            {ngo && (
              <>
                <Field label="Email">{ngo.email || "—"}</Field>
                <Field label="Location">{ngo.location || "—"}</Field>
                <Field label="Verification">
                  <StatusPill status={ngo.verification_status} />
                </Field>
              </>
            )}
            <Field label="Submitted">{formatIST(proof.submitted_at)}</Field>
            <Field label="Solution type">{solutionTypeLabel(proof.solution_type)}</Field>
          </dl>

          <h3 className="adm-subheading">Solution</h3>
          {hasDocument && isPdf && docUrl ? (
            <div className="adm-doc-panel">
              <div className="adm-doc-toolbar">
                <span className="adm-doc-name">
                  <span aria-hidden="true">📄</span> {proof.document_name}
                </span>
                <div className="adm-doc-actions">
                  <a
                    className="adm-btn adm-btn--secondary adm-btn--sm"
                    href={docUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open in new tab
                  </a>
                  <a
                    className="adm-btn adm-btn--secondary adm-btn--sm"
                    href={docUrl}
                    download={proof.document_name}
                  >
                    Download
                  </a>
                  <button
                    type="button"
                    className="adm-btn adm-btn--ghost adm-btn--sm"
                    onClick={discardDocument}
                  >
                    Hide document
                  </button>
                </div>
              </div>
              <iframe className="adm-doc-frame" src={docUrl} title="Proof document" />
            </div>
          ) : hasDocument ? (
            <button
              type="button"
              className="adm-btn adm-btn--secondary adm-doc-btn"
              onClick={isPdf ? handleViewDocument : handleDownloadDocument}
              disabled={docLoading}
              aria-busy={docLoading}
            >
              <span aria-hidden="true">📄</span>
              {docLoading
                ? "Loading document…"
                : `${isPdf ? "View" : "Download"} document (${proof.document_name})`}
            </button>
          ) : (
            <p className="adm-prose">
              {proof.solution_text || "No written solution was provided."}
            </p>
          )}

          <h3 className="adm-subheading">Before and after</h3>
          <div className="adm-before-after">
            <figure className="adm-figure">
              <AdminImage
                src={`/issue-files/resolution/${proof.id}/before`}
                alt="Before the fix"
              />
              <figcaption>Before</figcaption>
            </figure>
            <figure className="adm-figure">
              <AdminImage
                src={`/issue-files/resolution/${proof.id}/after`}
                alt="After the fix"
              />
              <figcaption>After</figcaption>
            </figure>
          </div>
        </article>
      </div>

      {/* ── Decision ── */}
      <div className="adm-card adm-action-card">
        <h2 className="adm-card-title">Decision</h2>

        {!isPending ? (
          <Decision proof={proof} />
        ) : rejectOpen ? (
          <form className="adm-reject-form" onSubmit={handleReject}>
            <label className="adm-field-label" htmlFor="adm-reject-reason">
              Reason for rejection <span className="adm-required">(required)</span>
            </label>
            <textarea
              id="adm-reject-reason"
              ref={reasonRef}
              className="adm-input adm-textarea"
              rows={4}
              maxLength={REASON_MAX}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={busy !== null}
              placeholder="Tell the NGO what is missing or unclear in this proof."
              aria-describedby="adm-reason-count"
            />
            <div className="adm-reject-footer">
              <span
                id="adm-reason-count"
                className={`adm-counter${reason.length >= REASON_MAX ? " adm-counter--limit" : ""}`}
              >
                {reason.length} / {REASON_MAX}
              </span>
              <div className="adm-btn-row">
                <button
                  type="button"
                  className="adm-btn adm-btn--ghost"
                  onClick={cancelReject}
                  disabled={busy !== null}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="adm-btn adm-btn--danger"
                  disabled={!reasonValid || busy !== null}
                >
                  {busy === "reject" ? "Rejecting…" : "Confirm rejection"}
                </button>
              </div>
            </div>
          </form>
        ) : (
          <>
            <p className="adm-muted">
              Approving marks the problem as solved. Rejecting sends your reason to the NGO.
            </p>
            <div className="adm-btn-row">
              <button
                type="button"
                className="adm-btn adm-btn--primary"
                onClick={handleApprove}
                disabled={busy !== null}
              >
                {busy === "approve" ? "Approving…" : "Approve"}
              </button>
              <button
                type="button"
                className="adm-btn adm-btn--danger-outline"
                onClick={() => setRejectOpen(true)}
                disabled={busy !== null}
              >
                Reject
              </button>
            </div>
          </>
        )}
      </div>

      {/* ── Other proofs ── */}
      {others.length > 0 && (
        <div className="adm-card adm-others-card" aria-labelledby="adm-others-title">
          <h2 className="adm-card-title" id="adm-others-title">
            Other proofs for this problem
          </h2>
          <ul className="adm-other-list">
            {others.map((other) => (
              <li key={other.id}>
                <button
                  type="button"
                  className="adm-other-row"
                  onClick={() => onOpenProof(other.id)}
                >
                  <span className="adm-other-ngo">
                    {other.ngo_name || "Unknown NGO"}
                  </span>
                  <StatusPill status={other.status} />
                  <span className="adm-other-date">
                    Submitted {formatIST(other.submitted_at)}
                  </span>
                  <span className="adm-proof-row-open" aria-hidden="true">→</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

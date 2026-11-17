import { useCallback, useEffect, useRef, useState } from "react";
import AdminProofDetail, { StatusPill, solutionTypeLabel } from "./AdminProofDetail";
import {
  PENDING_STATUS,
  adminFetch,
  formatIST,
  useVisibleInterval,
} from "./adminApi";

const FILTERS = [
  { id: "pending", label: "Pending", status: PENDING_STATUS, empty: "No proofs waiting for review." },
  { id: "approved", label: "Approved", status: "Approved", empty: "No approved proofs yet." },
  { id: "rejected", label: "Rejected", status: "Rejected", empty: "No rejected proofs." },
  { id: "closed", label: "Closed", status: "Closed", empty: "No closed proofs." },
  { id: "all", label: "All", status: "all", empty: "No proofs have been submitted yet." },
];

export default function AdminProofs({ showToast, onDataChanged }) {
  const [filterId, setFilterId] = useState("pending");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState(null);

  // Only the newest request may update the list (filters can change mid-flight).
  const requestSeq = useRef(0);

  const filter = FILTERS.find((f) => f.id === filterId) || FILTERS[0];

  const loadList = useCallback(
    async ({ silent = false } = {}) => {
      const seq = ++requestSeq.current;

      if (!silent) {
        setLoading(true);
        setError("");
      }

      try {
        const data = await adminFetch(
          `/admin/resolutions?status=${encodeURIComponent(filter.status)}`
        );
        if (seq !== requestSeq.current) return;
        setItems(Array.isArray(data) ? data : []);
        setError("");
      } catch (err) {
        if (seq !== requestSeq.current || silent) return;
        setError(err.message || "Could not load proofs");
      } finally {
        if (seq === requestSeq.current && !silent) setLoading(false);
      }
    },
    [filter.status]
  );

  useEffect(() => {
    setItems([]);
    loadList();
  }, [loadList]);

  // Poll only while the list is on screen; the detail view polls itself.
  useVisibleInterval(() => loadList({ silent: true }), selectedId === null);

  const openProof = (id) => {
    setSelectedId(id);
    window.scrollTo({ top: 0, behavior: "instant" });
  };

  const backToList = () => {
    setSelectedId(null);
    loadList({ silent: true });
    window.scrollTo({ top: 0, behavior: "instant" });
  };

  const handleChanged = () => {
    loadList({ silent: true });
    if (onDataChanged) onDataChanged();
  };

  if (selectedId !== null) {
    return (
      <AdminProofDetail
        key={selectedId}
        resolutionId={selectedId}
        showToast={showToast}
        onBack={backToList}
        onOpenProof={openProof}
        onChanged={handleChanged}
      />
    );
  }

  return (
    <section className="adm-page" aria-labelledby="adm-proofs-title">
      <header className="adm-page-header">
        <div>
          <h1 className="adm-page-title" id="adm-proofs-title">Proof reviews</h1>
          <p className="adm-page-sub">
            Check the proof NGOs submit when they mark a reported problem as solved.
          </p>
        </div>
      </header>

      <div className="adm-tabs" role="group" aria-label="Filter proofs by status">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            aria-pressed={f.id === filterId}
            className={`adm-tab${f.id === filterId ? " adm-tab--active" : ""}`}
            onClick={() => setFilterId(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="adm-state" role="status">
          <span className="adm-spinner" aria-hidden="true" />
          Loading proofs…
        </div>
      ) : error ? (
        <div className="adm-state adm-state--error" role="alert">
          <p>{error}</p>
          <button type="button" className="adm-btn adm-btn--secondary" onClick={() => loadList()}>
            Try again
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="adm-state adm-state--empty">
          {filter.id === "pending" && (
            <span className="adm-state-icon" aria-hidden="true">✓</span>
          )}
          <p>{filter.empty}</p>
        </div>
      ) : (
        <ul className="adm-proof-list">
          {items.map((item) => (
            <li key={item.resolution_id}>
              <button
                type="button"
                className="adm-proof-row"
                onClick={() => openProof(item.resolution_id)}
              >
                <div className="adm-proof-row-main">
                  <div className="adm-proof-row-top">
                    <span className="adm-id">{item.complaint_id}</span>
                    <StatusPill status={item.status} />
                  </div>
                  <p className="adm-proof-row-location">
                    {item.location || "Location unavailable"}
                  </p>
                  <p className="adm-proof-row-meta">
                    <span className="adm-proof-row-ngo">{item.ngo_name}</span>
                    <span className="adm-dot" aria-hidden="true">·</span>
                    <span>{solutionTypeLabel(item.solution_type)} solution</span>
                  </p>
                </div>
                <div className="adm-proof-row-side">
                  <span className="adm-proof-row-date">
                    Submitted {formatIST(item.submitted_at)}
                  </span>
                  <span className="adm-proof-row-open" aria-hidden="true">→</span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

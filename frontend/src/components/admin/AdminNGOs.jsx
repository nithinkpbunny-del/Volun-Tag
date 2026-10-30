import { useCallback, useEffect, useRef, useState } from "react";
import AdminNGODetail from "./AdminNGODetail";
import { StatusPill } from "./AdminProofDetail";
import { getNGOs, orNotProvided } from "./adminApi";

const SEARCH_DEBOUNCE_MS = 300;

// `value` is the exact verification_status string sent to the API.
const STATUS_FILTERS = [
  { value: "", label: "All" },
  { value: "Approved", label: "Approved" },
  { value: "Pending", label: "Pending" },
];

export default function AdminNGOs({ showToast, onDataChanged }) {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [items, setItems] = useState(null); // null until the first successful load
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState(null);

  // Only the newest request may update the list, so a slow earlier search
  // cannot overwrite a newer one.
  const requestSeq = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const load = useCallback(
    async ({ silent = false } = {}) => {
      const seq = ++requestSeq.current;

      if (!silent) {
        setLoading(true);
        setError("");
      }

      try {
        const data = await getNGOs(search, status);
        if (seq !== requestSeq.current) return;
        setItems(Array.isArray(data) ? data : []);
        setError("");
      } catch (err) {
        if (seq !== requestSeq.current || silent || err.status === 401) return;
        setError(err.message || "Could not load NGOs");
      } finally {
        if (seq === requestSeq.current && !silent) setLoading(false);
      }
    },
    [search, status]
  );

  useEffect(() => {
    load();
  }, [load]);

  const openNGO = (id) => {
    setSelectedId(id);
    window.scrollTo({ top: 0, behavior: "instant" });
  };

  const backToList = () => {
    setSelectedId(null);
    load({ silent: true });
    window.scrollTo({ top: 0, behavior: "instant" });
  };

  if (selectedId !== null) {
    return (
      <AdminNGODetail
        key={selectedId}
        ngoId={selectedId}
        showToast={showToast}
        onBack={backToList}
        backLabel="Back to NGOs"
        onDataChanged={onDataChanged}
      />
    );
  }

  const filtering = Boolean(search || status);

  let body;
  if (error) {
    body = (
      <div className="adm-state adm-state--error" role="alert">
        <p>{error}</p>
        <button type="button" className="adm-btn adm-btn--secondary" onClick={() => load()}>
          Try again
        </button>
      </div>
    );
  } else if (items === null) {
    body = (
      <div className="adm-state" role="status">
        <span className="adm-spinner" aria-hidden="true" />
        Loading NGOs…
      </div>
    );
  } else if (items.length === 0) {
    body = (
      <div className="adm-state adm-state--empty">
        <p>{filtering ? "No NGOs match" : "No NGOs have registered yet."}</p>
      </div>
    );
  } else {
    body = (
      <div className="adm-card adm-card--flush">
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Category</th>
                <th scope="col">Location</th>
                <th scope="col">Status</th>
                <th scope="col" className="adm-num">Events</th>
                <th scope="col" className="adm-num">Problems solved</th>
                <th scope="col" className="adm-num">Pending proofs</th>
              </tr>
            </thead>
            <tbody>
              {items.map((ngo) => {
                const breakdown =
                  `${ngo.events_upcoming} upcoming · ${ngo.events_completed} completed · ` +
                  `${ngo.events_cancelled} cancelled`;

                return (
                  <tr
                    key={ngo.id}
                    className="adm-table-row--link"
                    onClick={() => openNGO(ngo.id)}
                  >
                    <td>
                      <button
                        type="button"
                        className="adm-link-btn adm-link-btn--strong"
                        onClick={(e) => {
                          e.stopPropagation();
                          openNGO(ngo.id);
                        }}
                      >
                        {ngo.name}
                      </button>
                      <span className="adm-table-sub">{orNotProvided(ngo.email, "No email")}</span>
                    </td>
                    <td>{orNotProvided(ngo.category, "—")}</td>
                    <td className="adm-cell-wrap">{orNotProvided(ngo.location, "—")}</td>
                    <td><StatusPill status={ngo.verification_status} /></td>
                    <td className="adm-num" title={breakdown}>
                      {ngo.events_total}
                      <span className="adm-table-sub">{breakdown}</span>
                    </td>
                    <td className="adm-num">{ngo.problems_solved}</td>
                    <td className="adm-num">
                      {ngo.proofs_pending > 0 ? (
                        <span className="adm-count-badge">{ngo.proofs_pending}</span>
                      ) : (
                        ngo.proofs_pending
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <section className="adm-page" aria-labelledby="adm-ngos-title">
      <header className="adm-page-header">
        <h1 className="adm-page-title" id="adm-ngos-title">NGOs</h1>
        <p className="adm-page-sub">
          Every registered NGO, with its events and the problems it has solved.
        </p>
      </header>

      <div className="adm-toolbar">
        <label className="adm-search">
          <span className="adm-visually-hidden">Search NGOs</span>
          <input
            type="search"
            className="adm-input"
            placeholder="Search by name, email, category or location"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </label>

        <div className="adm-tabs adm-tabs--inline" role="group" aria-label="Filter NGOs by status">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.label}
              type="button"
              aria-pressed={f.value === status}
              className={`adm-tab${f.value === status ? " adm-tab--active" : ""}`}
              onClick={() => setStatus(f.value)}
            >
              {f.label}
            </button>
          ))}
        </div>

        {loading && items !== null && (
          <span className="adm-toolbar-status" role="status">
            <span className="adm-spinner" aria-hidden="true" />
            Updating…
          </span>
        )}
      </div>

      {body}
    </section>
  );
}

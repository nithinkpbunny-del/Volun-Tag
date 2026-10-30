import { useCallback, useEffect, useRef, useState } from "react";
import AdminVolunteerDetail from "./AdminVolunteerDetail";
import { getVolunteers, orNotProvided } from "./adminApi";

const SEARCH_DEBOUNCE_MS = 300;

export default function AdminVolunteers({ showToast, onDataChanged }) {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
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
        const data = await getVolunteers(search);
        if (seq !== requestSeq.current) return;
        setItems(Array.isArray(data) ? data : []);
        setError("");
      } catch (err) {
        if (seq !== requestSeq.current || silent || err.status === 401) return;
        setError(err.message || "Could not load volunteers");
      } finally {
        if (seq === requestSeq.current && !silent) setLoading(false);
      }
    },
    [search]
  );

  useEffect(() => {
    load();
  }, [load]);

  const openVolunteer = (id) => {
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
      <AdminVolunteerDetail
        key={selectedId}
        volunteerId={selectedId}
        showToast={showToast}
        onBack={backToList}
        backLabel="Back to volunteers"
        onDataChanged={onDataChanged}
      />
    );
  }

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
        Loading volunteers…
      </div>
    );
  } else if (items.length === 0) {
    body = (
      <div className="adm-state adm-state--empty">
        <p>{search ? "No volunteers match" : "No volunteers have registered yet."}</p>
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
                <th scope="col">Location</th>
                <th scope="col" className="adm-num">Signups</th>
                <th scope="col" className="adm-num">Attended</th>
                <th scope="col" className="adm-num">Issues reported</th>
              </tr>
            </thead>
            <tbody>
              {items.map((volunteer) => (
                <tr
                  key={volunteer.id}
                  className="adm-table-row--link"
                  onClick={() => openVolunteer(volunteer.id)}
                >
                  <td>
                    <button
                      type="button"
                      className="adm-link-btn adm-link-btn--strong"
                      onClick={(e) => {
                        e.stopPropagation();
                        openVolunteer(volunteer.id);
                      }}
                    >
                      {orNotProvided(volunteer.name, "Unnamed volunteer")}
                    </button>
                    <span className="adm-table-sub">{orNotProvided(volunteer.email, "No email")}</span>
                  </td>
                  <td className="adm-cell-wrap">{orNotProvided(volunteer.location, "—")}</td>
                  <td className="adm-num">
                    {volunteer.signups_total}
                    <span className="adm-table-sub">{volunteer.signups_approved} approved</span>
                  </td>
                  <td className="adm-num">{volunteer.events_attended}</td>
                  <td className="adm-num">{volunteer.issues_reported}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <section className="adm-page" aria-labelledby="adm-volunteers-title">
      <header className="adm-page-header">
        <h1 className="adm-page-title" id="adm-volunteers-title">Volunteers</h1>
        <p className="adm-page-sub">
          Every registered volunteer, with their event signups and the problems they reported.
        </p>
      </header>

      <div className="adm-toolbar">
        <label className="adm-search">
          <span className="adm-visually-hidden">Search volunteers</span>
          <input
            type="search"
            className="adm-input"
            placeholder="Search by name, email, location or skills"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </label>

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

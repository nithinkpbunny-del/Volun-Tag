import "./FeaturesPage.css";
 
export default function FeaturesPage({ setPage }) {
  return (
    <div className="page features-page">
      <div className="features-page-container">
        <div className="features-page-header">
          <h1 className="features-page-title">Explore VolunTag</h1>
          <p className="features-page-subtitle">
            See the two AI pipelines that power the platform in action.
          </p>
        </div>
 
        <div className="features-cards">
          {/* AI Matching Card */}
          <div
            className="features-card features-card--matching"
            role="button"
            tabIndex={0}
            onClick={() => setPage("results")}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setPage("results");
              }
            }}
            id="features-matching"
          >
            <div className="features-card-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="9" cy="9" r="5.5" />
                <circle cx="15" cy="15" r="5.5" />
              </svg>
            </div>
            <div className="features-card-text">
              <div className="features-card-label">AI Matching</div>
              <p className="features-card-desc">
                See how volunteers and NGOs are matched using semantic similarity,
                confidence scoring, and category-based boosting.
              </p>
            </div>
            <div className="features-card-arrow">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14" />
                <path d="m12 5 7 7-7 7" />
              </svg>
            </div>
          </div>
 
          {/* Report an Issue Card */}
          <div
            className="features-card features-card--report"
            role="button"
            tabIndex={0}
            onClick={() => setPage("report")}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setPage("report");
              }
            }}
            id="features-report"
          >
            <div className="features-card-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 9v4" />
                <path d="M12 17h.01" />
                <path d="M10.29 3.86 1.82 18a1.5 1.5 0 0 0 1.3 2.25h17.76A1.5 1.5 0 0 0 22.18 18L13.71 3.86a1.5 1.5 0 0 0-2.42 0Z" />
              </svg>
            </div>
            <div className="features-card-text">
              <div className="features-card-label">Report an Issue</div>
              <p className="features-card-desc">
                Report a real-world problem with an optional photo. AI reads the
                image and description, then routes it to the right NGO.
              </p>
            </div>
            <div className="features-card-arrow">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14" />
                <path d="m12 5 7 7-7 7" />
              </svg>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
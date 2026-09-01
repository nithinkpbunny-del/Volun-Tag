import ComplaintStatusBadge from "./ComplaintStatusBadge";
import AIExplanationCard from "./AIExplanationCard";
import "./ReportResultsPage.css";

export default function ReportResultsPage({ result, showToast, onRestart }) {
  if (!result) {
    return (
      <div className="page report-results-page">
        <div className="empty-state result-empty">
          <div className="empty-icon">🚨</div>
          <h3 className="empty-title">No issue report available</h3>
          <p className="empty-desc">Submit an issue first so we can recommend NGOs that can help.</p>
          <button className="primary-btn" onClick={onRestart}>Report an Issue</button>
        </div>
      </div>
    );
  }

  const {
    complaint_id,
    reporter_name,
    contact_information,
    location,
    user_description,
    status,
    recommended_ngos,
    recommendation_explanations,
    created_at,
  } = result;

  const hasRecommendations = Array.isArray(recommended_ngos) && recommended_ngos.length > 0;

  const formatDate = (dateStr) => {
    if (!dateStr) return "—";
    try {
      return new Date(dateStr).toLocaleString();
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="page report-results-page">
      <div className="results-container report-results-container">
        <div className="results-header">
          <div>
            <h1 className="results-title">Issue Report</h1>
            <p className="results-subtitle">Your issue has been recorded</p>
          </div>
          <button className="primary-btn" onClick={onRestart}>Report Another Issue</button>
        </div>

        <div className="complaint-summary-card">
          <div className="summary-row">
            <div>
              <span className="summary-label">Complaint ID</span>
              <p>{complaint_id}</p>
            </div>
            <ComplaintStatusBadge status={status || "Reported"} />
          </div>
          <div className="summary-row">
            <div>
              <span className="summary-label">Reported by</span>
              <p>{reporter_name || "Anonymous"}</p>
            </div>
            <div>
              <span className="summary-label">Location</span>
              <p>{location}</p>
            </div>
          </div>
          <div className="summary-row">
            <div className="summary-block">
              <span className="summary-label">Description</span>
              <p>{user_description}</p>
            </div>
          </div>
          {contact_information && (
            <div className="summary-row">
              <div>
                <span className="summary-label">Contact</span>
                <p>{contact_information}</p>
              </div>
            </div>
          )}
          <div className="summary-row">
            <div>
              <span className="summary-label">Reported on</span>
              <p className="created-at-text">{formatDate(created_at)}</p>
            </div>
          </div>
        </div>

        {hasRecommendations ? (
          <div className="match-grid report-match-grid">
            {recommended_ngos.map((item, index) => (
              <div key={index} className={`match-card tier-${item.confidence}`}>
                <div className="match-card-accent" />
                <div className="match-card-top">
                  <div className="match-card-info">
                    <div className="match-avatar">{item.ngo.charAt(0).toUpperCase()}</div>
                    <div>
                      <h3 className="match-volunteer-name">{item.ngo}</h3>
                      <span className="match-ngo-name">{item.ngo_category}</span>
                    </div>
                  </div>
                  <div className="score-ring report-score-ring">
                    <svg viewBox="0 0 80 80">
                      <circle cx="40" cy="40" r="34" className="ring-track" />
                      <circle
                        cx="40"
                        cy="40"
                        r="34"
                        className={`ring-fill ring-${item.confidence}`}
                        strokeDasharray={2 * Math.PI * 34}
                        strokeDashoffset={2 * Math.PI * 34 * (1 - item.percentage / 100)}
                      />
                    </svg>
                    <span className={`ring-label ring-label-${item.confidence}`}>{item.percentage}%</span>
                  </div>
                </div>

                <div className="match-meta">
                  <span className={`confidence-badge badge-${item.confidence}`}>
                    {item.confidence === "high" ? "🟢" : item.confidence === "medium" ? "🟡" : "🔴"} {item.confidence} confidence
                  </span>
                  <span className="match-category-tag">{item.ngo_category}</span>
                </div>

                <div className="match-description">
                  <p>{item.ngo_requirement}</p>
                </div>

                {Array.isArray(recommendation_explanations) && recommendation_explanations[index] && (
                  <AIExplanationCard explanation={recommendation_explanations[index]} />
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="pending-recommendations">
            <div className="pending-icon">🔍</div>
            <h3 className="pending-title">NGO Recommendations Pending</h3>
            <p className="pending-desc">
              NGO recommendations will appear once the issue is processed. Check back later for matched organizations that can help.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

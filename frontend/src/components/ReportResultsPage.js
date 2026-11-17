import "./ReportResultsPage.css";

export default function ReportResultsPage({
  result,
  showToast,
  onRestart,
  onGoToMessages,
  onGoToDashboard,
}) {
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

  const { complaint_id } = result;

  return (
    <div className="page report-results-page">
      <div className="results-container report-results-container">
        <div className="pending-recommendations report-thanks-card">
          <h1 className="pending-title report-thanks-title">Thank you for reporting this issue</h1>
          <p className="pending-desc">
            Your issue has been flagged to the relevant NGOs. Please check your Messages frequently to coordinate and communicate with them.
          </p>
          <p className="report-thanks-ref">Reference: {complaint_id}</p>

          <div className="report-thanks-actions">
            <button type="button" className="primary-btn" onClick={onGoToMessages}>
              Go to Messages
            </button>
            <button type="button" className="form-back-btn" onClick={onGoToDashboard}>
              Back to my dashboard
            </button>
            <button type="button" className="report-thanks-link" onClick={onRestart}>
              Report another problem
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

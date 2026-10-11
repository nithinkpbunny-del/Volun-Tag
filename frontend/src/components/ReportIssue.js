import IssueReportForm from "./IssueReportForm";
import "./ReportIssue.css";

export default function ReportIssue({ showToast, onReportSuccess, reporterEmail, setPage }) {
  if (!reporterEmail) {
    return (
      <div className="page report-page">
        <div className="form-card report-card report-gate-card">
          <div className="form-header">
            <div className="form-icon-wrap report-icon">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 9v4" />
                <path d="M12 17h.01" />
                <path d="M10.29 3.86 1.82 18a1.5 1.5 0 0 0 1.3 2.25h17.76A1.5 1.5 0 0 0 22.18 18L13.71 3.86a1.5 1.5 0 0 0-2.42 0Z" />
              </svg>
            </div>
            <h2 className="form-title">Report an Issue</h2>
            <p className="form-subtitle">Register as a volunteer to report a problem</p>
          </div>

          <p style={{ textAlign: "center", color: "var(--text-muted)", margin: "0.5rem 0 1.5rem", fontSize: "0.95rem", lineHeight: 1.5 }}>
            Only registered volunteers can report issues. Your account details are shared with matched NGOs so they can follow up.
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            <button
              className="submit-btn"
              onClick={() => setPage("volunteer-register")}
            >
              Register as a volunteer
            </button>
            <button
              className="form-back-btn"
              onClick={() => setPage("dashboard-login")}
              style={{ width: "100%" }}
            >
              I already have an account
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page report-page">
      <IssueReportForm
        showToast={showToast}
        onReportSuccess={onReportSuccess}
        reporterEmail={reporterEmail}
      />
    </div>
  );
}

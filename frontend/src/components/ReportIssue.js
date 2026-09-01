import IssueReportForm from "./IssueReportForm";
import "./ReportIssue.css";

export default function ReportIssue({ showToast, onReportSuccess }) {
  return (
    <div className="page report-page">
      <IssueReportForm showToast={showToast} onReportSuccess={onReportSuccess} />
    </div>
  );
}

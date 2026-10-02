import { useState, useEffect } from "react";
import Nav from "./components/Nav";
import LandingPage from "./components/LandingPage";
import VolunteerForm from "./components/VolunteerForm";
import VolunteerRegisterForm from "./components/volunteer/VolunteerRegisterForm";
import NGORegisterForm from "./components/ngo/NGORegisterForm";
import ResultsPage from "./components/ResultsPage";
import ReportIssue from "./components/ReportIssue";
import ReportResultsPage from "./components/ReportResultsPage";
import RoleSelect from "./components/RoleSelect";
import FeaturesPage from "./components/features/FeaturesPage";
import Toast, { useToast } from "./components/Toast";
import DashboardLogin from "./components/DashboardLogin";
import VolunteerDashboard from "./components/volunteer/VolunteerDashboard";
import NGODashboard from "./components/ngo/NGODashboard";
import "./VolunTag.css";
 
export default function VolunTag() {
  const [page, setPage] = useState("landing");
  const { toast, showToast } = useToast();
  const [issueResult, setIssueResult] = useState(null);
  const [dashboardEmail, setDashboardEmail] = useState("");
 
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [page]);
 
  const handleReportSuccess = (payload) => {
    setIssueResult(payload);
    setPage("report-results");
  };
 
  const handleReportRestart = () => {
    setIssueResult(null);
    setPage("report");
  };
 
  return (
    <>
      <Nav page={page} setPage={setPage} />
 
      <main className="page-wrapper">
        <div className={`page-transition ${page}`} key={page}>
          {page === "landing" && <LandingPage setPage={setPage} />}
 
          {page === "role-select" && (
            <RoleSelect setPage={setPage} />
          )}
 
          {page === "features" && (
            <FeaturesPage setPage={setPage} />
          )}
 
          {page === "volunteer-register" && (
            <VolunteerRegisterForm
              showToast={showToast}
              setPage={setPage}
              setDashboardEmail={setDashboardEmail}
            />
          )}
 
          {page === "ngo-register" && (
            <NGORegisterForm
              showToast={showToast}
              setPage={setPage}
              setDashboardEmail={setDashboardEmail}
            />
          )}

          {page === "dashboard-login" && (
            <DashboardLogin
              showToast={showToast}
              setPage={setPage}
              setDashboardEmail={setDashboardEmail}
            />
          )}

          {page === "volunteer-dashboard" && (
            <VolunteerDashboard
              email={dashboardEmail}
              showToast={showToast}
              setPage={setPage}
            />
          )}

          {page === "ngo-dashboard" && (
            <NGODashboard
              email={dashboardEmail}
              showToast={showToast}
              setPage={setPage}
            />
          )}
 
          {page === "volunteer" && (
            <VolunteerForm showToast={showToast} />
          )} 
          {page === "results" && (
            <ResultsPage showToast={showToast} />
          )}
 
          {page === "report" && (
            <ReportIssue
              showToast={showToast}
              onReportSuccess={handleReportSuccess}
            />
          )}
 
          {page === "report-results" && (
            <ReportResultsPage
              result={issueResult}
              showToast={showToast}
              onRestart={handleReportRestart}
            />
          )}
        </div>
      </main>
 
      <Toast {...toast} />
    </>
  );
}
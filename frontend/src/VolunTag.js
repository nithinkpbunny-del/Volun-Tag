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
import EventVolunteers from "./components/ngo/EventVolunteers";
import ResolveIssue from "./components/ngo/ResolveIssue";
import "./VolunTag.css";
 
export default function VolunTag() {
  const [page, setPage] = useState("landing");
  const { toast, showToast } = useToast();
  const [issueResult, setIssueResult] = useState(null);
  const [dashboardEmail, setDashboardEmail] = useState("");
  const [reporterEmail, setReporterEmail] = useState("");
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [selectedIssue, setSelectedIssue] = useState(null);
  const [ngoChatTarget, setNgoChatTarget] = useState(null);
  const [ngoReturnTab, setNgoReturnTab] = useState(null);
  const [volunteerInitialTab, setVolunteerInitialTab] = useState(null);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [page]);

  // The event-volunteers screen needs an event and an NGO login; otherwise go back.
  useEffect(() => {
    if (page === "event-volunteers" && (!selectedEvent || !dashboardEmail)) {
      setPage("ngo-dashboard");
    }
  }, [page, selectedEvent, dashboardEmail]);

  // The resolve-issue screen needs an issue and an NGO login; otherwise go back.
  useEffect(() => {
    if (page === "resolve-issue" && (!selectedIssue || !dashboardEmail)) {
      setPage("ngo-dashboard");
    }
  }, [page, selectedIssue, dashboardEmail]);

  // Clear reporter identity when navigating back to landing (acts like logout).
  useEffect(() => {
    if (page === "landing") {
      setReporterEmail("");
    }
  }, [page]);
 
  const handleReportSuccess = (payload) => {
    setIssueResult(payload);
    setPage("report-results");
  };
 
  const handleReportRestart = () => {
    setIssueResult(null);
    setPage("report");
  };

  const handleReportProblem = (email) => {
    setReporterEmail(email);
    setPage("report");
  };

  const goToVolunteerDashboard = (tab) => {
    setDashboardEmail(reporterEmail || dashboardEmail);
    setVolunteerInitialTab(tab || null);
    setPage("volunteer-dashboard");
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
              onReportProblem={handleReportProblem}
              initialTab={volunteerInitialTab}
              onInitialConsumed={() => setVolunteerInitialTab(null)}
            />
          )}

          {page === "ngo-dashboard" && (
            <NGODashboard
              email={dashboardEmail}
              showToast={showToast}
              setPage={setPage}
              onViewVolunteers={(ev) => {
                setSelectedEvent(ev);
                setPage("event-volunteers");
              }}
              onMarkSolved={(iss) => {
                setSelectedIssue(iss);
                setPage("resolve-issue");
              }}
              initialTab={ngoReturnTab}
              initialChat={ngoChatTarget}
              onInitialConsumed={() => {
                setNgoReturnTab(null);
                setNgoChatTarget(null);
              }}
            />
          )}

          {page === "event-volunteers" && selectedEvent && dashboardEmail && (
            <EventVolunteers
              event={selectedEvent}
              ngoEmail={dashboardEmail}
              showToast={showToast}
              onBack={() => {
                setNgoReturnTab(
                  selectedEvent &&
                    selectedEvent.is_completed &&
                    selectedEvent.status !== "Cancelled"
                    ? "activity"
                    : "events"
                );
                setPage("ngo-dashboard");
              }}
              onConnect={(target) => {
                setNgoChatTarget(target);
                setPage("ngo-dashboard");
              }}
            />
          )}

          {page === "resolve-issue" && selectedIssue && dashboardEmail && (
            <ResolveIssue
              issue={selectedIssue}
              ngoEmail={dashboardEmail}
              showToast={showToast}
              onBack={() => {
                setNgoReturnTab("problems");
                setPage("ngo-dashboard");
              }}
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
              reporterEmail={reporterEmail}
              setPage={setPage}
            />
          )}
 
          {page === "report-results" && (
            <ReportResultsPage
              result={issueResult}
              showToast={showToast}
              onRestart={handleReportRestart}
              reporterEmail={reporterEmail}
              setPage={setPage}
              onGoToMessages={() => goToVolunteerDashboard("messages")}
              onGoToDashboard={() => goToVolunteerDashboard(null)}
            />
          )}
        </div>
      </main>
 
      <Toast {...toast} />
    </>
  );
}
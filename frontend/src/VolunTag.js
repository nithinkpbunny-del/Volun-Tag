import { useState, useEffect, useRef } from "react";
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
import {
  getSession,
  logoutUser,
  restoreSession,
  setUnauthorizedHandler,
} from "./api";
import "./VolunTag.css";
 
export default function VolunTag() {
  const [page, setPage] = useState("landing");
  const { toast, showToast } = useToast();
  const [issueResult, setIssueResult] = useState(null);
  const [dashboardEmail, setDashboardEmail] = useState("");
  const [dashboardRole, setDashboardRole] = useState("");
  // True while a stored login is being checked after a page refresh.
  const [restoring, setRestoring] = useState(() => Boolean(getSession()));
  const previousPage = useRef(null);
  // Only a logged-in volunteer can report a problem; the report form reads
  // the same session itself, this just decides which screen to show.
  const reporterEmail = dashboardRole === "volunteer" ? dashboardEmail : "";
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

  const handleLogin = ({ role, email }) => {
    setDashboardEmail(email);
    setDashboardRole(role);
  };

  // After a page refresh, pick the stored login back up if the server still accepts it.
  useEffect(() => {
    if (!getSession()) {
      setRestoring(false);
      return undefined;
    }

    let cancelled = false;

    restoreSession().then((session) => {
      if (cancelled) return;

      if (session) {
        handleLogin(session);
        setPage(session.role === "ngo" ? "ngo-dashboard" : "volunteer-dashboard");
      }

      setRestoring(false);
    });

    return () => {
      cancelled = true;
    };
    // Runs once on load; handleLogin only sets state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When the server rejects the login (expired or ended), return to the login screen.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setDashboardEmail("");
      setDashboardRole("");
      setPage("dashboard-login");
      showToast("Please log in again", "error");
    });

    return () => setUnauthorizedHandler(null);
  }, [showToast]);

  // Going back to the landing page logs out (ends the session on the server too).
  useEffect(() => {
    if (page === "landing" && previousPage.current && previousPage.current !== "landing") {
      logoutUser();
      setDashboardEmail("");
      setDashboardRole("");
    }

    previousPage.current = page;
  }, [page]);
 
  const handleReportSuccess = (payload) => {
    setIssueResult(payload);
    setPage("report-results");
  };
 
  const handleReportRestart = () => {
    setIssueResult(null);
    setPage("report");
  };

  const handleReportProblem = () => {
    setPage("report");
  };

  const goToVolunteerDashboard = (tab) => {
    setVolunteerInitialTab(tab || null);
    setPage("volunteer-dashboard");
  };
 
  return (
    <>
      <Nav page={page} setPage={setPage} />
 
      <main className="page-wrapper">
        <div className={`page-transition ${page}`} key={page}>
          {restoring && <p className="page" style={{ textAlign: "center" }}>Loading…</p>}

          {!restoring && page === "landing" && <LandingPage setPage={setPage} />}
 
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
              onLogin={handleLogin}
            />
          )}
 
          {page === "ngo-register" && (
            <NGORegisterForm
              showToast={showToast}
              setPage={setPage}
              onLogin={handleLogin}
            />
          )}

          {page === "dashboard-login" && (
            <DashboardLogin
              showToast={showToast}
              setPage={setPage}
              onLogin={handleLogin}
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
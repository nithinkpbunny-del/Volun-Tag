import { useState, useEffect, useRef, useCallback } from "react";
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import Nav from "./components/Nav";
import ComingSoon from "./components/ComingSoon";
import { RequireRole } from "./components/RouteGuards";
import LandingPage from "./components/LandingPage";
// The old VolunteerForm screen is no longer routed, but its stylesheet holds the
// shared form styles (form-card, form-title, submit-btn, ...) that the login,
// registration, report and resolve screens use. Keep it loaded, in the same
// place in the import order as before.
import "./components/VolunteerForm.css";
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
import {
  COMING_SOON_PAGES,
  PATHS,
  dashboardFor,
  eventVolunteersPath,
  pageFromPath,
  resolveIssuePath,
} from "./routes";
import "./VolunTag.css";

// The event and issue screens get their data from the router's location
// state (set when the NGO clicks through from the dashboard). Without it
// (for example a link opened in a new tab) they go back to the dashboard.
function EventVolunteersRoute({ ngoEmail, showToast, onBack, onConnect }) {
  const { id } = useParams();
  const { state } = useLocation();
  const event = state && state.event;

  if (!event || !ngoEmail || String(event.id) !== id) {
    return <Navigate to={PATHS["ngo-dashboard"]} replace />;
  }

  return (
    <EventVolunteers
      event={event}
      ngoEmail={ngoEmail}
      showToast={showToast}
      onBack={() => onBack(event)}
      onConnect={onConnect}
    />
  );
}

function ResolveIssueRoute({ ngoEmail, showToast, onBack }) {
  const { id } = useParams();
  const { state } = useLocation();
  const issue = state && state.issue;

  if (!issue || !ngoEmail || String(issue.complaint_id) !== id) {
    return <Navigate to={PATHS["ngo-dashboard"]} replace />;
  }

  return (
    <ResolveIssue
      issue={issue}
      ngoEmail={ngoEmail}
      showToast={showToast}
      onBack={onBack}
    />
  );
}

function ReportResultsRoute({ children }) {
  const { state } = useLocation();
  const result = state && state.result;

  if (!result) {
    return <Navigate to={PATHS.report} replace />;
  }

  return children(result);
}

export default function VolunTag() {
  const location = useLocation();
  const navigate = useNavigate();
  const page = pageFromPath(location.pathname);

  const { toast, showToast } = useToast();
  const [dashboardEmail, setDashboardEmail] = useState("");
  const [dashboardRole, setDashboardRole] = useState("");
  // True while a stored login is being checked after a page refresh.
  const [restoring, setRestoring] = useState(() => Boolean(getSession()));
  // Only a logged-in volunteer can report a problem; the report form reads
  // the same session itself, this just decides which screen to show.
  const reporterEmail = dashboardRole === "volunteer" ? dashboardEmail : "";
  const loggedIn = dashboardRole === "volunteer" || dashboardRole === "ngo";
  const [ngoChatTarget, setNgoChatTarget] = useState(null);
  const [ngoReturnTab, setNgoReturnTab] = useState(null);
  const [volunteerInitialTab, setVolunteerInitialTab] = useState(null);

  // Temporary bridge: screens still call setPage("page-name"); this turns it
  // into a navigation. Its identity never changes, because the dashboards list
  // it in effect dependencies and a new one every render would refetch them.
  // (navigate itself changes whenever the address changes.)
  const navigateRef = useRef(navigate);
  const pathRef = useRef(location.pathname);
  navigateRef.current = navigate;
  pathRef.current = location.pathname;

  const setPage = useCallback((name) => {
    const target = PATHS[name];

    if (!target) return;

    const from = pageFromPath(pathRef.current);
    const fromDashboard = from === "volunteer-dashboard" || from === "ngo-dashboard";

    // A dashboard sending the user to the login screen (no login, or its data
    // would not load) replaces its own history entry, so Back does not bounce
    // between the two. showLogin tells /login to show the form even if the user
    // is still logged in; otherwise a dashboard that cannot load would be sent
    // back to itself by the "logged in, go to your dashboard" rule, forever.
    if (name === "dashboard-login" && fromDashboard) {
      navigateRef.current(target, { replace: true, state: { showLogin: true } });
      return;
    }

    // Logging in leaves /login behind: the dashboard replaces the login entry,
    // so Back goes to the page before the login screen.
    const toDashboard = name === "volunteer-dashboard" || name === "ngo-dashboard";

    navigateRef.current(target, { replace: from === "dashboard-login" && toDashboard });
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [location.pathname]);

  const handleLogin = ({ role, email }) => {
    setDashboardEmail(email);
    setDashboardRole(role);
  };

  // After a page refresh, pick the stored login back up if the server still
  // accepts it. The address is left as it is.
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
      }

      setRestoring(false);
    });

    return () => {
      cancelled = true;
    };
    // Runs once on load; handleLogin only sets state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When the server rejects the login (expired or ended), return to the login
  // screen. In order: clear the user, go to /login (replacing the current entry),
  // show the toast. The user is cleared in the same handler as the navigation,
  // so /login shows the form instead of forwarding back to a dashboard.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setDashboardEmail("");
      setDashboardRole("");
      navigateRef.current(PATHS["dashboard-login"], {
        replace: true,
        state: { showLogin: true },
      });
      showToast("Please log in again", "error");
    });

    return () => setUnauthorizedHandler(null);
  }, [showToast]);

  // The only way to log out: the Log out button in the navbar. logoutUser clears
  // the stored login first, then tells the server (best effort).
  const handleLogout = () => {
    logoutUser();
    setDashboardEmail("");
    setDashboardRole("");
    navigate(PATHS.landing);
    showToast("Logged out", "success");
  };

  const handleReportSuccess = (payload) => {
    navigate(PATHS["report-results"], { state: { result: payload } });
  };

  const handleReportRestart = () => {
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
      <Nav role={dashboardRole} restoring={restoring} onLogout={handleLogout} />

      <main className="page-wrapper">
        <div className={`page-transition ${page}`} key={location.pathname}>
          {restoring && <p className="page" style={{ textAlign: "center" }}>Loading…</p>}

          {!restoring && (
            <Routes>
              <Route path="/" element={<LandingPage setPage={setPage} />} />

              <Route path="/register" element={<RoleSelect setPage={setPage} />} />

              <Route path="/features" element={<FeaturesPage setPage={setPage} />} />

              <Route
                path="/register/volunteer"
                element={
                  <VolunteerRegisterForm
                    showToast={showToast}
                    setPage={setPage}
                    onLogin={handleLogin}
                  />
                }
              />

              <Route
                path="/register/ngo"
                element={
                  <NGORegisterForm
                    showToast={showToast}
                    setPage={setPage}
                    onLogin={handleLogin}
                  />
                }
              />

              <Route
                path="/login"
                element={
                  loggedIn && !(location.state && location.state.showLogin) ? (
                    <Navigate to={dashboardFor(dashboardRole)} replace />
                  ) : (
                    <DashboardLogin
                      showToast={showToast}
                      setPage={setPage}
                      onLogin={handleLogin}
                    />
                  )
                }
              />

              <Route
                path="/volunteer/dashboard"
                element={
                  <RequireRole role="volunteer" currentRole={dashboardRole}>
                    <VolunteerDashboard
                      email={dashboardEmail}
                      showToast={showToast}
                      setPage={setPage}
                      onReportProblem={handleReportProblem}
                      initialTab={volunteerInitialTab}
                      onInitialConsumed={() => setVolunteerInitialTab(null)}
                    />
                  </RequireRole>
                }
              />

              <Route
                path="/ngo/dashboard"
                element={
                  <RequireRole role="ngo" currentRole={dashboardRole}>
                    <NGODashboard
                      email={dashboardEmail}
                      showToast={showToast}
                      setPage={setPage}
                      onViewVolunteers={(ev) =>
                        navigate(eventVolunteersPath(ev.id), { state: { event: ev } })
                      }
                      onMarkSolved={(iss) =>
                        navigate(resolveIssuePath(iss.complaint_id), { state: { issue: iss } })
                      }
                      initialTab={ngoReturnTab}
                      initialChat={ngoChatTarget}
                      onInitialConsumed={() => {
                        setNgoReturnTab(null);
                        setNgoChatTarget(null);
                      }}
                    />
                  </RequireRole>
                }
              />

              <Route
                path="/ngo/events/:id/volunteers"
                element={
                  <RequireRole role="ngo" currentRole={dashboardRole}>
                    <EventVolunteersRoute
                      ngoEmail={dashboardEmail}
                      showToast={showToast}
                      onBack={(event) => {
                        setNgoReturnTab(
                          event.is_completed && event.status !== "Cancelled"
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
                  </RequireRole>
                }
              />

              <Route
                path="/ngo/issues/:id/resolve"
                element={
                  <RequireRole role="ngo" currentRole={dashboardRole}>
                    <ResolveIssueRoute
                      ngoEmail={dashboardEmail}
                      showToast={showToast}
                      onBack={() => {
                        setNgoReturnTab("problems");
                        setPage("ngo-dashboard");
                      }}
                    />
                  </RequireRole>
                }
              />

              <Route
                path="/features/matching"
                element={<ResultsPage showToast={showToast} />}
              />

              <Route
                path="/report"
                element={
                  <ReportIssue
                    showToast={showToast}
                    onReportSuccess={handleReportSuccess}
                    reporterEmail={reporterEmail}
                    setPage={setPage}
                  />
                }
              />

              <Route
                path="/report/results"
                element={
                  <ReportResultsRoute>
                    {(result) => (
                      <ReportResultsPage
                        result={result}
                        showToast={showToast}
                        onRestart={handleReportRestart}
                        reporterEmail={reporterEmail}
                        setPage={setPage}
                        onGoToMessages={() => goToVolunteerDashboard("messages")}
                        onGoToDashboard={() => goToVolunteerDashboard(null)}
                      />
                    )}
                  </ReportResultsRoute>
                }
              />

              {Object.entries(COMING_SOON_PAGES).map(([path, title]) => (
                <Route key={path} path={path} element={<ComingSoon title={title} />} />
              ))}

              {/* Any other unknown address goes home. */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          )}
        </div>
      </main>

      <Toast {...toast} />
    </>
  );
}

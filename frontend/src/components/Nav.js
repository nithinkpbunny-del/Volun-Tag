
import "./Nav.css";
 
const NAV_ITEMS = ["Home", "News", "About Us", "Contact Us"];
 
export default function Nav({ page, setPage }) {
  const navigate = (target) => {
    setPage(target);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
 
  return (
    <nav className="nav" role="navigation" aria-label="Main navigation">
      <div className="nav-inner">
        <div className="nav-logo" onClick={() => navigate("landing")} tabIndex={0} role="button" aria-label="Go to home page">
          Volun<span className="nav-logo-accent">Tag</span>
        </div>
 
        <div className="nav-static-links">
          {NAV_ITEMS.map((label) => (
            <span key={label} className="nav-static-link">
              {label}
            </span>
          ))}
          <span
            className={`nav-static-link nav-feature-link ${page === "features" ? "active" : ""}`}
            role="button"
            tabIndex={0}
            onClick={() => navigate("features")}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                navigate("features");
              }
            }}
          >
            Features
          </span>

          <span
            className={`nav-static-link nav-feature-link ${page === "dashboard-login" || page === "volunteer-dashboard" || page === "ngo-dashboard" ? "active" : ""}`}
            role="button"
            tabIndex={0}
            onClick={() => navigate("dashboard-login")}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                navigate("dashboard-login");
              }
            }}
          >
            My Dashboard
          </span>
        </div>
      </div>
    </nav>
  );
}
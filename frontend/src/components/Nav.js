import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { dashboardFor, isNavItemActive } from "../routes";
import "./Nav.css";

// Every item the navbar can show. A "link" goes to an address; the "logout"
// item is a button. There is deliberately no admin item: the admin console is
// reached only by typing its address.
const ITEMS = {
  home: { label: "Home", to: "/" },
  features: { label: "Features", to: "/features", accent: true },
  dashboard: { label: "My Dashboard", accent: true },
  report: { label: "Report a problem", to: "/report" },
  news: { label: "News", to: "/news" },
  about: { label: "About", to: "/about" },
  contact: { label: "Contact", to: "/contact" },
  login: { label: "Log in", to: "/login" },
  join: { label: "Join", to: "/register" },
  logout: { label: "Log out", button: true },
};

const MENUS = {
  public: ["home", "features", "report", "news", "about", "contact", "login", "join"],
  volunteer: ["home", "features", "dashboard", "report", "news", "about", "contact", "logout"],
  ngo: ["home", "features", "dashboard", "news", "about", "contact", "logout"],
};

// At this width and below the links move into a drawer opened by the hamburger.
const DRAWER_QUERY = "(max-width: 900px)";

export default function Nav({ role, restoring, onLogout }) {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const toggleRef = useRef(null);

  const menu = role === "volunteer" || role === "ngo" ? MENUS[role] : MENUS.public;

  // Any change of address closes the drawer.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // While the drawer is open the page behind it does not scroll. The cleanup
  // always gives scrolling back (closing, or leaving the page). It is the <html>
  // element that scrolls here (index.css sets overflow-x on html and body, so a
  // lock on <body> alone would not hold).
  useEffect(() => {
    if (!open) return undefined;

    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = "hidden";

    return () => {
      root.style.overflow = previous;
    };
  }, [open]);

  // Esc closes the drawer and puts focus back on the hamburger button.
  useEffect(() => {
    if (!open) return undefined;

    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        setOpen(false);
        if (toggleRef.current) toggleRef.current.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  // Growing the window past the drawer width closes it, so it cannot stay
  // open (with the page locked) while the desktop links are showing.
  useEffect(() => {
    if (!window.matchMedia) return undefined;

    const query = window.matchMedia(DRAWER_QUERY);
    const onChange = (e) => {
      if (!e.matches) setOpen(false);
    };

    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const closeDrawer = () => setOpen(false);

  const renderItem = (id) => {
    const item = ITEMS[id];

    if (item.button) {
      return (
        <li key={id}>
          <button
            type="button"
            className="nav-link nav-link--button"
            onClick={() => {
              closeDrawer();
              onLogout();
            }}
          >
            {item.label}
          </button>
        </li>
      );
    }

    const to = id === "dashboard" ? dashboardFor(role) : item.to;
    const active = isNavItemActive(id, pathname);
    const classes = [
      "nav-link",
      item.accent ? "nav-link--accent" : "",
      active ? "nav-link--active" : "",
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <li key={id}>
        <Link
          to={to}
          className={classes}
          aria-current={active ? "page" : undefined}
          onClick={closeDrawer}
        >
          {item.label}
        </Link>
      </li>
    );
  };

  return (
    <nav className="nav" aria-label="Main navigation">
      <div className="nav-inner">
        <Link className="nav-logo" to="/" aria-label="VolunTag home page" onClick={closeDrawer}>
          Volun<span className="nav-logo-accent">Tag</span>
        </Link>

        {!restoring && (
          <>
            <button
              type="button"
              ref={toggleRef}
              className="nav-toggle"
              aria-expanded={open}
              aria-controls="nav-menu"
              aria-label={open ? "Close menu" : "Open menu"}
              onClick={() => setOpen((value) => !value)}
            >
              <span className="nav-toggle-line" />
              <span className="nav-toggle-line" />
              <span className="nav-toggle-line" />
            </button>

            <div
              className={`nav-backdrop ${open ? "open" : ""}`}
              onClick={closeDrawer}
              aria-hidden="true"
            />

            <ul id="nav-menu" className={`nav-menu ${open ? "open" : ""}`}>
              {menu.map(renderItem)}
            </ul>
          </>
        )}
      </div>
    </nav>
  );
}

// Route paths for the user-facing app (the admin console lives outside this
// router, see App.js).
//
// PATHS maps the old `page` names to their URLs. Screens still call
// setPage("some-page"); VolunTag.js turns that into a navigation. Screens that
// need an id in the address (event volunteers, resolve issue) are not in
// PATHS: they are reached with the helpers below.
import { matchPath } from "react-router-dom";

export const PATHS = {
  landing: "/",
  "role-select": "/register",
  features: "/features",
  results: "/features/matching",
  "volunteer-register": "/register/volunteer",
  "ngo-register": "/register/ngo",
  "dashboard-login": "/login",
  "volunteer-dashboard": "/volunteer/dashboard",
  "ngo-dashboard": "/ngo/dashboard",
  report: "/report",
  "report-results": "/report/results",
};

const PAGE_BY_PATH = Object.fromEntries(
  Object.entries(PATHS).map(([page, path]) => [path, page])
);

// Routes with an id in them, as [pattern, page name].
const PARAM_ROUTES = [
  ["/ngo/events/:id/volunteers", "event-volunteers"],
  ["/ngo/issues/:id/resolve", "resolve-issue"],
];

export const eventVolunteersPath = (eventId) =>
  `/ngo/events/${encodeURIComponent(eventId)}/volunteers`;

export const resolveIssuePath = (complaintId) =>
  `/ngo/issues/${encodeURIComponent(complaintId)}/resolve`;

/**
 * The old `page` name for an address, or "" for an address that is not a
 * screen of the app (for example /news or a typo). The navbar still expects
 * these names.
 */
export function pageFromPath(pathname) {
  const clean = (pathname || "/").replace(/\/+$/, "") || "/";
  const direct = PAGE_BY_PATH[clean.toLowerCase()];

  if (direct) return direct;

  for (const [pattern, page] of PARAM_ROUTES) {
    if (matchPath({ path: pattern, end: true }, clean)) return page;
  }

  return "";
}

// Pages that only say "Coming soon" for now: address -> title.
export const COMING_SOON_PAGES = {
  "/news": "News",
  "/about": "About",
  "/contact": "Contact",
};

function cleanPath(pathname) {
  return ((pathname || "/").replace(/\/+$/, "") || "/").toLowerCase();
}

const startsWithPath = (path, base) => path === base || path.startsWith(base + "/");

/**
 * Which navbar item is the current one for an address.
 *   home       only "/"
 *   features   /features and /features/matching
 *   dashboard  either dashboard, and the NGO event and issue screens under it
 *   report     /report and /report/results
 *   join       /register and /register/*
 * The rest match their own address.
 */
export function isNavItemActive(item, pathname) {
  const path = cleanPath(pathname);

  switch (item) {
    case "home":
      return path === "/";
    case "features":
      return startsWithPath(path, "/features");
    case "dashboard":
      return (
        path === PATHS["volunteer-dashboard"] ||
        path === PATHS["ngo-dashboard"] ||
        startsWithPath(path, "/ngo/events") ||
        startsWithPath(path, "/ngo/issues")
      );
    case "report":
      return startsWithPath(path, "/report");
    case "join":
      return startsWithPath(path, "/register");
    case "login":
      return path === PATHS["dashboard-login"];
    case "news":
    case "about":
    case "contact":
      return path === "/" + item;
    default:
      return false;
  }
}

/** Where a logged-in user's own dashboard lives; the login page if there is no role. */
export function dashboardFor(role) {
  if (role === "ngo") return PATHS["ngo-dashboard"];
  if (role === "volunteer") return PATHS["volunteer-dashboard"];
  return PATHS["dashboard-login"];
}

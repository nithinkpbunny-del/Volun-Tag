import { Link, useLocation } from "react-router-dom";
import "./ComingSoon.css";
import { PATHS } from "../routes";

/** Shown for any address that is not a page of the app. */
export default function NotFound() {
  const { pathname } = useLocation();

  return (
    <div className="page coming-soon-page">
      <div className="coming-soon-card not-found-card">
        <p className="coming-soon-badge">Error 404</p>
        <h1 className="coming-soon-title">Page not found</h1>
        <p className="coming-soon-text">
          There is no page at <code className="not-found-path">{pathname}</code>. It may have moved,
          or the address may have a typo.
        </p>
        <div className="not-found-links">
          <Link className="coming-soon-link" to={PATHS.landing}>
            &#8592; Back to home
          </Link>
          <Link className="coming-soon-link" to={PATHS.features}>
            Explore features
          </Link>
          <Link className="coming-soon-link" to={PATHS.contact}>
            Contact us
          </Link>
        </div>
      </div>
    </div>
  );
}

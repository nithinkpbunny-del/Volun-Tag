import { Link } from "react-router-dom";
import "./ComingSoon.css";

export default function ComingSoon({ title }) {
  return (
    <div className="page coming-soon-page">
      <div className="coming-soon-card">
        <h1 className="coming-soon-title">{title}</h1>
        <p className="coming-soon-badge">Coming soon</p>
        <p className="coming-soon-text">
          We are still working on this page. Please check back later.
        </p>
        <Link className="coming-soon-link" to="/">
          &#8592; Back to home
        </Link>
      </div>
    </div>
  );
}

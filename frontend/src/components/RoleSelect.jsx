import "./RoleSelect.css";

export default function RoleSelect({ setPage, embedded = false }) {
  return (
    <div className={embedded ? "role-select-page role-select-embedded" : "page role-select-page"}>
      <div className="role-select-container">
        <div className="role-select-header">
          <h1 className="role-select-title">Join VolunTag</h1>
          <p className="role-select-subtitle">
            A platform that connects volunteers with NGOs through
            AI-powered skill matching.
          </p>
        </div>

        <div className="role-cards">
          {/* NGO Card */}
          <div
            className="role-card role-card--ngo"
            role="button"
            tabIndex={0}
            onClick={() => setPage("ngo-register")}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setPage("ngo-register");
              }
            }}
            id="role-ngo"
          >
            <div className="role-card-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 21h18" />
                <path d="M5 21V7l7-4 7 4v14" />
                <path d="M9 21v-6h6v6" />
                <path d="M9 9h0.01" />
                <path d="M15 9h0.01" />
                <path d="M9 13h0.01" />
                <path d="M15 13h0.01" />
              </svg>
            </div>
            <div className="role-card-text">
              <div className="role-card-label">Register as NGO</div>
              <p className="role-card-desc">
                For registered organizations looking to host activities and recruit volunteers
              </p>
            </div>
            <div className="role-card-arrow">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14" />
                <path d="m12 5 7 7-7 7" />
              </svg>
            </div>
          </div>

          {/* Volunteer Card */}
          <div
            className="role-card role-card--volunteer"
            role="button"
            tabIndex={0}
            onClick={() => setPage("volunteer-register")}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setPage("volunteer-register");
              }
            }}
            id="role-volunteer"
          >
            <div className="role-card-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            </div>
            <div className="role-card-text">
              <div className="role-card-label">Register as Volunteer</div>
              <p className="role-card-desc">
                For individuals who want to contribute their skills and time to meaningful causes
              </p>
            </div>
            <div className="role-card-arrow">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14" />
                <path d="m12 5 7 7-7 7" />
              </svg>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
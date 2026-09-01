import { useState, useEffect } from "react";
import "./ResultsPage.css";

const API_BASE = "http://127.0.0.1:8000";

function ScoreRing({ score, size = 56 }) {
  const radius = (size - 8) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const tier = score >= 70 ? "high" : score >= 50 ? "mid" : "low";

  return (
    <div className="score-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none" stroke="var(--border)" strokeWidth="4"
        />
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none"
          className={`ring-fill ring-${tier}`}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: "stroke-dashoffset 1s ease" }}
        />
      </svg>
      <span className={`ring-label ring-label-${tier}`}>{score}%</span>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="match-card skeleton">
      <div className="skeleton-bar skeleton-w60" />
      <div className="skeleton-bar skeleton-w40" />
      <div className="skeleton-bar skeleton-w80" />
      <div className="skeleton-bar skeleton-w30" />
    </div>
  );
}

function MatchCard({ volunteer, matches }) {
  const [expanded, setExpanded] = useState(false);
  const bestMatch = matches[0];
  const tier = bestMatch.confidence;

  return (
    <div className={`match-card tier-${tier}`}>
      <div className="match-card-accent" />

      <div className="match-card-top">
        <div className="match-card-info">
          <div className="match-avatar">
            {volunteer.charAt(0).toUpperCase()}
          </div>
          <div>
            <h3 className="match-volunteer-name">{volunteer}</h3>
            <span className="match-ngo-name">→ {bestMatch.ngo}</span>
          </div>
        </div>
        <ScoreRing score={bestMatch.percentage} />
      </div>

      <div className="match-meta">
        <span className={`confidence-badge badge-${tier}`}>
          {tier === "high" ? "🟢" : tier === "medium" ? "🟡" : "🔴"} {tier} confidence
        </span>
        <span className="match-category-tag">{bestMatch.ngo_category}</span>
      </div>

      {/* Progress bar */}
      <div className="match-progress">
        <div className="progress-track">
          <div
            className={`progress-fill fill-${tier}`}
            style={{ width: `${bestMatch.percentage}%` }}
          />
        </div>
      </div>

      {/* Expandable details */}
      {matches.length > 1 && (
        <>
          <button
            className="match-expand-btn"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? "Hide" : "Show"} {matches.length - 1} more match{matches.length - 1 > 1 ? "es" : ""}
            <span className={`expand-arrow ${expanded ? "open" : ""}`}>▾</span>
          </button>

          {expanded && (
            <div className="match-alternatives fade-in">
              {matches.slice(1).map((m, i) => (
                <div key={i} className="alt-match">
                  <div className="alt-match-info">
                    <span className="alt-match-name">{m.ngo}</span>
                    <span className="alt-match-cat">{m.ngo_category}</span>
                  </div>
                  <div className="alt-match-score">
                    <span className={`alt-score-text score-${m.confidence}`}>{m.percentage}%</span>
                    <div className="alt-progress-track">
                      <div className={`progress-fill fill-${m.confidence}`} style={{ width: `${m.percentage}%` }} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function ResultsPage({ showToast }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("");
  const [sortBy, setSortBy] = useState("score");
  const [stats, setStats] = useState(null);

  const fetchMatches = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ sort_by: sortBy, top_n: "3" });
      if (filter) params.append("category", filter);

      const [matchRes, statsRes] = await Promise.all([
        fetch(`${API_BASE}/match?${params}`),
        fetch(`${API_BASE}/stats`),
      ]);

      const matchData = await matchRes.json();
      const statsData = await statsRes.json();

      setData(matchData);
      setStats(statsData);

      if (matchData.matches && matchData.matches.length === 0) {
        showToast && showToast("No matches found. Add volunteers and NGOs first.", "error");
      }
    } catch {
      showToast && showToast("Backend not running. Start the API server.", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMatches();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const matches = data?.matches || [];

  return (
    <div className="page results-page">
      <div className="results-container">
        {/* Header */}
        <div className="results-header">
          <div>
            <h1 className="results-title">Match Results</h1>
            <p className="results-subtitle">AI-powered volunteer-NGO matching</p>
          </div>
        </div>

        {/* Stats summary */}
        {stats && (
          <div className="results-stats">
            <div className="results-stat-item">
              <span className="results-stat-num">{stats.total_volunteers}</span>
              <span className="results-stat-label">Volunteers</span>
            </div>
            <div className="results-stat-item">
              <span className="results-stat-num">{stats.total_ngos}</span>
              <span className="results-stat-label">NGOs</span>
            </div>
            <div className="results-stat-item">
              <span className="results-stat-num">{matches.length}</span>
              <span className="results-stat-label">Matches</span>
            </div>
          </div>
        )}

        {/* Controls */}
        <div className="results-controls">
          <div className="filter-group">
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="filter-select"
              id="filter-category"
            >
              <option value="">All Categories</option>
              <option value="Education">📚 Education</option>
              <option value="Health">🏥 Health</option>
              <option value="Environment">🌿 Environment</option>
              <option value="Animal Welfare">🐾 Animal Welfare</option>
              <option value="Social Services">🤝 Social Services</option>
            </select>

            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="filter-select"
              id="sort-by"
            >
              <option value="score">Sort: Best Score</option>
              <option value="name">Sort: Name A-Z</option>
            </select>
          </div>

          <button className="refresh-btn" onClick={fetchMatches} disabled={loading} id="refresh-matches">
            {loading ? "⟳ Loading..." : "⟳ Refresh"}
          </button>
        </div>

        {/* Match Grid */}
        {loading ? (
          <div className="match-grid">
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        ) : matches.length > 0 ? (
          <div className="match-grid">
            {matches.map((m, i) => (
              <MatchCard key={i} volunteer={m.volunteer} matches={m.matches} />
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <div className="empty-icon">🔍</div>
            <h3 className="empty-title">No Matches Yet</h3>
            <p className="empty-desc">Add volunteers and NGOs first, then come back to see AI-powered matches.</p>
          </div>
        )}
      </div>
    </div>
  );
}

import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import RoleSelect from "./RoleSelect";
import "./LandingPage.css";
import { API_BASE } from "../config";
import { PATHS } from "../routes";
import { CONTACT_EMAIL, REPO_URL } from "../content/contact";

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * The real platform numbers from GET /stats. A counter whose value is 0 is
 * left out, and the whole strip is hidden when nothing is left or the
 * request fails, so the page never shows made-up or empty numbers.
 */
function usePlatformStats() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    let cancelled = false;

    fetch(`${API_BASE}/stats`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;

        const known = Array.isArray(data.category_list) ? data.category_list : [];
        const counts = data.categories && typeof data.categories === "object" ? data.categories : {};
        const causeAreas = known.filter((name) => Number(counts[name]) > 0).length;

        setItems(
          [
            { id: "volunteers", label: "Volunteers", value: Number(data.total_volunteers) || 0 },
            { id: "ngos", label: "NGOs", value: Number(data.total_ngos) || 0 },
            { id: "causes", label: "Cause areas with NGOs", value: causeAreas },
          ].filter((item) => item.value > 0)
        );
      })
      .catch(() => {
        // No numbers is better than wrong numbers: the strip stays hidden.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return items;
}

function AnimatedCounter({ target, suffix = "", duration = 2000 }) {
  const [reduced] = useState(prefersReducedMotion);
  const [count, setCount] = useState(0);
  const ref = useRef(null);
  const [started, setStarted] = useState(false);
 
  useEffect(() => {
    if (reduced) return undefined;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting && !started) setStarted(true); },
      { threshold: 0.3 }
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [started, reduced]);
 
  useEffect(() => {
    if (!started) return;
    let start = 0;
    const step = target / (duration / 16);
    const timer = setInterval(() => {
      start += step;
      if (start >= target) { setCount(target); clearInterval(timer); }
      else setCount(Math.floor(start));
    }, 16);
    return () => clearInterval(timer);
  }, [started, target, duration]);
 
  // Without motion the real number is shown straight away.
  const shown = reduced ? target : count;

  return (
    <>
      <span ref={ref} aria-hidden="true">
        {shown.toLocaleString()}{suffix}
      </span>
      <span className="sr-only">
        {target.toLocaleString()}{suffix}
      </span>
    </>
  );
}
 
export default function LandingPage() {
  const stats = usePlatformStats();

  return (
    <div className="landing visible">
      {/* ─── Hero ─────────────────────────────────────────── */}
      <section className="hero" id="hero-section">
        <div className="hero-bg">
          <div className="hero-gradient hero-gradient-1" />
          <div className="hero-gradient hero-gradient-2" />
          <div className="hero-gradient hero-gradient-3" />
          <div className="hero-grid" />
        </div>
 
        <div className="hero-content">
          <h1 className="hero-title">
            Connecting <em>People Who Care</em> With{" "}
            <span className="hero-title-highlight">Causes That Matter</span>
          </h1>
 
          <p className="hero-subtitle">
            VolunTag uses semantic AI to match volunteers with NGOs based on
            skills, interests, and impact potential — not just keywords.
          </p>
 
        </div>
      </section>
 
      <RoleSelect embedded />
 
      {/* ─── Stats ────────────────────────────────────────── */}
      {stats.length > 0 && (
        <section className="stats-section" id="stats-section" aria-label="VolunTag in numbers">
          <div className="stats-container">
            {stats.map((item, index) => (
              <div className="stat-group" key={item.id}>
                {index > 0 && <div className="stat-divider" aria-hidden="true" />}
                <div className="stat-item">
                  <div className="stat-number">
                    <AnimatedCounter target={item.value} />
                  </div>
                  <div className="stat-label">{item.label}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
 
      {/* ─── How It Works ─────────────────────────────────── */}
      <section className="how-section" id="how-it-works">
        <div className="section-container">
          <div className="section-header">
            <span className="section-tag">Simple Process</span>
            <h2 className="section-heading">How VolunTag Works</h2>
            <p className="section-desc">Three simple steps to make a meaningful connection</p>
          </div>
 
          <div className="steps-grid">
            <div className="step-card">
              <div className="step-number">01</div>
              <div className="step-icon">
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 19.5V6a2 2 0 0 1 2-2h9l5 5v10.5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" />
                  <path d="M14 4v5h5" />
                  <path d="M8 13h6" />
                  <path d="M8 17h4" />
                </svg>
              </div>
              <h3 className="step-title">Sign Up</h3>
              <p className="step-desc">Volunteers list their skills and interests. NGOs describe their needs and requirements.</p>
            </div>
            <div className="step-connector">
              <svg width="40" height="2" viewBox="0 0 40 2"><line x1="0" y1="1" x2="40" y2="1" stroke="var(--sage-mid)" strokeWidth="2" strokeDasharray="4 4"/></svg>
            </div>
            <div className="step-card">
              <div className="step-number">02</div>
              <div className="step-icon">
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9.5 3.5a3 3 0 0 1 5 2.24V6a3 3 0 0 1 3 3v.5a2.5 2.5 0 0 1 0 5V15a3 3 0 0 1-3 3v.25a3 3 0 0 1-5.5 1.64" />
                  <path d="M9.5 3.5A3 3 0 0 0 6 6v.5a3 3 0 0 0-3 3v.5a2.5 2.5 0 0 0 0 5V15a3 3 0 0 0 3 3v.25a3 3 0 0 0 5 1.9" />
                  <path d="M9.5 3.5v16.4" />
                </svg>
              </div>
              <h3 className="step-title">AI Matching</h3>
              <p className="step-desc">Our AI analyzes semantic similarity using NLP to find the best volunteer-NGO pairs.</p>
            </div>
            <div className="step-connector">
              <svg width="40" height="2" viewBox="0 0 40 2"><line x1="0" y1="1" x2="40" y2="1" stroke="var(--sage-mid)" strokeWidth="2" strokeDasharray="4 4"/></svg>
            </div>
            <div className="step-card">
              <div className="step-number">03</div>
              <div className="step-icon">
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="8" cy="12" r="3.2" />
                  <circle cx="16" cy="12" r="3.2" />
                  <path d="M10.8 12h2.4" />
                </svg>
              </div>
              <h3 className="step-title">Connect</h3>
              <p className="step-desc">View your top matches with confidence scores and start making an impact together.</p>
            </div>
          </div>
        </div>
      </section>
 
      {/* ─── Features ─────────────────────────────────────── */}
      <section className="features-section" id="features-section">
        <div className="section-container">
          <div className="section-header">
            <span className="section-tag">Why VolunTag</span>
            <h2 className="section-heading">Powered by Intelligence</h2>
            <p className="section-desc">Smart features that make volunteering more impactful</p>
          </div>
 
          <div className="features-grid">
            <div className="feature-card">
              <div className="feature-icon-wrap">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="9" />
                  <circle cx="12" cy="12" r="5" />
                  <circle cx="12" cy="12" r="1" />
                </svg>
              </div>
              <h3 className="feature-title">Semantic Matching</h3>
              <p className="feature-desc">Goes beyond keyword matching. Our AI understands context and meaning behind skills and requirements.</p>
            </div>
            <div className="feature-card">
              <div className="feature-icon-wrap">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 19V10" />
                  <path d="M10 19V5" />
                  <path d="M16 19v-8" />
                  <path d="M22 19H2" />
                </svg>
              </div>
              <h3 className="feature-title">Confidence Scoring</h3>
              <p className="feature-desc">Every match comes with a confidence score so you know how well-aligned a volunteer is with an NGO.</p>
            </div>
            <div className="feature-card">
              <div className="feature-icon-wrap">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20.5 12.5 12.9 20a1.5 1.5 0 0 1-2.12 0L3.5 12.7a1.5 1.5 0 0 1-.4-1.36L4.4 5.2A1.5 1.5 0 0 1 5.87 4l6.15-.9a1.5 1.5 0 0 1 1.36.4l7.13 7.12a1.5 1.5 0 0 1 0 2.12Z" />
                  <circle cx="9" cy="9" r="1.4" />
                </svg>
              </div>
              <h3 className="feature-title">Category Weighting</h3>
              <p className="feature-desc">Matches are boosted when volunteer skills align with the NGO's domain — education, health, environment, and more.</p>
            </div>
            <div className="feature-card">
              <div className="feature-icon-wrap">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M13 3 4 14h6l-1 7 9-11h-6l1-7Z" />
                </svg>
              </div>
              <h3 className="feature-title">Instant Results</h3>
              <p className="feature-desc">Get matched in seconds. Our backend processes embeddings in real-time for immediate feedback.</p>
            </div>
            <div className="feature-card">
              <div className="feature-icon-wrap">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
                  <path d="M21 3v5h-5" />
                  <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
                  <path d="M3 21v-5h5" />
                </svg>
              </div>
              <h3 className="feature-title">Multi-Match</h3>
              <p className="feature-desc">See your top 3 matches ranked by score, not just a single best match. More options, better outcomes.</p>
            </div>
            <div className="feature-card">
              <div className="feature-icon-wrap">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M3 12h18" />
                  <path d="M12 3a13 13 0 0 1 0 18" />
                  <path d="M12 3a13 13 0 0 0 0 18" />
                </svg>
              </div>
              <h3 className="feature-title">5 Categories</h3>
              <p className="feature-desc">Education, Health, Environment, Animal Welfare, and Social Services — covering the full spectrum of impact.</p>
            </div>
          </div>
        </div>
      </section>
 
      {/* ─── CTA ──────────────────────────────────────────── */}
      <section className="cta-section" id="cta-section">
        <div className="cta-container">
          <div className="cta-bg">
            <div className="cta-gradient cta-gradient-1" />
            <div className="cta-gradient cta-gradient-2" />
          </div>
          <div className="cta-content">
            <h2 className="cta-title">Ready to Make an Impact?</h2>
            <p className="cta-desc">Register as a volunteer or as an NGO, and let VolunTag suggest where your skills or your cause fit best.</p>
          </div>
        </div>
      </section>
 
      {/* ─── Footer ───────────────────────────────────────── */}
      <footer className="footer" id="footer">
        <div className="footer-container">
          <div className="footer-top">
            <div className="footer-brand">
              <div className="footer-logo">Volun<span>Tag</span></div>
              <p className="footer-tagline">AI-powered volunteer matching for a better world.</p>
            </div>
            <div className="footer-links-group">
              <h4>Categories</h4>
              <span>Education</span>
              <span>Health</span>
              <span>Environment</span>
              <span>Social Services</span>
            </div>
          </div>
          <div className="footer-bottom">
            <p>
              © {new Date().getFullYear()} VolunTag ·{" "}
              <Link to={PATHS.about}>About</Link> ·{" "}
              <Link to={PATHS.contact}>Contact</Link> ·{" "}
              <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> ·{" "}
              <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
                Source code
              </a>
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
 

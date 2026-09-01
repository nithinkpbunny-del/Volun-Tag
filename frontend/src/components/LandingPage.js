import { useState, useEffect, useRef } from "react";
import RoleSelect from "./RoleSelect";
import "./LandingPage.css";
 
function AnimatedCounter({ target, suffix = "", duration = 2000 }) {
  const [count, setCount] = useState(0);
  const ref = useRef(null);
  const [started, setStarted] = useState(false);
 
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting && !started) setStarted(true); },
      { threshold: 0.3 }
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [started]);
 
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
 
  return <span ref={ref}>{count.toLocaleString()}{suffix}</span>;
}
 
export default function LandingPage({ setPage }) {
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
          <div className="hero-badge">
            <span className="hero-badge-dot" />
            AI-Powered Matching Platform
          </div>
 
          <h1 className="hero-title">
            Connecting <em>People Who Care</em> With{" "}
            <span className="hero-title-highlight">Causes That Matter</span>
          </h1>
 
          <p className="hero-subtitle">
            VolunTag uses semantic AI to match volunteers with NGOs based on
            skills, interests, and impact potential — not just keywords.
          </p>
 
          <div className="hero-trust">
            <div className="trust-avatars">
              <div className="trust-avatar" style={{ background: "#4a7c6f" }}>K</div>
              <div className="trust-avatar" style={{ background: "#c4714a" }}>R</div>
              <div className="trust-avatar" style={{ background: "#6b8db5" }}>S</div>
              <div className="trust-avatar" style={{ background: "#8b6bb5" }}>A</div>
            </div>
            <span className="trust-text">Join 500+ volunteers making a difference</span>
          </div>
        </div>
      </section>
 
      <RoleSelect setPage={setPage} embedded />
 
      {/* ─── Stats ────────────────────────────────────────── */}
      <section className="stats-section" id="stats-section">
        <div className="stats-container">
          <div className="stat-item">
            <div className="stat-number"><AnimatedCounter target={0} suffix="+" /></div>
            <div className="stat-label">Volunteers</div>
          </div>
          <div className="stat-divider" />
          <div className="stat-item">
            <div className="stat-number"><AnimatedCounter target={0} suffix="+" /></div>
            <div className="stat-label">NGOs</div>
          </div>
          <div className="stat-divider" />
          <div className="stat-item">
            <div className="stat-number"><AnimatedCounter target={0} suffix="%" /></div>
            <div className="stat-label">Match Rate</div>
          </div>
          <div className="stat-divider" />
          <div className="stat-item">
            <div className="stat-number"><AnimatedCounter target={0} suffix="+" /></div>
            <div className="stat-label">Hours Contributed</div>
          </div>
        </div>
      </section>
 
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
 
      {/* ─── Testimonials ─────────────────────────────────── */}
      <section className="testimonials-section" id="testimonials-section">
        <div className="section-container">
          <div className="section-header">
            <span className="section-tag">Impact Stories</span>
            <h2 className="section-heading">What People Say</h2>
          </div>
 
          <div className="testimonials-grid">
            <div className="testimonial-card">
              <div className="testimonial-stars">★★★★★</div>
              <p className="testimonial-text">"VolunTag matched me with an education NGO perfectly aligned with my tutoring skills. The AI-based matching is incredible!"</p>
              <div className="testimonial-author">
                <div className="testimonial-avatar" style={{ background: "#4a7c6f" }}>R</div>
                <div>
                  <div className="testimonial-name">Ravi Kumar</div>
                  <div className="testimonial-role">Volunteer, Education</div>
                </div>
              </div>
            </div>
            <div className="testimonial-card featured">
              <div className="testimonial-stars">★★★★★</div>
              <p className="testimonial-text">"We found 12 skilled volunteers in our first week. The category-weighted matching means we get people who truly understand our mission."</p>
              <div className="testimonial-author">
                <div className="testimonial-avatar" style={{ background: "#c4714a" }}>P</div>
                <div>
                  <div className="testimonial-name">Priya Sharma</div>
                  <div className="testimonial-role">Director, GreenEarth Foundation</div>
                </div>
              </div>
            </div>
            <div className="testimonial-card">
              <div className="testimonial-stars">★★★★★</div>
              <p className="testimonial-text">"The confidence scores help us prioritize outreach. High-scoring matches almost always lead to successful placements."</p>
              <div className="testimonial-author">
                <div className="testimonial-avatar" style={{ background: "#6b8db5" }}>A</div>
                <div>
                  <div className="testimonial-name">Anita Desai</div>
                  <div className="testimonial-role">Coordinator, HealthFirst India</div>
                </div>
              </div>
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
            <p className="cta-desc">Join hundreds of volunteers and NGOs already using VolunTag to create meaningful connections.</p>
            <div className="cta-buttons">
              <button className="hero-btn-secondary" onClick={() => setPage("volunteer-register")}>
                <span>Join as Volunteer</span>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </button>
              <button className="hero-btn-secondary" onClick={() => setPage("ngo-register")}>
                <span>Register NGO</span>
              </button>
            </div>
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
            <p>© 2025 VolunTag.  contact nithinkpbunny@gmail.com</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
 

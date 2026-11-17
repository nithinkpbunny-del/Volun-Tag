import { Link } from "react-router-dom";
import "./InfoPages.css";
import { PATHS } from "../routes";
import { GUIDE, MISSION, PROJECT, REPO_URL, TEAM } from "../content/aboutContent";
import { safeExternalUrl } from "../safeUrl";

const filled = (value) => typeof value === "string" && value.trim() !== "";

const FEATURES = [
  {
    title: "Matching",
    text:
      "Volunteers list their skills, NGOs describe their work. VolunTag compares the two and " +
      "shows each volunteer the NGOs and events where their skills fit best.",
  },
  {
    title: "Events",
    text:
      "NGOs publish events. Volunteers join, the NGO approves who takes part, and after the " +
      "event day the NGO records attendance and a rating.",
  },
  {
    title: "Report a problem",
    text:
      "A registered volunteer can report a local problem with photos. VolunTag reads the " +
      "description and the photos and passes the report to NGOs that work on that kind of problem.",
  },
  {
    title: "Messages",
    text: "Volunteers and NGOs can message each other directly inside VolunTag.",
  },
];

const TECHNOLOGY = [
  "React",
  "FastAPI",
  "SQLite",
  "MiniLM sentence embeddings",
  "BLIP image captions",
  "CLIP image understanding",
];

export default function About() {
  const showProject = filled(PROJECT.college);
  const showGuide = filled(GUIDE.name);
  const team = TEAM.filter((member) => filled(member.name));

  return (
    <div className="page info-page">
      <div className="info-container">
        <header className="info-hero">
          <h1 className="info-title">About VolunTag</h1>
          <p className="info-lead">
            Matching volunteers' skills with the NGOs and events that need them.
          </p>
        </header>

        <section className="info-section" aria-labelledby="about-mission">
          <h2 className="info-section-title" id="about-mission">
            Our mission
          </h2>
          <p className="info-text">{MISSION}</p>
        </section>

        <section className="info-section" aria-labelledby="about-what">
          <h2 className="info-section-title" id="about-what">
            What VolunTag does
          </h2>
          <div className="info-grid">
            {FEATURES.map((feature) => (
              <div className="info-card" key={feature.title}>
                <h3 className="info-card-title">{feature.title}</h3>
                <p className="info-text">{feature.text}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="info-section" aria-labelledby="about-matching">
          <h2 className="info-section-title" id="about-matching">
            How matching works
          </h2>
          <p className="info-text">
            A language model (MiniLM) turns a volunteer's skills and an NGO's or event's
            description into numbers that capture their meaning, and VolunTag measures how close
            the two are. A match gets a small boost when the skills contain words typical of the
            NGO's category (for example “tutoring” for Education) and when both are in the same
            city. Volunteers with several rated events can get a very small extra boost from their
            ratings. Each match shows why it was suggested.
          </p>
          <p className="info-text">
            The score is a guide to start a conversation, not a verdict on anyone.
          </p>
        </section>

        <section className="info-section" aria-labelledby="about-trust">
          <h2 className="info-section-title" id="about-trust">
            Trust and safety
          </h2>
          <ul className="info-list">
            <li>NGOs are reviewed by an administrator, who can verify them from their documents.</li>
            <li>Passwords are stored only as secure hashes, never as plain text.</li>
            <li>
              Photos of a reported problem are visible only to the person who reported it, the NGOs
              it was matched to, and the administrators.
            </li>
            <li>The public matching demo shows no names or locations of volunteers.</li>
          </ul>
        </section>

        {showProject && (
          <section className="info-section" aria-labelledby="about-project">
            <h2 className="info-section-title" id="about-project">
              The project
            </h2>
            <p className="info-text">
              VolunTag is a project at {PROJECT.college.trim()}
              {filled(PROJECT.department) ? `, ${PROJECT.department.trim()}` : ""}
              {filled(PROJECT.academicYear) ? `, academic year ${PROJECT.academicYear.trim()}` : ""}.
            </p>
            {filled(PROJECT.note) && <p className="info-text">{PROJECT.note.trim()}</p>}
          </section>
        )}

        {showGuide && (
          <section className="info-section" aria-labelledby="about-guide">
            <h2 className="info-section-title" id="about-guide">
              {filled(GUIDE.role) ? GUIDE.role.trim() : "Guide"}
            </h2>
            <p className="info-text">{GUIDE.name.trim()}</p>
          </section>
        )}

        {team.length > 0 && (
          <section className="info-section" aria-labelledby="about-team">
            <h2 className="info-section-title" id="about-team">
              Team
            </h2>
            <ul className="info-grid info-team">
              {team.map((member) => (
                <li className="info-card" key={member.name}>
                  <p className="info-card-title">
                    {safeExternalUrl(member.link) ? (
                      <a href={safeExternalUrl(member.link)} target="_blank" rel="noopener noreferrer">
                        {member.name.trim()}
                      </a>
                    ) : (
                      member.name.trim()
                    )}
                  </p>
                  {filled(member.role) && <p className="info-muted">{member.role.trim()}</p>}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="info-section" aria-labelledby="about-tech">
          <h2 className="info-section-title" id="about-tech">
            Technology
          </h2>
          <ul className="info-chips">
            {TECHNOLOGY.map((name) => (
              <li className="info-chip" key={name}>
                {name}
              </li>
            ))}
          </ul>
          <p className="info-text">
            The source code is public:{" "}
            <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
              VolunTag on GitHub
            </a>
            .
          </p>
        </section>

        <section className="info-section info-cta" aria-labelledby="about-next">
          <h2 className="info-section-title" id="about-next">
            Get involved
          </h2>
          <div className="info-cta-links">
            <Link className="info-cta-link" to={PATHS["volunteer-register"]}>
              Join as a volunteer
            </Link>
            <Link className="info-cta-link" to={PATHS["ngo-register"]}>
              Register your NGO
            </Link>
            <Link className="info-cta-link" to={PATHS.contact}>
              Contact us
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}

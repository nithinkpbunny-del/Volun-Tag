import { useState } from "react";
import "./VolunteerForm.css";

const SKILL_SUGGESTIONS = [
  "Teaching", "Tutoring", "Mentoring", "First Aid", "Web Development",
  "Graphic Design", "Writing", "Public Speaking", "Photography",
  "Counseling", "Data Analysis", "Event Planning", "Fundraising",
  "Social Media", "Translation", "Nursing", "Cooking", "Driving",
  "Construction", "Legal Aid", "Music", "Sports Coaching",
];

const API_BASE = "http://127.0.0.1:8000";

export default function VolunteerForm({ showToast }) {
  const [form, setForm] = useState({ name: "", skills: "", location: "", availability: "", experience: "" });
  const [selectedSkills, setSelectedSkills] = useState([]);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(1);
  const [errors, setErrors] = useState({});

  const toggleSkill = (skill) => {
    setSelectedSkills((prev) =>
      prev.includes(skill) ? prev.filter((s) => s !== skill) : [...prev, skill]
    );
  };

  const validate = () => {
    const errs = {};
    if (!form.name.trim()) errs.name = "Name is required";
    if (!form.skills.trim() && selectedSkills.length === 0) errs.skills = "Add at least one skill";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) {
      showToast("Please fill in required fields", "error");
      return;
    }

    setLoading(true);

    const allSkills = [...selectedSkills, ...form.skills.split(",").map(s => s.trim()).filter(Boolean)].join(", ");

    try {
      const res = await fetch(`${API_BASE}/add-volunteer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, skills: allSkills }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || "Failed to add volunteer");
      }

      showToast("🎉 Volunteer registered successfully!");
      setForm({ name: "", skills: "", location: "", availability: "", experience: "" });
      setSelectedSkills([]);
      setStep(1);
      setErrors({});
    } catch (err) {
      showToast(err.message || "Backend not connected", "error");
    } finally {
      setLoading(false);
    }
  };

  const canProceed = step === 1 ? form.name.trim() : true;

  return (
    <div className="page form-page">
      <div className="form-card volunteer-card">
        {/* Step indicator */}
        <div className="step-indicator">
          <div className={`step-dot ${step >= 1 ? "active" : ""}`}>
            <span>1</span>
          </div>
          <div className={`step-line ${step >= 2 ? "active" : ""}`} />
          <div className={`step-dot ${step >= 2 ? "active" : ""}`}>
            <span>2</span>
          </div>
        </div>

        <div className="form-header">
          <div className="form-icon-wrap">🙋</div>
          <h2 className="form-title">Join as Volunteer</h2>
          <p className="form-subtitle">
            {step === 1 ? "Tell us about yourself" : "What skills can you offer?"}
          </p>
        </div>

        {step === 1 && (
          <div className="form-step fade-in">
            <div className="form-group">
              <label htmlFor="vol-name">Full Name <span className="required">*</span></label>
              <input
                id="vol-name"
                type="text"
                placeholder="e.g. Ravi Kumar"
                value={form.name}
                onChange={(e) => { setForm({ ...form, name: e.target.value }); setErrors({ ...errors, name: "" }); }}
                className={errors.name ? "input-error" : ""}
              />
              {errors.name && <span className="error-text">{errors.name}</span>}
            </div>

            <div className="form-group">
              <label htmlFor="vol-location">Location</label>
              <input
                id="vol-location"
                type="text"
                placeholder="e.g. Mumbai, India"
                value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
              />
            </div>

            <div className="form-group">
              <label htmlFor="vol-availability">Availability</label>
              <select
                id="vol-availability"
                value={form.availability}
                onChange={(e) => setForm({ ...form, availability: e.target.value })}
              >
                <option value="">Select availability</option>
                <option value="Weekdays">Weekdays</option>
                <option value="Weekends">Weekends</option>
                <option value="Flexible">Flexible</option>
                <option value="Part-time">Part-time</option>
                <option value="Full-time">Full-time</option>
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="vol-experience">Experience Level</label>
              <select
                id="vol-experience"
                value={form.experience}
                onChange={(e) => setForm({ ...form, experience: e.target.value })}
              >
                <option value="">Select experience</option>
                <option value="Beginner">Beginner</option>
                <option value="Intermediate">Intermediate</option>
                <option value="Experienced">Experienced</option>
                <option value="Expert">Expert</option>
              </select>
            </div>

            <button
              className="form-next-btn"
              onClick={() => { if (canProceed) setStep(2); else { setErrors({ name: "Name is required" }); showToast("Please enter your name", "error"); } }}
              id="vol-next"
            >
              Next: Skills →
            </button>
          </div>
        )}

        {step === 2 && (
          <div className="form-step fade-in">
            <div className="form-group">
              <label>Select Skills <span className="required">*</span></label>
              <div className="skill-tags">
                {SKILL_SUGGESTIONS.map((skill) => (
                  <button
                    key={skill}
                    className={`skill-tag ${selectedSkills.includes(skill) ? "selected" : ""}`}
                    onClick={() => toggleSkill(skill)}
                    type="button"
                  >
                    {selectedSkills.includes(skill) ? "✓ " : "+ "}{skill}
                  </button>
                ))}
              </div>
              {errors.skills && <span className="error-text">{errors.skills}</span>}
            </div>

            <div className="form-group">
              <label htmlFor="vol-skills-extra">Additional Skills</label>
              <textarea
                id="vol-skills-extra"
                placeholder="Describe any additional skills, separated by commas..."
                value={form.skills}
                onChange={(e) => setForm({ ...form, skills: e.target.value })}
              />
              <span className="form-hint">e.g. Machine Learning, Data Visualization, Leadership</span>
            </div>

            <div className="form-actions">
              <button className="form-back-btn" onClick={() => setStep(1)}>
                ← Back
              </button>
              <button
                className={`submit-btn ${loading ? "loading" : ""}`}
                onClick={handleSubmit}
                disabled={loading}
                id="vol-submit"
              >
                {loading ? "Submitting..." : "Register →"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

import { useState } from "react";
import "./VolunteerRegisterForm.css";

const SKILL_SUGGESTIONS = [
  "Teaching", "Tutoring", "Mentoring", "First Aid", "Web Development",
  "Graphic Design", "Writing", "Public Speaking", "Photography",
  "Counseling", "Data Analysis", "Event Planning", "Fundraising",
  "Social Media", "Translation", "Nursing", "Cooking", "Driving",
  "Construction", "Legal Aid", "Music", "Sports Coaching",
];

const GENDER_OPTIONS = ["Male", "Female", "Other", "Prefer not to say"];

const AVAILABILITY_OPTIONS = [
  "Flexible", "Weekdays", "Weekends", "Part-time", "Full-time",
];

const EXPERIENCE_OPTIONS = ["Beginner", "Intermediate", "Experienced"];

const API_BASE = "http://127.0.0.1:8000";

export default function VolunteerRegisterForm({ showToast, setPage }) {
  const [form, setForm] = useState({
    name: "",
    email: "",
    contact_number: "",
    password: "",
    age: "",
    designation: "",
    gender: "",
    skills: "",
    location: "",
    availability: "",
    experience: "",
  });

  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const updateField = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));

    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: "" }));
    }
  };

  const isSkillSelected = (skill) =>
    form.skills
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .includes(skill.toLowerCase());

  const toggleSkill = (skill) => {
    setForm((prev) => {
      const current = prev.skills
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      const exists = current.some(
        (s) => s.toLowerCase() === skill.toLowerCase()
      );

      const updated = exists
        ? current.filter((s) => s.toLowerCase() !== skill.toLowerCase())
        : [...current, skill];

      return { ...prev, skills: updated.join(", ") };
    });

    if (errors.skills) {
      setErrors((prev) => ({ ...prev, skills: "" }));
    }
  };

  const validate = () => {
    const errs = {};

    if (!form.name.trim()) {
      errs.name = "Name is required";
    }

    if (!form.email.trim()) {
      errs.email = "Email is required";
    }

    if (!form.contact_number.trim()) {
      errs.contact_number = "Contact number is required";
    }

    if (!form.password) {
      errs.password = "Password is required";
    }

    if (!form.age) {
      errs.age = "Age is required";
    } else if (
      Number(form.age) < 1 ||
      Number(form.age) > 120
    ) {
      errs.age = "Age must be between 1 and 120";
    }

    if (!form.designation.trim()) {
      errs.designation = "Designation is required";
    }

    if (!form.gender.trim()) {
      errs.gender = "Gender is required";
    }

    if (!form.skills.trim()) {
      errs.skills = "Skills are required";
    }

    if (!form.location.trim()) {
      errs.location = "Location is required";
    }

    if (!form.availability.trim()) {
      errs.availability = "Availability is required";
    }

    setErrors(errs);

    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) {
      showToast("Please fill in all required fields", "error");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch(`${API_BASE}/add-volunteer`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: form.name.trim(),
          email: form.email.trim(),
          contact_number: form.contact_number.trim(),
          password: form.password,
          age: Number(form.age),
          designation: form.designation.trim(),
          gender: form.gender.trim(),
          skills: form.skills.trim(),
          location: form.location.trim(),
          availability: form.availability.trim(),
          experience: form.experience.trim(),
        }),
      });

      let data = {};

      try {
        data = await res.json();
      } catch {
        data = {};
      }

      if (!res.ok) {
        throw new Error(
          data.detail || "Failed to register volunteer"
        );
      }

      showToast("Volunteer registered successfully!", "success");
      setSubmitted(true);
    } catch (err) {
      showToast(
        err.message || "Unable to connect to backend",
        "error"
      );
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <div className="page form-page">
        <div className="form-card volunteer-register-card">
          <div className="volunteer-register-success fade-in">
            <div className="success-icon-wrap">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </div>

            <h2 className="success-title">
              Registration Complete
            </h2>

            <p className="success-desc">
              You have been registered on VolunTag. Your skills
              can now be matched with organizations that need
              your help.
            </p>

            <div className="success-actions">
              <button
                className="success-btn-primary"
                onClick={() => setPage("results")}
                id="volunteer-reg-view-matches"
              >
                View Matches
              </button>

              <button
                className="success-btn-secondary"
                onClick={() => setPage("landing")}
                id="volunteer-reg-go-home"
              >
                Back to Home
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page form-page">
      <div className="form-card volunteer-register-card">
        <div className="form-header">
          <div className="form-icon-wrap volunteer-icon">
            <svg
              width="26"
              height="26"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--sage)"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="8" r="4" />
              <path d="M4 21c0-4.2 3.6-7 8-7s8 2.8 8 7" />
            </svg>
          </div>

          <h2 className="form-title">
            Register as Volunteer
          </h2>

          <p className="form-subtitle">
            Complete the form to create your volunteer profile
            on VolunTag
          </p>
        </div>

        <div className="form-step fade-in">
          {/* Section 1 */}
          <div className="form-section">
            <div className="form-section-header">
              <span className="form-section-number">1</span>
              <span className="form-section-title">
                Personal Details
              </span>
            </div>

            <div className="form-group">
              <label htmlFor="vol-reg-name">
                Full Name <span className="required">*</span>
              </label>

              <input
                id="vol-reg-name"
                type="text"
                value={form.name}
                onChange={(e) =>
                  updateField("name", e.target.value)
                }
                className={errors.name ? "input-error" : ""}
              />

              {errors.name && (
                <span className="error-text">
                  {errors.name}
                </span>
              )}
            </div>

            <div className="form-group">
              <label htmlFor="vol-reg-email">
                Email Address <span className="required">*</span>
              </label>

              <input
                id="vol-reg-email"
                type="email"
                value={form.email}
                onChange={(e) =>
                  updateField("email", e.target.value)
                }
                className={errors.email ? "input-error" : ""}
              />

              {errors.email && (
                <span className="error-text">
                  {errors.email}
                </span>
              )}
            </div>

            <div className="form-group">
              <label htmlFor="vol-reg-contact-number">
                Contact Number{" "}
                <span className="required">*</span>
              </label>

              <input
                id="vol-reg-contact-number"
                type="tel"
                value={form.contact_number}
                onChange={(e) =>
                  updateField(
                    "contact_number",
                    e.target.value
                  )
                }
                className={
                  errors.contact_number ? "input-error" : ""
                }
              />

              {errors.contact_number && (
                <span className="error-text">
                  {errors.contact_number}
                </span>
              )}
            </div>

            <div className="form-group">
              <label htmlFor="vol-reg-password">
                Password <span className="required">*</span>
              </label>

              <input
                id="vol-reg-password"
                type="password"
                value={form.password}
                onChange={(e) =>
                  updateField("password", e.target.value)
                }
                className={errors.password ? "input-error" : ""}
              />

              {errors.password && (
                <span className="error-text">
                  {errors.password}
                </span>
              )}
            </div>

            <div className="form-group">
              <label htmlFor="vol-reg-age">
                Age <span className="required">*</span>
              </label>

              <input
                id="vol-reg-age"
                type="number"
                min="1"
                max="120"
                value={form.age}
                onChange={(e) =>
                  updateField("age", e.target.value)
                }
                className={errors.age ? "input-error" : ""}
              />

              {errors.age && (
                <span className="error-text">
                  {errors.age}
                </span>
              )}
            </div>

            <div className="form-group">
              <label htmlFor="vol-reg-designation">
                Designation <span className="required">*</span>
              </label>

              <input
                id="vol-reg-designation"
                type="text"
                value={form.designation}
                onChange={(e) =>
                  updateField("designation", e.target.value)
                }
                placeholder="e.g. Teacher, Student, Software Engineer"
                className={
                  errors.designation ? "input-error" : ""
                }
              />

              {errors.designation && (
                <span className="error-text">
                  {errors.designation}
                </span>
              )}
            </div>

            <div className="form-group">
              <label>
                Gender <span className="required">*</span>
              </label>

              <div
                className="radio-group"
                role="radiogroup"
                aria-label="Gender"
              >
                {GENDER_OPTIONS.map((option) => (
                  <label className="radio-option" key={option}>
                    <input
                      type="radio"
                      name="vol-reg-gender"
                      value={option}
                      checked={form.gender === option}
                      onChange={(e) =>
                        updateField("gender", e.target.value)
                      }
                    />
                    <span className="radio-custom" />
                    <span className="radio-label-text">
                      {option}
                    </span>
                  </label>
                ))}
              </div>

              {errors.gender && (
                <span className="error-text">
                  {errors.gender}
                </span>
              )}
            </div>

            <div className="form-group">
              <label htmlFor="vol-reg-location">
                Location <span className="required">*</span>
              </label>

              <input
                id="vol-reg-location"
                type="text"
                value={form.location}
                onChange={(e) =>
                  updateField("location", e.target.value)
                }
                className={errors.location ? "input-error" : ""}
                placeholder="e.g. Bangalore, India"
              />

              {errors.location && (
                <span className="error-text">
                  {errors.location}
                </span>
              )}
            </div>
          </div>

          {/* Section 2 */}
          <div className="form-section">
            <div className="form-section-header">
              <span className="form-section-number">2</span>
              <span className="form-section-title">
                Volunteer Profile
              </span>
            </div>

            <div className="form-group">
              <label htmlFor="vol-reg-skills">
                Skills <span className="required">*</span>
              </label>

              <div className="skill-tags">
                {SKILL_SUGGESTIONS.map((skill) => (
                  <button
                    key={skill}
                    type="button"
                    className={`skill-tag ${
                      isSkillSelected(skill) ? "selected" : ""
                    }`}
                    onClick={() => toggleSkill(skill)}
                  >
                    {isSkillSelected(skill) ? "✓ " : "+ "}
                    {skill}
                  </button>
                ))}
              </div>

              <textarea
                id="vol-reg-skills"
                value={form.skills}
                onChange={(e) =>
                  updateField("skills", e.target.value)
                }
                className={errors.skills ? "input-error" : ""}
                rows="3"
                placeholder="Select skills above, or type your own, comma separated..."
              />

              {errors.skills && (
                <span className="error-text">
                  {errors.skills}
                </span>
              )}
            </div>

            <div className="form-group">
              <label htmlFor="vol-reg-availability">
                Availability <span className="required">*</span>
              </label>

              <select
                id="vol-reg-availability"
                value={form.availability}
                onChange={(e) =>
                  updateField("availability", e.target.value)
                }
                className={
                  errors.availability ? "input-error" : ""
                }
              >
                <option value="">Select availability</option>
                {AVAILABILITY_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>

              {errors.availability && (
                <span className="error-text">
                  {errors.availability}
                </span>
              )}
            </div>

            <div className="form-group">
              <label htmlFor="vol-reg-experience">
                Experience{" "}
                <span className="optional-tag">
                  (optional)
                </span>
              </label>

              <select
                id="vol-reg-experience"
                value={form.experience}
                onChange={(e) =>
                  updateField("experience", e.target.value)
                }
              >
                <option value="">Select experience</option>
                {EXPERIENCE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Submit */}
          <div className="form-actions">
            <button
              className="form-back-btn"
              onClick={() => setPage("role-select")}
              type="button"
            >
              &#8592; Back
            </button>

            <button
              className={`submit-btn ${
                loading ? "loading" : ""
              }`}
              onClick={handleSubmit}
              disabled={loading}
              id="vol-reg-submit"
            >
              {loading
                ? "Registering..."
                : "Register Volunteer"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
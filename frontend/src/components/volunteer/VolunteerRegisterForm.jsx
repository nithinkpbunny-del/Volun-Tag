import { useState } from "react";
import { useNavigate } from "react-router-dom";
import "./VolunteerRegisterForm.css";
import { API_BASE } from "../../config";
import { errorText, loginUser } from "../../api";
import { PATHS, dashboardFor } from "../../routes";
import { PasswordField, meetsPasswordPolicy } from "../PasswordRules";
import { CheckEmail } from "../EmailVerification";
import {
  AVAILABILITY_OPTIONS,
  EXPERIENCE_OPTIONS,
  GENDER_OPTIONS,
  SKILL_SUGGESTIONS,
  hasSkill,
  toggleSkill as toggleSkillText,
  validateVolunteerProfile,
} from "./volunteerFields";

export default function VolunteerRegisterForm({ showToast, onLogin }) {
  const navigate = useNavigate();
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
  // The address the confirmation mail went to (shows "Check your email").
  const [checkEmail, setCheckEmail] = useState("");

  const passwordOk = meetsPasswordPolicy(form.password);

  const updateField = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));

    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: "" }));
    }
  };

  const isSkillSelected = (skill) => hasSkill(form.skills, skill);

  const toggleSkill = (skill) => {
    setForm((prev) => ({ ...prev, skills: toggleSkillText(prev.skills, skill) }));

    if (errors.skills) {
      setErrors((prev) => ({ ...prev, skills: "" }));
    }
  };

  const validate = () => {
    // Profile rules are shared with Settings (volunteerFields.js).
    const errs = validateVolunteerProfile(form);

    if (!form.email.trim()) {
      errs.email = "Email is required";
    }

    if (!form.password) {
      errs.password = "Password is required";
    } else if (!passwordOk) {
      errs.password = "Password does not meet all the rules below";
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
          errorText(data, "Failed to register volunteer")
        );
      }

      // Email confirmation is on: the same answer comes back whether or not
      // the address already had an account, so just ask the user to check it.
      if (data.verification_required) {
        setCheckEmail(form.email.trim());
        return;
      }

      showToast("Volunteer registered successfully!", "success");

      // Log in with the email and password just typed, so the dashboard opens.
      try {
        const account = await loginUser("volunteer", form.email.trim(), form.password);
        onLogin({ role: "volunteer", email: account.email || form.email.trim() });
      } catch {
        showToast("Registered. Please log in to continue.", "success");
        navigate(PATHS["dashboard-login"]);
        return;
      }

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

  if (checkEmail) {
    return <CheckEmail role="volunteer" email={checkEmail} />;
  }

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

            <h1 className="success-title">
              Registration Complete
            </h1>

            <p className="success-desc">
              You have been registered on VolunTag. Your skills
              can now be matched with organizations that need
              your help.
            </p>

            <div className="success-actions">
              <button
                className="success-btn-primary"
                onClick={() => navigate(PATHS.results)}
                id="volunteer-reg-view-matches"
              >
                View Matches
              </button>

              <button
                className="success-btn-secondary"
                onClick={() => navigate(dashboardFor("volunteer"))}
                id="volunteer-reg-view-dashboard"
              >
                Go to My Dashboard
              </button>

              <button
                className="success-btn-secondary"
                onClick={() => navigate(PATHS.landing)}
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

          <h1 className="form-title">
            Register as Volunteer
          </h1>

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

              <PasswordField
                id="vol-reg-password"
                value={form.password}
                onChange={(value) => updateField("password", value)}
                hasError={Boolean(errors.password)}
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
              onClick={() => navigate(PATHS["role-select"])}
              type="button"
            >
              &#8592; Back
            </button>

            <button
              className={`submit-btn ${
                loading ? "loading" : ""
              }`}
              onClick={handleSubmit}
              disabled={loading || !passwordOk}
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
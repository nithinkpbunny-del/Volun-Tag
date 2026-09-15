import { useState } from "react";
import "./NGORegisterForm.css";

const CATEGORIES = [
  "Education",
  "Health",
  "Environment",
  "Animal Welfare",
  "Social Services",
];

const DOC_FIELDS = [
  { key: "registration_cert", label: "Registration Certificate", required: false },
  { key: "pan_card", label: "PAN Card", required: false },
  { key: "cert_12a", label: "12A Certificate", required: false },
  { key: "cert_80g", label: "80G Certificate", required: false },
  { key: "cert_fcra", label: "FCRA Certificate", required: false },
];

const API_BASE = "http://127.0.0.1:8000";

export default function NGORegisterForm({ showToast, setPage, setDashboardEmail }) {
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    password: "",
    category: "",
    location: "",
    yearFounded: "",
    websiteUrl: "",
    requirement: "",
  });

  const [docs, setDocs] = useState({});
  const [ngoImages, setNgoImages] = useState([]);
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const updateField = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));

    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: "" }));
    }
  };

  const handleDocChange = (key, event) => {
    const file = event.target.files?.[0];

    if (file) {
      setDocs((prev) => ({
        ...prev,
        [key]: file,
      }));

      setErrors((prev) => ({
        ...prev,
        [key]: "",
      }));
    }
  };

  const removeDoc = (key) => {
    setDocs((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const handleImagesChange = (event) => {
    const files = Array.from(event.target.files || []);

    if (files.length) {
      setNgoImages((prev) => [...prev, ...files]);
    }

    event.target.value = "";
  };

  const removeImage = (index) => {
    setNgoImages((prev) => prev.filter((_, i) => i !== index));
  };

  const validate = () => {
    const errs = {};

    if (!form.name.trim()) {
      errs.name = "Organization name is required";
    }

    if (!form.email.trim()) {
      errs.email = "Email address is required";
    }

    if (!form.phone.trim()) {
      errs.phone = "Contact number is required";
    }

    if (!form.password.trim()) {
      errs.password = "Password is required";
    }

    if (!form.category) {
      errs.category = "Please select a category";
    }

    if (!form.location.trim()) {
      errs.location = "Location is required";
    }

    if (!form.requirement.trim()) {
      errs.requirement = "Volunteer requirement is required";
    }

    setErrors(errs);

    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async () => {
  const isValid = validate();

  console.log("NGO FORM DATA:", form);
  console.log("DOCUMENTS:", docs);
  console.log("VALIDATION RESULT:", isValid);

  if (!isValid) {
    showToast("Please fill in all required fields", "error");
    return;
  }

  setLoading(true);

  try {
    const formData = new FormData();

    formData.append("name", form.name.trim());
    formData.append("email", form.email.trim());
    formData.append("contact_number", form.phone.trim());
    formData.append("password", form.password);
    formData.append("category", form.category);
    formData.append("location", form.location.trim());
    formData.append("requirement", form.requirement.trim());

    if (form.yearFounded) {
      formData.append("year_founded", form.yearFounded);
    }

    if (form.websiteUrl.trim()) {
      formData.append("website_url", form.websiteUrl.trim());
    }

    DOC_FIELDS.forEach((doc) => {
      if (docs[doc.key]) {
        formData.append(doc.key, docs[doc.key]);
      }
    });

    ngoImages.forEach((image) => {
      formData.append("work_images", image);
    });

    const res = await fetch(`${API_BASE}/add-ngo`, {
      method: "POST",
      body: formData,
    });

    let data = {};

    try {
      data = await res.json();
    } catch {
      data = {};
    }

    if (!res.ok) {
      throw new Error(data.detail || "Failed to register NGO");
    }

    showToast(
      "NGO registration submitted for verification!",
      "success"
    );

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
        <div className="form-card ngo-register-card">
          <div className="ngo-register-success fade-in">
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
              Registration Submitted
            </h2>

            <p className="success-desc">
              Your organization has been registered successfully.
              Your verification documents have been submitted for
              review. Your NGO will remain pending until the
              verification process is completed.
            </p>

            <div className="success-actions">
              <button
                className="success-btn-primary"
                onClick={() => setPage("results")}
                id="ngo-reg-view-matches"
              >
                View Matches
              </button>

              <button
                className="success-btn-secondary"
                onClick={() => {
                  setDashboardEmail(form.email.trim());
                  setPage("ngo-dashboard");
                }}
                id="ngo-reg-view-dashboard"
              >
                Go to My Dashboard
              </button>

              <button
                className="success-btn-secondary"
                onClick={() => setPage("landing")}
                id="ngo-reg-go-home"
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
      <div className="form-card ngo-register-card">
        <div className="form-header">
          <div className="form-icon-wrap">
            <svg
              width="26"
              height="26"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--clay)"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 21h18" />
              <path d="M5 21V7l7-4 7 4v14" />
              <path d="M9 21v-6h6v6" />
            </svg>
          </div>

          <h2 className="form-title">Register NGO</h2>

          <p className="form-subtitle">
            Complete the form to register your organization on VolunTag
          </p>
        </div>

        <div className="form-step fade-in">

          {/* ── Section 1: Organization Details ── */}
          <div className="form-section">
            <div className="form-section-header">
              <span className="form-section-number">1</span>
              <span className="form-section-title">
                Organization Details
              </span>
            </div>

            <div className="form-group">
              <label htmlFor="ngo-reg-name">
                Organization Name <span className="required">*</span>
              </label>

              <input
                id="ngo-reg-name"
                type="text"
                value={form.name}
                onChange={(e) =>
                  updateField("name", e.target.value)
                }
                className={errors.name ? "input-error" : ""}
              />

              {errors.name && (
                <span className="error-text">{errors.name}</span>
              )}
            </div>

            <div className="form-group">
              <label htmlFor="ngo-reg-email">
                Email Address <span className="required">*</span>
              </label>

              <input
                id="ngo-reg-email"
                type="email"
                value={form.email}
                onChange={(e) =>
                  updateField("email", e.target.value)
                }
                className={errors.email ? "input-error" : ""}
              />

              {errors.email && (
                <span className="error-text">{errors.email}</span>
              )}
            </div>

            <div className="form-group">
              <label htmlFor="ngo-reg-phone">
                Contact Number <span className="required">*</span>
              </label>

              <input
                id="ngo-reg-phone"
                type="tel"
                value={form.phone}
                onChange={(e) =>
                  updateField("phone", e.target.value)
                }
                className={errors.phone ? "input-error" : ""}
              />

              {errors.phone && (
                <span className="error-text">{errors.phone}</span>
              )}
            </div>

            <div className="form-group">
              <label htmlFor="ngo-reg-password">
                Password <span className="required">*</span>
              </label>

              <input
                id="ngo-reg-password"
                type="password"
                value={form.password}
                onChange={(e) =>
                  updateField("password", e.target.value)
                }
                className={errors.password ? "input-error" : ""}
              />

              {errors.password && (
                <span className="error-text">{errors.password}</span>
              )}
            </div>

            <div className="form-group">
              <label htmlFor="ngo-reg-category">
                Category <span className="required">*</span>
              </label>

              <select
                id="ngo-reg-category"
                value={form.category}
                onChange={(e) =>
                  updateField("category", e.target.value)
                }
                className={errors.category ? "input-error" : ""}
              >
                <option value="">Select a category</option>

                {CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>

              {errors.category && (
                <span className="error-text">
                  {errors.category}
                </span>
              )}
            </div>

            <div className="form-group">
              <label htmlFor="ngo-reg-location">
                Location <span className="required">*</span>
              </label>

              <input
                id="ngo-reg-location"
                type="text"
                value={form.location}
                onChange={(e) =>
                  updateField("location", e.target.value)
                }
                className={errors.location ? "input-error" : ""}
              />

              {errors.location && (
                <span className="error-text">
                  {errors.location}
                </span>
              )}
            </div>

            <div className="form-group">
              <label htmlFor="ngo-reg-year">
                Year Founded{" "}
                <span className="optional-tag">(optional)</span>
              </label>

              <input
                id="ngo-reg-year"
                type="number"
                min="1800"
                max={new Date().getFullYear()}
                value={form.yearFounded}
                onChange={(e) =>
                  updateField("yearFounded", e.target.value)
                }
              />
            </div>

            <div className="form-group">
              <label htmlFor="ngo-reg-website">
                Website URL{" "}
                <span className="optional-tag">(optional)</span>
              </label>

              <input
                id="ngo-reg-website"
                type="url"
                value={form.websiteUrl}
                onChange={(e) =>
                  updateField("websiteUrl", e.target.value)
                }
              />
            </div>

            <div className="form-group">
              <label htmlFor="ngo-reg-requirement">
                Volunteer Requirement{" "}
                <span className="required">*</span>
              </label>

              <textarea
                id="ngo-reg-requirement"
                value={form.requirement}
                onChange={(e) =>
                  updateField("requirement", e.target.value)
                }
                className={errors.requirement ? "input-error" : ""}
                rows="4"
                placeholder="Describe the type of volunteers, skills, or help your NGO needs..."
              />

              {errors.requirement && (
                <span className="error-text">
                  {errors.requirement}
                </span>
              )}
            </div>
          </div>

          {/* ── Section 2: Verification Documents ── */}
          <div className="docs-section">
            <div className="form-section-header">
              <span className="form-section-number">2</span>

              <span className="form-section-title">
                Verification Documents
              </span>
            </div>

            <p className="docs-note">
              Required documents will be securely submitted for
              verification. Your NGO will remain pending until the
              documents are reviewed.
            </p>

            {DOC_FIELDS.map((doc) => (
              <div className="upload-field" key={doc.key}>
                <span className="upload-label">
                  {doc.label}

                  {doc.required ? (
                    <span className="required"> *</span>
                  ) : (
                    <span className="optional-tag">
                      {" "}
                      (optional)
                    </span>
                  )}
                </span>

                {docs[doc.key] ? (
                  <div className="upload-file-preview">
                    <svg
                      className="upload-file-icon"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
                      <path d="M14 2v6h6" />
                    </svg>

                    <span className="upload-file-name">
                      {docs[doc.key].name}
                    </span>

                    <button
                      type="button"
                      className="upload-file-remove"
                      onClick={() => removeDoc(doc.key)}
                      aria-label={`Remove ${doc.label}`}
                    >
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M18 6 6 18" />
                        <path d="m6 6 12 12" />
                      </svg>
                    </button>
                  </div>
                ) : (
                  <>
                    <label className="upload-zone">
                      <svg
                        className="upload-zone-icon"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="17 8 12 3 7 8" />
                        <line x1="12" y1="3" x2="12" y2="15" />
                      </svg>

                      <span className="upload-zone-text">
                        <strong>Click to upload</strong> or drag and
                        drop
                      </span>

                      <input
                        type="file"
                        accept=".pdf,.jpg,.jpeg,.png"
                        onChange={(e) =>
                          handleDocChange(doc.key, e)
                        }
                        aria-label={`Upload ${doc.label}`}
                      />
                    </label>

                    {errors[doc.key] && (
                      <span className="error-text">
                        {errors[doc.key]}
                      </span>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>

          {/* ── Section 3: Additional Credibility ── */}
          <div className="docs-section credibility-section">
            <div className="form-section-header">
              <span className="form-section-number">3</span>

              <span className="form-section-title">
                Additional Credibility
              </span>
            </div>

            <p className="docs-note">
              Optional — photos of your NGO's work can help
              volunteers and reviewers understand your organization.
            </p>

            <div className="upload-field">
              <span className="upload-label">
                Photos of Your Work{" "}
                <span className="optional-tag">(optional)</span>
              </span>

              {ngoImages.length > 0 && (
                <div className="image-preview-grid">
                  {ngoImages.map((file, index) => (
                    <div
                      className="image-thumb"
                      key={`${file.name}-${index}`}
                    >
                      <img
                        src={URL.createObjectURL(file)}
                        alt={file.name}
                      />

                      <button
                        type="button"
                        className="image-thumb-remove"
                        onClick={() => removeImage(index)}
                        aria-label={`Remove ${file.name}`}
                      >
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M18 6 6 18" />
                          <path d="m6 6 12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <label className="upload-zone">
                <svg
                  className="upload-zone-icon"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>

                <span className="upload-zone-text">
                  <strong>Click to upload</strong> or drag and drop
                  images
                </span>

                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleImagesChange}
                  aria-label="Upload photos of your work"
                />
              </label>
            </div>
          </div>

          {/* ── Submit ── */}
          <div className="form-actions">
            <button
              className="form-back-btn"
              onClick={() => setPage("role-select")}
              type="button"
            >
              &#8592; Back
            </button>

            <button
              className={`submit-btn ${loading ? "loading" : ""}`}
              onClick={handleSubmit}
              disabled={loading}
              id="ngo-reg-submit"
            >
              {loading ? "Submitting..." : "Submit NGO Registration"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
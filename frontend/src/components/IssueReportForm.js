import { useState, useEffect } from "react";
import ImagePreviewCard from "./ImagePreviewCard";

const API_BASE = "http://127.0.0.1:8000";

export default function IssueReportForm({ showToast, onReportSuccess, reporterEmail }) {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    user_description: "",
    location: "",
  });
  const [images, setImages] = useState([]);
  const [errors, setErrors] = useState({});

  useEffect(() => {
    return () => {
      images.forEach((image) => URL.revokeObjectURL(image.preview));
    };
  }, [images]);

  const validate = () => {
    const errs = {};
    if (!form.user_description.trim()) errs.user_description = "Describe the issue in detail";
    if (!form.location.trim()) errs.location = "Location is required";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleFileChange = (event) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;
    const nextImages = files.slice(0, 6).map((file) => ({
      file,
      preview: URL.createObjectURL(file),
      name: file.name,
    }));
    setImages((prev) => [...prev, ...nextImages].slice(0, 6));
  };

  const removeImage = (index) => {
    setImages((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleSubmit = async () => {
    if (!validate()) {
      showToast("Please complete all required fields", "error");
      return;
    }

    setLoading(true);

    const formData = new FormData();
    formData.append("user_description", form.user_description.trim());
    formData.append("location", form.location.trim());
    formData.append("reporter_email", reporterEmail);
    images.forEach((img) => {
      formData.append("images", img.file);
    });

    try {
      const response = await fetch(`${API_BASE}/report-issue`, {
        method: "POST",
        body: formData,
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.detail || "Could not submit the issue");
      }

      showToast("Issue reported successfully!", "success");
      onReportSuccess(payload);
    } catch (error) {
      if (error instanceof TypeError) {
        showToast("Unable to connect to the backend. Please try again.", "error");
      } else {
        showToast(error.message || "Unable to connect to backend", "error");
      }
    } finally {
      setLoading(false);
    }
  };

  const canProceed = form.user_description.trim() && form.location.trim();

  return (
    <div className="form-card report-card">
      <div className="step-indicator">
        <div className={`step-dot ${step >= 1 ? "active" : ""}`}><span>1</span></div>
        <div className={`step-line ${step >= 2 ? "active" : ""}`} />
        <div className={`step-dot ${step >= 2 ? "active" : ""}`}><span>2</span></div>
      </div>

      <div className="form-header">
        <div className="form-icon-wrap report-icon">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 9v4" />
            <path d="M12 17h.01" />
            <path d="M10.29 3.86 1.82 18a1.5 1.5 0 0 0 1.3 2.25h17.76A1.5 1.5 0 0 0 22.18 18L13.71 3.86a1.5 1.5 0 0 0-2.42 0Z" />
          </svg>
        </div>
        <h2 className="form-title">Report an Issue</h2>
        <p className="form-subtitle">
          {step === 1 ? "Tell us what happened" : "Add photos and review your report"}
        </p>
        <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginTop: "0.35rem" }}>
          Reporting as <strong>{reporterEmail}</strong>
        </p>
      </div>

      {step === 1 && (
        <div className="form-step fade-in">
          <div className="form-group">
            <label htmlFor="issue-description">Issue Description <span className="required">*</span></label>
            <textarea
              id="issue-description"
              placeholder="Describe the problem: where it happened, what you observed, who is affected..."
              value={form.user_description}
              onChange={(e) => { setForm({ ...form, user_description: e.target.value }); setErrors({ ...errors, user_description: "" }); }}
              className={errors.user_description ? "input-error" : ""}
              rows={5}
            />
            {errors.user_description && <span className="error-text">{errors.user_description}</span>}
          </div>

          <div className="form-group">
            <label htmlFor="issue-location">Location <span className="required">*</span></label>
            <input
              id="issue-location"
              type="text"
              placeholder="e.g. Sector 17, Gurugram"
              value={form.location}
              onChange={(e) => { setForm({ ...form, location: e.target.value }); setErrors({ ...errors, location: "" }); }}
              className={errors.location ? "input-error" : ""}
            />
            {errors.location && <span className="error-text">{errors.location}</span>}
          </div>

          <button
            className="form-next-btn"
            onClick={() => {
              if (canProceed) setStep(2);
              else {
                validate();
                showToast("Please complete required fields", "error");
              }
            }}
          >
            Next: Add Photos (Optional) →
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="form-step fade-in">
          <div className="form-group">
            <label htmlFor="issue-images">Upload Images (Optional)</label>
            <input
              id="issue-images"
              type="file"
              accept="image/*"
              multiple
              onChange={handleFileChange}
            />
            <span className="form-hint">Upload up to 6 photos showing the issue clearly.</span>
          </div>

          {images.length > 0 && (
            <div className="preview-grid">
              {images.map((image, index) => (
                <ImagePreviewCard key={index} file={image} onRemove={() => removeImage(index)} />
              ))}
            </div>
          )}

          <p style={{
            fontSize: "0.82rem",
            color: "var(--text-muted)",
            textAlign: "center",
            margin: "1rem 0 0.5rem",
            lineHeight: 1.45,
          }}>
            Your name and mobile number will be shared with the NGOs matched to this report.
          </p>

          <div className="form-actions">
            <button className="form-back-btn" onClick={() => setStep(1)}>
              ← Back
            </button>
            <button
              className={`submit-btn ${loading ? "loading" : ""}`}
              onClick={handleSubmit}
              disabled={loading}
            >
              {loading ? "Submitting..." : "Submit Report →"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
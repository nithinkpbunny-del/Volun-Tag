import { useState, useEffect, useRef } from "react";
import ImagePreviewCard from "./ImagePreviewCard";
import { API_BASE } from "../config";
import { authFetch, errorText, getSession } from "../api";

export default function IssueReportForm({ showToast, onReportSuccess }) {
  // The reporter is whoever is logged in as a volunteer; it is never typed in.
  const session = getSession();
  const reporterEmail = session && session.role === "volunteer" ? session.email : "";

  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    user_description: "",
    location: "",
  });
  const [images, setImages] = useState([]);
  const [errors, setErrors] = useState({});
  // Server-side problem with the report shown inside the form (e.g. the
  // photo and the description do not match). The typed text and the chosen
  // photos stay, so the user can fix them and submit again.
  const [submitError, setSubmitError] = useState("");
  // True when the error is the photo/description mismatch (it gets extra advice).
  const [isMismatch, setIsMismatch] = useState(false);
  const errorRef = useRef(null);

  // Preview URLs are released when a photo is removed and when the form goes
  // away, never while the photo is still in the form (a kept photo must keep
  // its preview after a rejected submit).
  const imagesRef = useRef(images);
  imagesRef.current = images;
  useEffect(
    () => () => imagesRef.current.forEach((image) => URL.revokeObjectURL(image.preview)),
    []
  );

  // Bring a server error into view and to the screen reader's attention.
  useEffect(() => {
    const el = errorRef.current;
    if (!submitError || !el) return;
    if (typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "center" });
    el.focus({ preventScroll: true });
  }, [submitError]);

  const clearSubmitError = () => {
    setSubmitError("");
    setIsMismatch(false);
  };

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
    setImages((prev) => {
      const kept = [...prev, ...nextImages];
      kept.slice(6).forEach((image) => URL.revokeObjectURL(image.preview));
      return kept.slice(0, 6);
    });
    // The same file can be picked again after it was removed.
    event.target.value = "";
    clearSubmitError();
  };

  const removeImage = (index) => {
    setImages((prev) => {
      const removed = prev[index];
      if (removed) URL.revokeObjectURL(removed.preview);
      return prev.filter((_, idx) => idx !== index);
    });
    clearSubmitError();
  };

  const handleSubmit = async () => {
    if (!reporterEmail) {
      showToast("Please log in as a volunteer to report a problem", "error");
      return;
    }

    if (!validate()) {
      showToast("Please complete all required fields", "error");
      return;
    }

    setLoading(true);
    clearSubmitError();

    const formData = new FormData();
    formData.append("user_description", form.user_description.trim());
    formData.append("location", form.location.trim());
    formData.append("reporter_email", reporterEmail);
    images.forEach((img) => {
      formData.append("images", img.file);
    });

    try {
      const response = await authFetch(`${API_BASE}/report-issue`, {
        method: "POST",
        body: formData,
      });

      let payload = {};
      try {
        payload = await response.json();
      } catch {
        payload = {};
      }

      if (response.status === 422 && payload.code === "image_description_mismatch") {
        setIsMismatch(true);
        setSubmitError(
          payload.message ||
            "The photo and the description do not seem to describe the same problem."
        );
        return;
      }

      if (!response.ok) {
        // Shown in the form (not a toast), so it stays while the user fixes it.
        setSubmitError(errorText(payload, "Could not submit the issue. Please try again."));
        return;
      }

      showToast("Issue reported successfully!", "success");
      onReportSuccess(payload);
    } catch {
      setSubmitError("Unable to reach VolunTag. Check your connection and submit again.");
    } finally {
      setLoading(false);
    }
  };

  const canProceed = form.user_description.trim() && form.location.trim();

  if (!reporterEmail) {
    return (
      <div className="form-card report-card">
        <div className="form-header">
          <h1 className="form-title">Report an Issue</h1>
          <p className="form-subtitle">Log in as a volunteer to report a problem</p>
        </div>
      </div>
    );
  }

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
        <h1 className="form-title">Report an Issue</h1>
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
              onChange={(e) => { setForm({ ...form, user_description: e.target.value }); setErrors({ ...errors, user_description: "" }); clearSubmitError(); }}
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
              onChange={(e) => { setForm({ ...form, location: e.target.value }); setErrors({ ...errors, location: "" }); clearSubmitError(); }}
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
                <ImagePreviewCard key={image.preview} file={image} onRemove={() => removeImage(index)} />
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

          {submitError && (
            <div className="form-error-banner" role="alert" tabIndex={-1} ref={errorRef}>
              <p>{submitError}</p>
              {isMismatch ? (
                <p>
                  Your description and photos are still here: remove or change the photo, or go
                  back to edit the description, then submit again.
                </p>
              ) : (
                <p>Your description and photos are still here, so you can submit again.</p>
              )}
            </div>
          )}

          <div className="form-actions">
            <button type="button" className="form-back-btn" onClick={() => setStep(1)}>
              ← Back
            </button>
            <button
              type="button"
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
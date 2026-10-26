import { useEffect, useState } from "react";
import "./ResolveIssue.css";

const API_BASE = "http://127.0.0.1:8000";

const MIN_TEXT = 50;
const MAX_TEXT = 5000;
const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const DOCUMENT_EXTENSIONS = [".pdf", ".doc", ".docx"];

// Object URL for a chosen file; the old one is revoked on change and on unmount.
function usePreviewUrl(file) {
  const [url, setUrl] = useState("");

  useEffect(() => {
    if (!file) {
      setUrl("");
      return undefined;
    }

    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);

    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  return url;
}

const errorMessage = (detail) => {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail.map((d) => d.msg).filter(Boolean).join(", ");
  }
  return "";
};

export default function ResolveIssue({ issue, ngoEmail, showToast, onBack }) {
  const [solutionType, setSolutionType] = useState("written");
  const [text, setText] = useState("");
  const [documentFile, setDocumentFile] = useState(null);
  const [beforePhoto, setBeforePhoto] = useState(null);
  const [afterPhoto, setAfterPhoto] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const beforePreview = usePreviewUrl(beforePhoto);
  const afterPreview = usePreviewUrl(afterPhoto);

  // Only one of text or document is ever kept, so only one can be submitted.
  const handleTypeChange = (value) => {
    setSolutionType(value);
    if (value === "written") {
      setDocumentFile(null);
    } else {
      setText("");
    }
  };

  const handleDocumentChange = (e) => {
    const file = e.target.files && e.target.files[0];

    if (!file) {
      setDocumentFile(null);
      return;
    }

    const name = file.name.toLowerCase();
    if (!DOCUMENT_EXTENSIONS.some((ext) => name.endsWith(ext))) {
      showToast("The document must be a PDF, DOC, or DOCX file", "error");
      e.target.value = "";
      setDocumentFile(null);
      return;
    }

    if (file.size > MAX_DOCUMENT_BYTES) {
      showToast("The document exceeds the 5 MB size limit", "error");
      e.target.value = "";
      setDocumentFile(null);
      return;
    }

    setDocumentFile(file);
  };

  const handlePhotoChange = (setPhoto) => (e) => {
    const file = e.target.files && e.target.files[0];

    if (!file) {
      setPhoto(null);
      return;
    }

    if (!file.type.startsWith("image/")) {
      showToast("Please choose an image file", "error");
      e.target.value = "";
      setPhoto(null);
      return;
    }

    if (file.size > MAX_PHOTO_BYTES) {
      showToast("The photo exceeds the 10 MB size limit", "error");
      e.target.value = "";
      setPhoto(null);
      return;
    }

    setPhoto(file);
  };

  const hasSolution =
    solutionType === "written"
      ? text.trim().length >= MIN_TEXT
      : Boolean(documentFile);
  const canSubmit = hasSolution && Boolean(beforePhoto) && Boolean(afterPhoto);

  const handleSubmit = async () => {
    if (!canSubmit || submitting) return;

    if (
      !window.confirm(
        "Submit this proof? You will not be able to change it afterwards."
      )
    ) {
      return;
    }

    setSubmitting(true);

    const formData = new FormData();
    formData.append("ngo_email", ngoEmail);
    formData.append("solution_type", solutionType);
    if (solutionType === "written") {
      formData.append("solution_text", text.trim());
    } else {
      formData.append("document", documentFile);
    }
    formData.append("before_photo", beforePhoto);
    formData.append("after_photo", afterPhoto);

    try {
      const res = await fetch(
        `${API_BASE}/issues/${encodeURIComponent(issue.complaint_id)}/resolution`,
        { method: "POST", body: formData }
      );

      let payload = {};
      try {
        payload = await res.json();
      } catch {
        payload = {};
      }

      if (!res.ok) {
        throw new Error(
          errorMessage(payload.detail) || "Could not submit the proof"
        );
      }

      setSubmitted(true);
    } catch (err) {
      if (err instanceof TypeError) {
        showToast("Unable to connect to the backend. Please try again.", "error");
      } else {
        showToast(err.message || "Could not submit the proof", "error");
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="page rs-page">
        <div className="form-card rs-card rs-success">
          <h2 className="form-title">Proof submitted</h2>
          <p className="rs-success-text">
            Your proof has been submitted for evaluation. If it is verified and the issue is solved, it will be listed in your Activities section.
          </p>
          <button type="button" className="submit-btn rs-submit" onClick={onBack}>
            Back to reported problems
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page rs-page">
      <div className="form-card rs-card">
        <button type="button" className="form-back-btn rs-back" onClick={onBack}>
          ← Back to reported problems
        </button>

        <div className="form-header">
          <h2 className="form-title">How was this issue solved?</h2>
        </div>

        <div className="rs-summary">
          <p className="rs-summary-location">{issue.location}</p>
          <p className="rs-summary-description">{issue.user_description}</p>
          <p className="rs-summary-id">{issue.complaint_id}</p>
        </div>

        <div className="rs-radio-row" role="radiogroup" aria-label="Solution type">
          <label className="rs-radio">
            <input
              type="radio"
              name="solution_type"
              value="written"
              checked={solutionType === "written"}
              onChange={() => handleTypeChange("written")}
            />
            <span>Write it here</span>
          </label>
          <label className="rs-radio">
            <input
              type="radio"
              name="solution_type"
              value="document"
              checked={solutionType === "document"}
              onChange={() => handleTypeChange("document")}
            />
            <span>Upload a document</span>
          </label>
        </div>

        {solutionType === "written" && (
          <div className="form-group">
            <textarea
              id="rs-solution-text"
              rows={8}
              maxLength={MAX_TEXT}
              placeholder="Describe in detail how you solved this problem: what was done, who was involved, and the result."
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <div className="rs-text-meta">
              <span className="form-hint">At least {MIN_TEXT} characters</span>
              <span className="rs-counter">
                {text.length}/{MAX_TEXT}
              </span>
            </div>
          </div>
        )}

        {solutionType === "document" && (
          <div className="form-group">
            <label htmlFor="rs-document">Solution document</label>
            <input
              id="rs-document"
              type="file"
              accept=".pdf,.doc,.docx"
              onChange={handleDocumentChange}
            />
            <span className="form-hint">PDF, DOC or DOCX, up to 5 MB.</span>
            {documentFile && (
              <p className="rs-file-name">Selected: {documentFile.name}</p>
            )}
          </div>
        )}

        <div className="rs-photos">
          <div className="form-group rs-photo-group">
            <label htmlFor="rs-before-photo">Before photo (required)</label>
            <input
              id="rs-before-photo"
              type="file"
              accept="image/*"
              onChange={handlePhotoChange(setBeforePhoto)}
            />
            {beforePreview && (
              <img className="rs-preview" src={beforePreview} alt="Before preview" />
            )}
          </div>

          <div className="form-group rs-photo-group">
            <label htmlFor="rs-after-photo">After photo (required)</label>
            <input
              id="rs-after-photo"
              type="file"
              accept="image/*"
              onChange={handlePhotoChange(setAfterPhoto)}
            />
            {afterPreview && (
              <img className="rs-preview" src={afterPreview} alt="After preview" />
            )}
          </div>
        </div>

        <button
          type="button"
          className={`submit-btn rs-submit ${submitting ? "loading" : ""}`}
          onClick={handleSubmit}
          disabled={submitting || !canSubmit}
        >
          {submitting ? "Submitting..." : "Submit for evaluation"}
        </button>
      </div>
    </div>
  );
}

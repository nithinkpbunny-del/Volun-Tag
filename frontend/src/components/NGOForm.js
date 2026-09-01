import { useState } from "react";
import "./NGOForm.css";

const CATEGORIES = [
  { value: "Education", icon: "📚", desc: "Teaching, tutoring, literacy" },
  { value: "Health", icon: "🏥", desc: "Medical, wellness, therapy" },
  { value: "Environment", icon: "🌿", desc: "Conservation, sustainability" },
  { value: "Animal Welfare", icon: "🐾", desc: "Rescue, shelter, veterinary" },
  { value: "Social Services", icon: "🤝", desc: "Community, outreach, support" },
];

const API_BASE = "http://127.0.0.1:8000";

export default function NGOForm({ showToast }) {
  const [form, setForm] = useState({ name: "", requirement: "", category: "", location: "", urgency: "medium" });
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(1);
  const [errors, setErrors] = useState({});

  const validate = () => {
    const errs = {};
    if (!form.name.trim()) errs.name = "Organization name is required";
    if (!form.category) errs.category = "Please select a category";
    if (!form.requirement.trim()) errs.requirement = "Describe your requirements";
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
      const res = await fetch(`${API_BASE}/add-ngo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || "Failed to register NGO");
      }

      showToast("🏛️ NGO registered successfully!");
      setForm({ name: "", requirement: "", category: "", location: "", urgency: "medium" });
      setStep(1);
      setErrors({});
    } catch (err) {
      showToast(err.message || "Backend not connected", "error");
    } finally {
      setLoading(false);
    }
  };

  const canProceed = step === 1 ? (form.name.trim() && form.category) : true;

  return (
    <div className="page form-page">
      <div className="form-card ngo-card">
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
          <div className="form-icon-wrap ngo-icon">🏛️</div>
          <h2 className="form-title">Register NGO</h2>
          <p className="form-subtitle">
            {step === 1 ? "Organization details" : "What volunteers do you need?"}
          </p>
        </div>

        {step === 1 && (
          <div className="form-step fade-in">
            <div className="form-group">
              <label htmlFor="ngo-name">Organization Name <span className="required">*</span></label>
              <input
                id="ngo-name"
                type="text"
                placeholder="e.g. GreenEarth Foundation"
                value={form.name}
                onChange={(e) => { setForm({ ...form, name: e.target.value }); setErrors({ ...errors, name: "" }); }}
                className={errors.name ? "input-error" : ""}
              />
              {errors.name && <span className="error-text">{errors.name}</span>}
            </div>

            <div className="form-group">
              <label>Category <span className="required">*</span></label>
              <div className="category-grid">
                {CATEGORIES.map((cat) => (
                  <button
                    key={cat.value}
                    className={`category-card ${form.category === cat.value ? "selected" : ""}`}
                    onClick={() => { setForm({ ...form, category: cat.value }); setErrors({ ...errors, category: "" }); }}
                    type="button"
                  >
                    <span className="category-icon">{cat.icon}</span>
                    <span className="category-name">{cat.value}</span>
                    <span className="category-desc">{cat.desc}</span>
                  </button>
                ))}
              </div>
              {errors.category && <span className="error-text">{errors.category}</span>}
            </div>

            <div className="form-group">
              <label htmlFor="ngo-location">Location</label>
              <input
                id="ngo-location"
                type="text"
                placeholder="e.g. Delhi, India"
                value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
              />
            </div>

            <button
              className="form-next-btn"
              onClick={() => {
                if (canProceed) setStep(2);
                else {
                  const errs = {};
                  if (!form.name.trim()) errs.name = "Organization name is required";
                  if (!form.category) errs.category = "Please select a category";
                  setErrors(errs);
                  showToast("Please fill required fields", "error");
                }
              }}
              id="ngo-next"
            >
              Next: Requirements →
            </button>
          </div>
        )}

        {step === 2 && (
          <div className="form-step fade-in">
            <div className="form-group">
              <label htmlFor="ngo-requirement">Volunteer Requirements <span className="required">*</span></label>
              <textarea
                id="ngo-requirement"
                placeholder="Describe the skills and qualities you're looking for in volunteers..."
                value={form.requirement}
                onChange={(e) => { setForm({ ...form, requirement: e.target.value }); setErrors({ ...errors, requirement: "" }); }}
                className={errors.requirement ? "input-error" : ""}
                rows={5}
              />
              {errors.requirement && <span className="error-text">{errors.requirement}</span>}
              <span className="form-hint">Be specific — the AI matches based on the meaning of your description</span>
            </div>

            <div className="form-group">
              <label htmlFor="ngo-urgency">Urgency Level</label>
              <div className="urgency-options">
                {["low", "medium", "high"].map((level) => (
                  <button
                    key={level}
                    className={`urgency-btn urgency-${level} ${form.urgency === level ? "selected" : ""}`}
                    onClick={() => setForm({ ...form, urgency: level })}
                    type="button"
                  >
                    <span className="urgency-dot" />
                    {level.charAt(0).toUpperCase() + level.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            <div className="form-actions">
              <button className="form-back-btn" onClick={() => setStep(1)}>
                ← Back
              </button>
              <button
                className={`submit-btn ${loading ? "loading" : ""}`}
                onClick={handleSubmit}
                disabled={loading}
                id="ngo-submit"
              >
                {loading ? "Registering..." : "Register NGO →"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

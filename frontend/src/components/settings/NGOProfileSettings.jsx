import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Badge, Icon, SkeletonList } from "../ui/ui";
import { ADDRESS_MAX, MOTTO_MAX, NGO_CATEGORIES, validateNgoProfile } from "../ngo/ngoFields";
import { PATHS } from "../../routes";
import { safeExternalUrl } from "../../safeUrl";
import { changedFields, getProfile, saveProfile } from "./settingsApi";
import { Field, SaveBar, SettingsCard, describedBy, useLeaveWarning } from "./SettingsParts";

const FIELDS = ["motto", "category", "location", "address", "contact_number", "website_url"];

const toForm = (profile) => ({
  motto: profile.motto || "",
  category: profile.category || "",
  location: profile.location || "",
  address: profile.address || "",
  contact_number: profile.contact_number || "",
  website_url: profile.website_url || "",
});

const statusTone = (status) =>
  status === "Approved" ? "success" : status === "Rejected" ? "danger" : "warning";

export default function NGOProfileSettings({ onSaved, showToast }) {
  const [profile, setProfile] = useState(null);
  const [saved, setSaved] = useState(null);
  const [form, setForm] = useState(null);
  const [errors, setErrors] = useState({});
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [saveError, setSaveError] = useState("");
  const [confirmingCategory, setConfirmingCategory] = useState(false);
  const confirmRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    getProfile("ngo")
      .then((data) => {
        if (cancelled) return;
        setProfile(data);
        setSaved(toForm(data));
        setForm(toForm(data));
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err.message);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (confirmingCategory && confirmRef.current) confirmRef.current.focus();
  }, [confirmingCategory]);

  const changes = form && saved ? changedFields(form, saved, FIELDS) : {};
  const dirty = Object.keys(changes).length > 0;
  useLeaveWarning(dirty);

  if (loadError) {
    return (
      <p className="ui-alert ui-alert--danger" role="alert">
        {loadError}
      </p>
    );
  }

  if (!form) return <SkeletonList count={2} label="Loading your organisation's profile" />;

  const update = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setStatus("");
    setSaveError("");
    if (field === "category") setConfirmingCategory(false);
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: "" }));
  };

  const discard = () => {
    setForm(saved);
    setErrors({});
    setSaveError("");
    setConfirmingCategory(false);
  };

  const save = async (categoryConfirmed) => {
    const errs = validateNgoProfile(form);
    setErrors(errs);
    if (Object.values(errs).some(Boolean)) {
      setSaveError("Please fix the highlighted fields.");
      return;
    }

    if ("category" in changes && !categoryConfirmed) {
      setConfirmingCategory(true);
      return;
    }

    setConfirmingCategory(false);
    setSaving(true);
    setSaveError("");

    try {
      const data = await saveProfile("ngo", changes);
      setProfile(data);
      setSaved(toForm(data));
      setForm(toForm(data));
      setStatus("saved");
      onSaved?.(data);
      showToast?.("Profile saved", "success");
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const submit = (e) => {
    e.preventDefault();
    if (dirty && !saving) save(false);
  };

  const website = safeExternalUrl(form.website_url);

  return (
    <form className="settings-form" onSubmit={submit} noValidate>
      <SettingsCard
        id="set-org"
        title="Organisation details"
        description="These details were checked when your NGO was approved. To change them, contact the VolunTag team."
        tone="readonly"
      >
        <dl className="settings-readonly">
          <div>
            <dt>Organisation name</dt>
            <dd>{profile.name}</dd>
          </div>
          <div>
            <dt>Approval</dt>
            <dd>
              <Badge tone={statusTone(profile.verification_status)} dot>
                {profile.verification_status}
              </Badge>
            </dd>
          </div>
          <div>
            <dt>Legal structure</dt>
            <dd>{profile.legal_structure || "—"}</dd>
          </div>
          <div>
            <dt>Year founded</dt>
            <dd>{profile.year_founded || "—"}</dd>
          </div>
          <div className="settings-readonly__wide">
            <dt>Documents on file</dt>
            <dd>
              {profile.documents.length > 0 ? (
                <ul className="settings-doc-list">
                  {profile.documents.map((doc) => (
                    <li key={doc.kind}>
                      <Icon name="check" size={14} />
                      {doc.label}
                    </li>
                  ))}
                </ul>
              ) : (
                "None uploaded"
              )}
            </dd>
          </div>
        </dl>
        <p className="settings-note">
          <Icon name="alert" size={15} />
          <span>
            Need to change your name or documents?{" "}
            <Link to={PATHS.contact}>Contact the admin</Link>. Editing the details below does not change your approval.
          </span>
        </p>
      </SettingsCard>

      <SettingsCard id="set-public" title="Public profile" description="Volunteers see this on your events and in the NGO list.">
        <Field
          id="set-motto"
          label="Mission / description"
          required
          error={errors.motto}
          hint={`Used to match your NGO with volunteers. ${form.motto.trim().length} / ${MOTTO_MAX} characters.`}
        >
          <textarea
            id="set-motto"
            className="ui-textarea"
            rows={4}
            maxLength={MOTTO_MAX}
            value={form.motto}
            onChange={(e) => update("motto", e.target.value)}
            {...describedBy("set-motto", errors.motto, true)}
          />
        </Field>

        <Field
          id="set-category"
          label="Cause category"
          required
          error={errors.category}
          hint="Decides which volunteers see your events."
        >
          <select
            id="set-category"
            className="ui-select"
            value={form.category}
            onChange={(e) => update("category", e.target.value)}
            {...describedBy("set-category", errors.category, true)}
          >
            <option value="">Select a category</option>
            {(saved.category && !NGO_CATEGORIES.includes(saved.category)
              ? [saved.category, ...NGO_CATEGORIES]
              : NGO_CATEGORIES
            ).map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </Field>

        {confirmingCategory && (
          <div
            className="ui-alert ui-alert--warning settings-confirm"
            role="alertdialog"
            aria-labelledby="set-category-confirm-title"
            aria-describedby="set-category-confirm-text"
            tabIndex={-1}
            ref={confirmRef}
          >
            <p className="settings-confirm__title" id="set-category-confirm-title">
              Change your category from {saved.category || "none"} to {form.category}?
            </p>
            <p id="set-category-confirm-text">
              Volunteers are matched to your events by category. After this change, your events are suggested to
              volunteers whose skills fit {form.category}, and some volunteers who see them today will stop seeing them.
            </p>
            <div className="settings-confirm__actions">
              <button type="button" className="ui-btn ui-btn--primary" onClick={() => save(true)} disabled={saving}>
                Change category and save
              </button>
              <button type="button" className="ui-btn" onClick={() => update("category", saved.category)}>
                Keep {saved.category || "the current category"}
              </button>
            </div>
          </div>
        )}

        <div className="settings-grid">
          <Field id="set-location" label="City / location" required error={errors.location}>
            <input
              id="set-location"
              className="ui-input"
              value={form.location}
              onChange={(e) => update("location", e.target.value)}
              autoComplete="address-level2"
              {...describedBy("set-location", errors.location)}
            />
          </Field>

          <Field id="set-contact_number" label="Phone" required error={errors.contact_number}>
            <input
              id="set-contact_number"
              className="ui-input"
              type="tel"
              autoComplete="tel"
              value={form.contact_number}
              onChange={(e) => update("contact_number", e.target.value)}
              {...describedBy("set-contact_number", errors.contact_number)}
            />
          </Field>
        </div>

        <Field id="set-address" label="Address" error={errors.address} hint="Optional.">
          <textarea
            id="set-address"
            className="ui-textarea settings-textarea--short"
            rows={2}
            maxLength={ADDRESS_MAX}
            value={form.address}
            onChange={(e) => update("address", e.target.value)}
            autoComplete="street-address"
            {...describedBy("set-address", errors.address, true)}
          />
        </Field>

        <Field
          id="set-website_url"
          label="Website"
          error={errors.website_url}
          hint="Optional. Must start with http:// or https:// (we add https:// to a bare domain)."
        >
          <input
            id="set-website_url"
            className="ui-input"
            type="url"
            inputMode="url"
            autoComplete="url"
            placeholder="https://example.org"
            value={form.website_url}
            onChange={(e) => update("website_url", e.target.value)}
            {...describedBy("set-website_url", errors.website_url, true)}
          />
        </Field>
        {website && !errors.website_url && (
          <p className="settings-muted settings-link-preview">
            Opens as{" "}
            <a href={safeExternalUrl(form.website_url)} target="_blank" rel="noopener noreferrer">
              {website}
            </a>
          </p>
        )}
      </SettingsCard>

      <SaveBar dirty={dirty} saving={saving} status={status} error={saveError} onDiscard={discard} />
    </form>
  );
}

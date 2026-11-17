import { useEffect, useState } from "react";
import { SkeletonList } from "../ui/ui";
import {
  AVAILABILITY_OPTIONS,
  BIO_MAX,
  CAUSE_OPTIONS,
  EXPERIENCE_OPTIONS,
  GENDER_OPTIONS,
  NAME_MAX,
  SKILL_SUGGESTIONS,
  hasSkill,
  toggleSkill,
  validateVolunteerProfile,
} from "../volunteer/volunteerFields";
import { changedFields, getProfile, saveProfile } from "./settingsApi";
import { Field, SaveBar, SettingsCard, describedBy, useLeaveWarning } from "./SettingsParts";

const FIELDS = [
  "name", "contact_number", "age", "gender", "designation", "location",
  "availability", "experience", "skills", "cause_interests", "bio",
];

// The fields the matching uses: saving them refreshes the event list.
const MATCHING_FIELDS = ["skills", "location"];

const toForm = (profile) => ({
  name: profile.name || "",
  contact_number: profile.contact_number || "",
  age: profile.age ? String(profile.age) : "",
  gender: profile.gender || "",
  designation: profile.designation || "",
  location: profile.location || "",
  availability: profile.availability || "",
  experience: profile.experience || "",
  skills: profile.skills || "",
  cause_interests: Array.isArray(profile.cause_interests) ? profile.cause_interests : [],
  bio: profile.bio || "",
});

// A stored value that is not one of the options is still offered, so
// opening Settings never changes it silently.
const withCurrent = (options, current) =>
  current && !options.includes(current) ? [current, ...options] : options;

export default function VolunteerProfileSettings({ onSaved, showToast }) {
  const [saved, setSaved] = useState(null);
  const [form, setForm] = useState(null);
  const [errors, setErrors] = useState({});
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    let cancelled = false;

    getProfile("volunteer")
      .then((data) => {
        if (cancelled) return;
        const initial = toForm(data);
        setSaved(initial);
        setForm(initial);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err.message);
      });

    return () => {
      cancelled = true;
    };
  }, []);

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

  if (!form) return <SkeletonList count={2} label="Loading your profile" />;

  const update = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setStatus("");
    setSaveError("");
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: "" }));
  };

  const toggleCause = (cause) =>
    update(
      "cause_interests",
      form.cause_interests.includes(cause)
        ? form.cause_interests.filter((c) => c !== cause)
        : CAUSE_OPTIONS.filter((c) => c === cause || form.cause_interests.includes(c))
    );

  const discard = () => {
    setForm(saved);
    setErrors({});
    setSaveError("");
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!dirty || saving) return;

    const errs = validateVolunteerProfile(form);
    setErrors(errs);
    if (Object.values(errs).some(Boolean)) {
      setSaveError("Please fix the highlighted fields.");
      return;
    }

    const body = { ...changes };
    if ("age" in body) body.age = Number(body.age);

    setSaving(true);
    setSaveError("");

    try {
      const data = await saveProfile("volunteer", body);
      const next = toForm(data);
      setSaved(next);
      setForm(next);
      setStatus("saved");
      onSaved?.(data, { matchingChanged: MATCHING_FIELDS.some((f) => f in body) });
      showToast?.("Profile saved", "success");
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const input = (field, props = {}) => (
    <input
      id={`set-${field}`}
      className="ui-input"
      value={form[field]}
      onChange={(e) => update(field, e.target.value)}
      {...describedBy(`set-${field}`, errors[field], props.hint)}
      {...props.attrs}
    />
  );

  return (
    <form className="settings-form" onSubmit={submit} noValidate>
      <SettingsCard id="set-about" title="About you" description="Shown to NGOs when you join their events.">
        <div className="settings-grid">
          <Field id="set-name" label="Full name" required error={errors.name}>
            {input("name", { attrs: { autoComplete: "name", maxLength: NAME_MAX } })}
          </Field>

          <Field id="set-contact_number" label="Phone" required error={errors.contact_number}>
            {input("contact_number", { attrs: { type: "tel", autoComplete: "tel" } })}
          </Field>

          <Field id="set-age" label="Age" required error={errors.age}>
            {input("age", { attrs: { type: "number", min: 1, max: 120, inputMode: "numeric" } })}
          </Field>

          <Field id="set-gender" label="Gender" required error={errors.gender}>
            <select
              id="set-gender"
              className="ui-select"
              value={form.gender}
              onChange={(e) => update("gender", e.target.value)}
              {...describedBy("set-gender", errors.gender)}
            >
              <option value="">Select</option>
              {withCurrent(GENDER_OPTIONS, saved.gender).map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </Field>

          <Field id="set-designation" label="Designation" required error={errors.designation} hint="For example Student or Teacher.">
            {input("designation", { hint: true })}
          </Field>

          <Field id="set-location" label="City / location" required error={errors.location} hint="Used to show events near you.">
            {input("location", { hint: true, attrs: { autoComplete: "address-level2" } })}
          </Field>
        </div>

        <Field
          id="set-bio"
          label="Short bio"
          error={errors.bio}
          hint={`Optional. ${form.bio.trim().length} / ${BIO_MAX} characters.`}
        >
          <textarea
            id="set-bio"
            className="ui-textarea"
            rows={4}
            value={form.bio}
            maxLength={BIO_MAX}
            onChange={(e) => update("bio", e.target.value)}
            {...describedBy("set-bio", errors.bio, true)}
          />
        </Field>
      </SettingsCard>

      <SettingsCard
        id="set-volunteering"
        title="How you volunteer"
        description="Your skills decide which events we suggest. Changes apply as soon as you save."
      >
        <Field
          id="set-skills"
          label="Skills"
          required
          error={errors.skills}
          hint="Tap a suggestion or type your own, separated by commas."
        >
          <div className="settings-chip-row" role="group" aria-label="Skill suggestions">
            {SKILL_SUGGESTIONS.map((skill) => {
              const on = hasSkill(form.skills, skill);
              return (
                <button
                  type="button"
                  key={skill}
                  className={`settings-chip ${on ? "settings-chip--on" : ""}`.trim()}
                  aria-pressed={on}
                  onClick={() => update("skills", toggleSkill(form.skills, skill))}
                >
                  {skill}
                </button>
              );
            })}
          </div>
          <textarea
            id="set-skills"
            className="ui-textarea settings-textarea--short"
            rows={2}
            value={form.skills}
            onChange={(e) => update("skills", e.target.value)}
            {...describedBy("set-skills", errors.skills, true)}
          />
        </Field>

        <fieldset className="settings-fieldset">
          <legend className="ui-label">Causes you care about</legend>
          <p className="ui-hint">Optional. Shown on your profile; it does not change which events you see.</p>
          <div className="settings-chip-row">
            {CAUSE_OPTIONS.map((cause) => {
              const on = form.cause_interests.includes(cause);
              return (
                <label key={cause} className={`settings-chip settings-chip--check ${on ? "settings-chip--on" : ""}`.trim()}>
                  <input type="checkbox" checked={on} onChange={() => toggleCause(cause)} />
                  {cause}
                </label>
              );
            })}
          </div>
        </fieldset>

        <div className="settings-grid">
          <Field id="set-availability" label="Availability" required error={errors.availability}>
            <select
              id="set-availability"
              className="ui-select"
              value={form.availability}
              onChange={(e) => update("availability", e.target.value)}
              {...describedBy("set-availability", errors.availability)}
            >
              <option value="">Select availability</option>
              {withCurrent(AVAILABILITY_OPTIONS, saved.availability).map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </Field>

          <Field id="set-experience" label="Experience">
            <select
              id="set-experience"
              className="ui-select"
              value={form.experience}
              onChange={(e) => update("experience", e.target.value)}
            >
              <option value="">Not set</option>
              {withCurrent(EXPERIENCE_OPTIONS, saved.experience).map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </SettingsCard>

      <SaveBar dirty={dirty} saving={saving} status={status} error={saveError} onDiscard={discard} />
    </form>
  );
}

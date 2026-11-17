// The Settings tab of the volunteer and NGO dashboards
// (/volunteer/dashboard?tab=settings, /ngo/dashboard?tab=settings).
// The open section is kept in the address too (&section=security), so a
// link or a reload lands on the same section.
import { useSearchParams } from "react-router-dom";
import DataSettings from "./DataSettings";
import DeactivateSettings from "./DeactivateSettings";
import EmailSettings from "./EmailSettings";
import NGOProfileSettings from "./NGOProfileSettings";
import SecuritySettings from "./SecuritySettings";
import VolunteerProfileSettings from "./VolunteerProfileSettings";
import "./Settings.css";

export const SETTINGS_SECTIONS = [
  { id: "profile", label: "Profile", hint: "Your details and how you are matched" },
  { id: "security", label: "Security", hint: "Password and where you are logged in" },
  { id: "email", label: "Email", hint: "The address you log in with" },
  { id: "data", label: "Your data", hint: "Download a copy of your data" },
  { id: "account", label: "Account", hint: "Deactivate your account" },
];

const DEFAULT_SECTION = "profile";

export default function AccountSettings({
  role,
  email,
  showToast,
  onProfileSaved,
  onDeactivated,
  onOpenEvents,
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get("section");
  const section = SETTINGS_SECTIONS.some((s) => s.id === requested) ? requested : DEFAULT_SECTION;
  const current = SETTINGS_SECTIONS.find((s) => s.id === section);

  const open = (id) => {
    if (id === section) return;
    const params = { tab: "settings" };
    if (id !== DEFAULT_SECTION) params.section = id;
    setSearchParams(params, { replace: true });
  };

  return (
    <div className="settings-layout">
      <nav className="settings-nav" aria-label="Settings sections">
        <h2 className="settings-nav__title">Settings</h2>
        <ul className="settings-nav__list">
          {SETTINGS_SECTIONS.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className={`settings-nav__item ${s.id === section ? "settings-nav__item--active" : ""}`.trim()}
                aria-current={s.id === section ? "true" : undefined}
                onClick={() => open(s.id)}
              >
                <span className="settings-nav__label">{s.label}</span>
                <span className="settings-nav__hint">{s.hint}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div className="settings-panel">
        <div className="settings-panel__head">
          <h2 className="settings-panel__title">{current.label}</h2>
          <p className="settings-panel__sub">{current.hint}</p>
        </div>

        {section === "profile" &&
          (role === "ngo" ? (
            <NGOProfileSettings showToast={showToast} onSaved={onProfileSaved} />
          ) : (
            <VolunteerProfileSettings showToast={showToast} onSaved={onProfileSaved} />
          ))}

        {section === "security" && <SecuritySettings />}

        {section === "email" && <EmailSettings currentEmail={email} />}

        {section === "data" && <DataSettings role={role} />}

        {section === "account" && (
          <DeactivateSettings role={role} onDeactivated={onDeactivated} onOpenEvents={onOpenEvents} />
        )}
      </div>
    </div>
  );
}

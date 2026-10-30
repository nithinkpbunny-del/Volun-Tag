import { useCallback, useEffect, useState } from "react";
import AdminAuditLog from "./AdminAuditLog";
import AdminNGOs from "./AdminNGOs";
import AdminOverview from "./AdminOverview";
import AdminProofs from "./AdminProofs";
import AdminVolunteers from "./AdminVolunteers";
import { PENDING_STATUS, adminFetch, useVisibleInterval } from "./adminApi";

// The first item is the landing page.
// `badge` names a key of the badges object built below.
const NAV_ITEMS = [
  {
    id: "overview",
    label: "Overview",
    icon: "◫",
    component: AdminOverview,
  },
  {
    id: "proofs",
    label: "Proof reviews",
    icon: "✓",
    badge: "pendingProofs",
    component: AdminProofs,
  },
  {
    id: "ngos",
    label: "NGOs",
    icon: "⌂",
    component: AdminNGOs,
  },
  {
    id: "volunteers",
    label: "Volunteers",
    icon: "☺",
    component: AdminVolunteers,
  },
  {
    id: "audit",
    label: "Audit log",
    icon: "≡",
    component: AdminAuditLog,
  },
];

export default function AdminLayout({ showToast, onLogout }) {
  const [activeId, setActiveId] = useState(NAV_ITEMS[0].id);
  const [pendingProofs, setPendingProofs] = useState(null);
  const [loggingOut, setLoggingOut] = useState(false);

  const refreshBadges = useCallback(async () => {
    try {
      const pending = await adminFetch(
        `/admin/resolutions?status=${encodeURIComponent(PENDING_STATUS)}`
      );
      setPendingProofs(Array.isArray(pending) ? pending.length : 0);
    } catch {
      // Badges refresh silently; the next tick tries again.
    }
  }, []);

  useEffect(() => {
    refreshBadges();
  }, [refreshBadges]);

  useVisibleInterval(refreshBadges);

  const handleLogout = async () => {
    setLoggingOut(true);
    await onLogout();
  };

  const badges = { pendingProofs };
  const active = NAV_ITEMS.find((item) => item.id === activeId) || NAV_ITEMS[0];
  const ActivePage = active.component;

  return (
    <div className="adm-shell">
      <aside className="adm-sidebar">
        <div className="adm-sidebar-brand">
          <span className="adm-wordmark">
            Volun<span className="adm-wordmark-accent">Tag</span>
          </span>
          <span className="adm-brand-label">Admin</span>
        </div>

        <nav className="adm-nav" aria-label="Admin sections">
          {NAV_ITEMS.map((item) => {
            const count = item.badge ? badges[item.badge] : null;
            const isActive = item.id === active.id;

            return (
              <button
                key={item.id}
                type="button"
                className={`adm-nav-item${isActive ? " adm-nav-item--active" : ""}`}
                aria-current={isActive ? "page" : undefined}
                onClick={() => setActiveId(item.id)}
              >
                <span className="adm-nav-icon" aria-hidden="true">{item.icon}</span>
                <span className="adm-nav-label">{item.label}</span>
                {count > 0 && (
                  <span className="adm-nav-badge" aria-label={`${count} pending`}>
                    {count > 99 ? "99+" : count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <button
          type="button"
          className="adm-logout"
          onClick={handleLogout}
          disabled={loggingOut}
        >
          {loggingOut ? "Logging out…" : "Log out"}
        </button>
      </aside>

      <main className="adm-main">
        <ActivePage
          showToast={showToast}
          onDataChanged={refreshBadges}
          onNavigate={setActiveId}
        />
      </main>
    </div>
  );
}

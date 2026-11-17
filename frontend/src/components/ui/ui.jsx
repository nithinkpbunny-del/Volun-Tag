// Shared building blocks of the VolunTag design system. The styles live in
// src/theme.css (classes starting with "ui-").
import { useEffect, useId, useRef, useState } from "react";

// ─── Icons ───────────────────────────────────────────────────────
// Small line icons, drawn with the text colour. Decorative by default.
const ICON_PATHS = {
  calendar: (
    <>
      <rect x="3" y="4.5" width="18" height="16.5" rx="2.5" />
      <path d="M3 9.5h18" />
      <path d="M8 2.5v4" />
      <path d="M16 2.5v4" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21.5s7-5.6 7-11.5a7 7 0 1 0-14 0c0 5.900 7 11.5 7 11.500Z" />
      <circle cx="12" cy="10" r="2.6" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.500 6.500 0 0 1 13 0" />
      <path d="M16 4.700a3.500 3.500 0 0 1 0 6.600" />
      <path d="M18 14.200a6.500 6.500 0 0 1 3.500 5.800" />
    </>
  ),
  chat: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
  more: (
    <>
      <circle cx="5" cy="12" r="1.4" />
      <circle cx="12" cy="12" r="1.4" />
      <circle cx="19" cy="12" r="1.4" />
    </>
  ),
  plus: (
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>
  ),
  check: <path d="m5 12.500 4.500 4.500L19 7.500" />,
  close: (
    <>
      <path d="M6 6l12 12" />
      <path d="M18 6 6 18" />
    </>
  ),
  star: <path d="m12 3.500 2.600 5.400 5.900.800-4.300 4.100 1 5.900L12 16.900l-5.200 2.800 1-5.900-4.300-4.100 5.900-.800L12 3.500Z" />,
  alert: (
    <>
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
      <path d="M10.300 3.900 1.800 18a1.500 1.500 0 0 0 1.300 2.250h17.800a1.500 1.500 0 0 0 1.300-2.250L13.700 3.900a1.500 1.500 0 0 0-2.400 0Z" />
    </>
  ),
  inbox: (
    <>
      <path d="M3 13.500 5.800 5.600A2 2 0 0 1 7.700 4.300h8.600a2 2 0 0 1 1.900 1.300L21 13.500V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4.500Z" />
      <path d="M3 13.500h5l1.500 2.500h5l1.500-2.500h5" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.500" />
      <path d="m20 20-4.200-4.200" />
    </>
  ),
  spark: (
    <>
      <path d="M12 3v4" />
      <path d="M12 17v4" />
      <path d="M3 12h4" />
      <path d="M17 12h4" />
      <path d="m6 6 2.500 2.500" />
      <path d="m15.500 15.500 2.500 2.500" />
      <path d="m18 6-2.500 2.500" />
      <path d="M8.500 15.500 6 18" />
    </>
  ),
  arrowLeft: (
    <>
      <path d="M19 12H5" />
      <path d="m11 6-6 6 6 6" />
    </>
  ),
  edit: (
    <>
      <path d="M4 20h4L19 9l-4-4L4 16v4Z" />
      <path d="m13.500 6.500 4 4" />
    </>
  ),
  flag: (
    <>
      <path d="M5 21V4" />
      <path d="M5 4h11l-1.500 4L16 12H5" />
    </>
  ),
};

export function Icon({ name, size = 16, className = "" }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {ICON_PATHS[name]}
    </svg>
  );
}

// ─── Badge ───────────────────────────────────────────────────────
/** A status label. tone: neutral | success | warning | danger | info | clay | solid. */
export function Badge({ tone = "neutral", dot = false, className = "", children }) {
  return (
    <span className={`ui-badge ui-badge--${tone} ${className}`.trim()}>
      {dot && <span className="ui-badge__dot" aria-hidden="true" />}
      {children}
    </span>
  );
}

// ─── Chips ───────────────────────────────────────────────────────
/** "a, b, c" (or an array) as a wrapping row of chips. Shows at most `max`, then "+n". */
export function Chips({ items, max = 0, label = "Skills", className = "" }) {
  const list = (Array.isArray(items) ? items : String(items || "").split(","))
    .map((item) => String(item).trim())
    .filter(Boolean);

  if (list.length === 0) return null;

  const shown = max > 0 ? list.slice(0, max) : list;
  const hidden = list.length - shown.length;

  return (
    <ul className={`ui-chips ${className}`.trim()} aria-label={label}>
      {shown.map((item) => (
        <li className="ui-chip" key={item}>
          {item}
        </li>
      ))}
      {hidden > 0 && (
        <li className="ui-chip" title={list.slice(shown.length).join(", ")}>
          +{hidden} more
        </li>
      )}
    </ul>
  );
}

// ─── Empty state ─────────────────────────────────────────────────
/** An icon, one sentence and (optionally) one action, for an empty list. */
export function EmptyState({ icon = "inbox", title, children, action }) {
  return (
    <div className="ui-empty">
      <span className="ui-empty__icon">
        <Icon name={icon} size={22} />
      </span>
      <p className="ui-empty__title">{title}</p>
      {children && <p className="ui-empty__text">{children}</p>}
      {action && <div className="ui-empty__action">{action}</div>}
    </div>
  );
}

// ─── Skeleton loaders ────────────────────────────────────────────
/** Grey placeholder cards shown while a list loads. `label` is read to screen readers. */
export function SkeletonList({ count = 3, label = "Loading", className = "" }) {
  return (
    <div className={`ui-skeleton-list ${className}`.trim()} role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      {Array.from({ length: count }, (_, index) => (
        <div className="ui-skeleton-card" key={index} aria-hidden="true">
          <span className="ui-skeleton" style={{ width: "46%", height: 18 }} />
          <span className="ui-skeleton" style={{ width: "72%" }} />
          <span className="ui-skeleton" style={{ width: "34%" }} />
        </div>
      ))}
    </div>
  );
}

// ─── Progress ────────────────────────────────────────────────────
/**
 * "value of total" with a bar. Without a total (no limit) only the text row
 * is shown. `label` is the left text, `detail` the right text.
 */
export function Progress({ value, total, label, detail, tone = "" }) {
  const hasTotal = Number.isFinite(total) && total > 0;
  const percent = hasTotal ? Math.max(0, Math.min(100, (value / total) * 100)) : 0;
  const full = hasTotal && value >= total;
  const toneClass = tone ? `ui-progress--${tone}` : full ? "ui-progress--full" : "";

  return (
    <div className={`ui-progress ${toneClass}`.trim()}>
      <div className="ui-progress__row">
        <span>{label}</span>
        {detail && <span>{detail}</span>}
      </div>
      {hasTotal && (
        <div
          className="ui-progress__track"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={Math.min(value, total)}
          aria-label={typeof label === "string" ? label : undefined}
        >
          <div className="ui-progress__bar" style={{ width: `${percent}%` }} />
        </div>
      )}
    </div>
  );
}

// ─── Action menu ─────────────────────────────────────────────────
/**
 * A "More" button that opens a small menu of secondary actions.
 * items: [{ label, onSelect, danger, disabled, note }] (falsy entries are skipped).
 * Closes on Escape, on a click outside and after choosing an item; the arrow
 * keys move between items.
 */
export function ActionMenu({ label = "More actions", items, direction = "up", buttonClassName = "" }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const listRef = useRef(null);
  const menuId = useId();
  const entries = (items || []).filter(Boolean);

  useEffect(() => {
    if (!open) return undefined;

    const onPointerDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        setOpen(false);
        if (buttonRef.current) buttonRef.current.focus();
      }
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    document.addEventListener("keydown", onKeyDown);

    // Focus the first usable item.
    const first = listRef.current && listRef.current.querySelector("button:not(:disabled)");
    if (first) first.focus();

    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (entries.length === 0) return null;

  const onListKeyDown = (e) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;

    const buttons = Array.from(listRef.current.querySelectorAll("button:not(:disabled)"));
    if (buttons.length === 0) return;

    e.preventDefault();
    const index = buttons.indexOf(document.activeElement);
    let next = 0;
    if (e.key === "ArrowDown") next = (index + 1) % buttons.length;
    else if (e.key === "ArrowUp") next = (index - 1 + buttons.length) % buttons.length;
    else if (e.key === "End") next = buttons.length - 1;
    buttons[next].focus();
  };

  return (
    <div className={`ui-menu ${direction === "down" ? "ui-menu--down" : ""}`.trim()} ref={rootRef}>
      <button
        type="button"
        ref={buttonRef}
        className={`ui-btn ui-btn--icon ${buttonClassName}`.trim()}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        title={label}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="more" size={18} />
      </button>

      {open && (
        <ul className="ui-menu__list" id={menuId} role="menu" ref={listRef} onKeyDown={onListKeyDown}>
          {entries.map((item) => (
            <li role="none" key={item.label}>
              <button
                type="button"
                role="menuitem"
                className={`ui-menu__item ${item.danger ? "ui-menu__item--danger" : ""}`.trim()}
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
              >
                <span>
                  {item.label}
                  {item.note && <span className="ui-menu__note">{item.note}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

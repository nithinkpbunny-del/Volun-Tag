import PhaseBadge from "../PhaseBadge";
import { ActionMenu, Badge, Chips, Icon, Progress } from "../ui/ui";
import { formatEventDay, isCompletedPhase, isOpenPhase } from "../../dates";

const STATUS_TONES = {
  Active: "neutral",
  Filled: "info",
  Cancelled: "danger",
};

/**
 * One event on the NGO dashboard, as a card: title, date and phase, status,
 * approved-of-total spots, skills, one primary action and a menu with the
 * secondary ones (edit, filled, reopen, cancel).
 *
 * While the event is being edited the card shows `editForm` instead.
 * The rules for which action is offered are the server's (phase and status);
 * this component only lays them out.
 */
export default function EventCard({
  event: ev,
  isNew = false,
  editForm = null,
  onManage,
  onEdit,
  onMarkFilled,
  onReopen,
  onCancel,
}) {
  const status = ev.status || "Active";
  const cancelled = status === "Cancelled";
  const completed = isCompletedPhase(ev.phase) && !cancelled;
  const open = isOpenPhase(ev.phase);
  const approved = ev.approved_count || 0;
  const joined = ev.joined_count || 0;
  const waiting = Math.max(joined - approved, 0);
  const hasLimit = ev.spots_available != null;
  const spotsFull = hasLimit && approved >= ev.spots_available;
  const titleId = `event-card-title-${ev.id}`;

  if (editForm) {
    return (
      <article className="event-card event-card--editing" data-event-card aria-labelledby={titleId}>
        <h3 className="event-card__title" id={titleId}>
          Edit “{ev.title}”
        </h3>
        {editForm}
      </article>
    );
  }

  const menuItems = [
    status === "Active" && !completed && onEdit && { label: "Edit event", onSelect: onEdit },
    status === "Active" &&
      !completed &&
      onMarkFilled && {
        label: "Mark as filled",
        note: spotsFull
          ? "Stops showing the event to volunteers"
          : "Available once every spot is approved",
        disabled: !spotsFull,
        onSelect: onMarkFilled,
      },
    // Reopening is refused once the event day has started.
    status === "Filled" && open && onReopen && { label: "Reopen event", onSelect: onReopen },
    status === "Active" &&
      !completed &&
      onCancel && { label: "Cancel event", danger: true, onSelect: onCancel },
  ];

  let primaryLabel = "Manage volunteers";
  if (cancelled) primaryLabel = "View volunteers";
  else if (completed) primaryLabel = ev.feedback_count < approved ? "Rate volunteers" : "View feedback";

  // A completed event without approved volunteers has nobody to rate.
  const showPrimary = !completed || approved > 0;

  return (
    <article
      className={[
        "event-card",
        isNew ? "event-card--new" : "",
        cancelled ? "event-card--cancelled" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      data-event-card
      aria-labelledby={titleId}
    >
      <header className="event-card__head">
        <h3 className="event-card__title" id={titleId}>
          {ev.title}
        </h3>
        <div className="event-card__badges">
          {isNew && <Badge tone="solid">New</Badge>}
          {!cancelled && <PhaseBadge phase={ev.phase} />}
          {/* "Active" says nothing once the event is over. */}
          {!(completed && status === "Active") && (
            <Badge tone={STATUS_TONES[status] || "neutral"} dot={status === "Active"}>
              {status}
            </Badge>
          )}
        </div>
      </header>

      <ul className="event-card__meta">
        <li>
          <Icon name="calendar" />
          <span>{formatEventDay(ev.event_day)}</span>
        </li>
        <li>
          <Icon name="pin" />
          <span>{ev.location || "No location"}</span>
        </li>
      </ul>

      {ev.description && <p className="event-card__desc">{ev.description}</p>}

      <Chips items={ev.required_skills} max={4} label="Required skills" />

      <div className="event-card__progress">
        {completed ? (
          approved === 0 ? (
            <p className="event-card__note">No approved volunteers</p>
          ) : (
            <Progress
              value={ev.feedback_count || 0}
              total={approved}
              tone={ev.feedback_count >= approved ? "" : "muted"}
              label={
                <>
                  Feedback given: <strong>{ev.feedback_count || 0} of {approved}</strong>
                </>
              }
            />
          )
        ) : hasLimit ? (
          <Progress
            value={approved}
            total={ev.spots_available}
            label={
              <>
                <strong>
                  {approved} of {ev.spots_available}
                </strong>{" "}
                spots approved
              </>
            }
            detail={`${waiting} waiting`}
          />
        ) : (
          <Progress
            value={approved}
            label={
              <>
                <strong>{approved}</strong> approved · no spot limit
              </>
            }
            detail={`${waiting} waiting`}
          />
        )}
      </div>

      <footer className="event-card__actions">
        {showPrimary && (
          <button
            type="button"
            className={`ui-btn ${cancelled ? "" : "ui-btn--primary"} event-card__primary`}
            onClick={onManage}
          >
            <Icon name={completed ? "star" : "users"} />
            {primaryLabel}
            {!completed && !cancelled && open && waiting > 0 && (
              <span className="ui-btn__count" aria-label={`${waiting} waiting for approval`}>
                {waiting}
              </span>
            )}
          </button>
        )}
        <ActionMenu label={`More actions for ${ev.title}`} items={menuItems} />
      </footer>
    </article>
  );
}

import { phaseLabel } from "../dates";
import "./PhaseBadge.css";

/**
 * The server-computed phase of an event as a small badge:
 * "Registration open", "Happening today" or "Completed".
 * Renders nothing for a missing or unknown phase.
 */
export default function PhaseBadge({ phase, className = "" }) {
  const label = phaseLabel(phase);

  if (!label) return null;

  return (
    <span className={`phase-badge phase-badge--${phase.replace(/_/g, "-")} ${className}`.trim()}>
      {label}
    </span>
  );
}

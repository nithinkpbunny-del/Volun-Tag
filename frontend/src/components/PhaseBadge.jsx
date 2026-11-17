import { phaseLabel } from "../dates";
import { Badge } from "./ui/ui";

const PHASE_TONES = {
  open: "success",
  in_progress: "clay",
  completed: "neutral",
};

/**
 * The server-computed phase of an event as a badge:
 * "Registration open", "Happening today" or "Completed".
 * Renders nothing for a missing or unknown phase.
 */
export default function PhaseBadge({ phase, className = "" }) {
  const label = phaseLabel(phase);

  if (!label) return null;

  return (
    <Badge tone={PHASE_TONES[phase]} className={className}>
      {label}
    </Badge>
  );
}

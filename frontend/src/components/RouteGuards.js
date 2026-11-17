import { Navigate } from "react-router-dom";
import { PATHS } from "../routes";

/**
 * Shows its children only when the logged-in role is the one the screen needs
 * ("volunteer" or "ngo"). Anyone else (logged out, or the other role) is sent
 * to the login screen, replacing the history entry so Back does not return to
 * the screen that turned them away. A logged-in user who lands on the login
 * screen is then forwarded to their own dashboard.
 *
 * Routes are only rendered once the stored login has been checked, so this
 * never runs before the role is known.
 */
export function RequireRole({ role, currentRole, children }) {
  if (currentRole === role) {
    return children;
  }

  return <Navigate to={PATHS["dashboard-login"]} replace />;
}

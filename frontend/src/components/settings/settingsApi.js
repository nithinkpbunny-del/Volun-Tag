// Calls behind the Settings tab. Every one uses the login token (authFetch),
// so it can only ever read or change the logged-in account.
import { API_BASE } from "../../config";
import { authFetch, errorText, getSession } from "../../api";
import { safeBlobUrl } from "../../safeUrl";

async function call(path, { method = "GET", body, fallback = "Something went wrong. Please try again." } = {}) {
  let res;

  try {
    res = await authFetch(`${API_BASE}${path}`, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error("Could not reach VolunTag. Check your connection and try again.");
  }

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const err = new Error(
      res.status === 401 ? "Your session has ended. Please log in again." : errorText(data, fallback)
    );
    err.status = res.status;
    err.code = typeof data.code === "string" ? data.code : "";
    err.data = data;
    throw err;
  }

  return data;
}

const profilePath = (role) => (role === "ngo" ? "/ngo/me" : "/volunteer/me");

export const getProfile = (role) =>
  call(profilePath(role), { fallback: "Could not load your profile." });

/** Send only the fields that changed. Resolves to the saved profile. */
export const saveProfile = (role, changes) =>
  call(profilePath(role), { method: "PATCH", body: changes, fallback: "Could not save your changes." });

export const changePassword = (currentPassword, newPassword) =>
  call("/account/password", {
    method: "POST",
    body: { current_password: currentPassword, new_password: newPassword },
    fallback: "Could not change your password.",
  });

export const listSessions = () => call("/account/sessions", { fallback: "Could not load your sessions." });

export const logoutOtherSessions = () =>
  call("/account/sessions/logout-others", { method: "POST", fallback: "Could not log out the other sessions." });

export const requestEmailChange = (password, newEmail) =>
  call("/account/email", {
    method: "POST",
    body: { password, new_email: newEmail },
    fallback: "Could not send the confirmation link.",
  });

export const deactivateAccount = (password, confirm) =>
  call("/account/deactivate", {
    method: "POST",
    body: { password, confirm },
    fallback: "Could not deactivate the account.",
  });

/**
 * Confirm a new email with the token from the link. Sent with the login
 * token when this browser has one, so that session stays logged in.
 * Resolves to {status: "changed", role, email, kept_session} or
 * {status: "expired" | "used" | "invalid" | "unavailable" | "error", message}.
 */
export async function confirmEmailChange(token) {
  const session = getSession();
  let res;
  let data = {};

  try {
    res = await fetch(`${API_BASE}/confirm-email-change`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(session ? { Authorization: `Bearer ${session.token}` } : {}),
      },
      body: JSON.stringify({ token }),
    });
    data = await res.json().catch(() => ({}));
  } catch {
    return { status: "error", message: "Could not reach VolunTag. Check your connection and try again." };
  }

  if (res.ok) {
    return {
      status: "changed",
      role: data.role === "ngo" ? "ngo" : "volunteer",
      email: String(data.email || ""),
      keptSession: Boolean(data.kept_session),
    };
  }

  const byCode = {
    email_change_link_expired: "expired",
    email_change_link_used: "used",
    email_change_link_invalid: "invalid",
    email_change_unavailable: "unavailable",
  };
  const status = byCode[data.code] || (res.status === 400 ? "invalid" : "error");
  return { status, message: errorText(data, "Could not check the link. Please try again.") };
}

/** Download the account's data as a JSON file (password required). */
export async function downloadMyData(password) {
  let res;
  try {
    res = await authFetch(`${API_BASE}/account/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
  } catch {
    throw new Error("Could not reach VolunTag. Check your connection and try again.");
  }

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const err = new Error(
      res.status === 401 ? "Your session has ended. Please log in again." : errorText(data, "Could not prepare your data.")
    );
    err.status = res.status;
    throw err;
  }

  const disposition = res.headers.get("Content-Disposition") || "";
  const match = /filename="([A-Za-z0-9._-]+)"/.exec(disposition);
  const filename = match ? match[1] : "voluntag-data.json";

  const url = URL.createObjectURL(await res.blob());
  const link = document.createElement("a");
  link.href = safeBlobUrl(url);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60 * 1000);
  return filename;
}

/** The fields of `form` whose value differs from `saved` (compared as trimmed text or as lists). */
export function changedFields(form, saved, fields) {
  const out = {};

  for (const field of fields) {
    const now = form[field];
    const before = saved[field];
    const same = Array.isArray(now)
      ? JSON.stringify(now) === JSON.stringify(before || [])
      : String(now ?? "").trim() === String(before ?? "").trim();

    if (!same) out[field] = Array.isArray(now) ? now : typeof now === "string" ? now.trim() : now;
  }

  return out;
}

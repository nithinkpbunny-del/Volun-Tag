import { useEffect, useRef } from "react";

export const API_BASE = "http://127.0.0.1:8000";

const TOKEN_KEY = "voluntag_admin_token";

export const REFRESH_MS = 10000;

// ─── Token storage (sessionStorage can throw in private modes) ─────
// The in-memory copy keeps the console working when storage is blocked;
// the session then only lasts until the page is reloaded.
let memoryToken = "";

export function getToken() {
  try {
    return sessionStorage.getItem(TOKEN_KEY) || memoryToken;
  } catch {
    return memoryToken;
  }
}

export function setToken(token) {
  memoryToken = token;
  try {
    sessionStorage.setItem(TOKEN_KEY, token);
  } catch {
    // memoryToken still holds it.
  }
}

export function clearToken() {
  memoryToken = "";
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // Nothing stored, nothing to clear.
  }
}

// ─── Session-ended callback ────────────────────────────────────────
let onUnauthorized = null;

export function setOnUnauthorized(callback) {
  onUnauthorized = callback;
}

function handleUnauthorized() {
  clearToken();
  if (onUnauthorized) onUnauthorized();
}

export class AdminApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function errorFrom(res) {
  let detail = "";
  try {
    const data = await res.json();
    detail = typeof data.detail === "string" ? data.detail : "";
  } catch {
    detail = "";
  }
  return new AdminApiError(detail || `Request failed (${res.status})`, res.status);
}

async function authorizedFetch(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  } catch {
    throw new AdminApiError("Unable to connect to the VolunTag server", 0);
  }

  if (res.status === 401) {
    handleUnauthorized();
    throw new AdminApiError("Your admin session has ended", 401);
  }

  if (!res.ok) throw await errorFrom(res);

  return res;
}

/** Call an admin JSON endpoint with the bearer token; returns parsed JSON. */
export async function adminFetch(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  const res = await authorizedFetch(path, { ...options, headers });
  return res.json();
}

/** Fetch a protected file and return a blob object URL. Callers must revoke it. */
export async function fetchFileUrl(path) {
  const res = await authorizedFetch(path);
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

// ─── Read-only platform views ──────────────────────────────────────
export function getOverview() {
  return adminFetch("/admin/overview");
}

export function getNGOs(search = "", status = "") {
  return adminFetch(
    `/admin/ngos?search=${encodeURIComponent(search)}&status=${encodeURIComponent(status)}`
  );
}

export function getNGO(id) {
  return adminFetch(`/admin/ngos/${encodeURIComponent(id)}`);
}

/** Fetch one NGO registration document or work photo; returns { blob, contentType }. */
export async function getNGODocumentBlob(id, key) {
  const res = await authorizedFetch(
    `/admin/ngos/${encodeURIComponent(id)}/documents/${encodeURIComponent(key)}`
  );
  const blob = await res.blob();
  return { blob, contentType: res.headers.get("Content-Type") || blob.type || "" };
}

export function getEvent(id) {
  return adminFetch(`/admin/events/${encodeURIComponent(id)}`);
}

/** Every call writes an audit row on the server, so call it once per deliberate view. */
export function getConversation(a, b) {
  return adminFetch(
    `/admin/conversation?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`
  );
}

/** Exchange the password for a token. Not routed through adminFetch: a 401 here is a wrong password. */
export async function loginRequest(password) {
  let res;
  try {
    res = await fetch(`${API_BASE}/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
  } catch {
    throw new AdminApiError("Unable to connect to the VolunTag server", 0);
  }

  if (!res.ok) throw await errorFrom(res);

  return res.json();
}

// ─── Dates ─────────────────────────────────────────────────────────
const IST_DATE = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "numeric",
  month: "short",
  year: "numeric",
});

const IST_DATE_TIME = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

/**
 * Format a backend datetime in IST. The backend sends naive UTC strings
 * (no "Z"), so a "Z" is appended when no timezone is present.
 */
export function formatIST(value, { time = true } = {}) {
  if (!value) return "—";

  const text = String(value);
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/i.test(text);
  const date = new Date(hasZone ? text : `${text}Z`);

  if (Number.isNaN(date.getTime())) return "—";

  return time ? `${IST_DATE_TIME.format(date)} IST` : IST_DATE.format(date);
}

// ─── Silent polling ────────────────────────────────────────────────
/**
 * Run callback every intervalMs (default REFRESH_MS) while the tab is visible,
 * and once when the tab becomes visible again. Pass enabled=false to pause.
 */
export function useVisibleInterval(callback, enabled = true, intervalMs = REFRESH_MS) {
  const saved = useRef(callback);

  useEffect(() => {
    saved.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!enabled) return undefined;

    const tick = () => {
      if (document.visibilityState === "visible") saved.current();
    };

    const id = setInterval(tick, intervalMs);
    document.addEventListener("visibilitychange", tick);

    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [enabled, intervalMs]);
}

/** Text for a nullable value: "Not provided" (or the given fallback) when empty. */
export function orNotProvided(value, fallback = "Not provided") {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text ? text : fallback;
}

// ─── Status helpers ────────────────────────────────────────────────
export const PENDING_STATUS = "Under evaluation";

/** Pill colour for proof, issue and NGO verification statuses. */
export function statusModifier(status) {
  switch (status) {
    case "Under evaluation":
    case "Pending":
      return "pending";
    case "Approved":
    case "Resolved":
      return "approved";
    case "Rejected":
      return "rejected";
    default:
      return "closed";
  }
}

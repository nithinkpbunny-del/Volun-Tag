// Backend address used by every API call, image and file link.
// Set REACT_APP_API_BASE when building (see frontend/.env.example);
// without it the app talks to the local backend.
export const API_BASE = process.env.REACT_APP_API_BASE || "http://127.0.0.1:8000";

/**
 * Central API client. Everything that talks to the backend goes through
 * here so the API base URL and auth headers live in one place.
 *
 *   In dev:  VITE_API_BASE_URL is "" → relative URLs hit Vite's proxy.
 *   In prod: VITE_API_BASE_URL is "https://titan-api.onrender.com".
 */

export const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

export function adminHeaders() {
  return {
    'Content-Type': 'application/json',
    'X-Admin-Api-Key': import.meta.env.VITE_ADMIN_API_KEY || '',
    'X-Admin-Email': import.meta.env.VITE_ADMIN_EMAIL || '',
  };
}

export async function apiGet(path, opts = {}) {
  const res = await fetch(`${API_BASE}${path}`, { ...opts });
  return res.json();
}

export async function apiPost(path, body, opts = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    body: JSON.stringify(body),
  });
  return res.json();
}

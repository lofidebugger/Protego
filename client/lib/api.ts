export const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';

export function apiUrl(path: string) {
  if (!path) {
    return API_BASE_URL;
  }

  return `${API_BASE_URL}${path.startsWith("/") ? "" : "/"}${path}`;
}

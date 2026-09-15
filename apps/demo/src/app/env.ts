export function getApiBaseUrl() {
  const value = import.meta.env.VITE_API_BASE_URL;
  if (value) {
    return value;
  }
  if (import.meta.env.PROD) {
    return window.location.origin;
  }
  return "http://localhost:4000";
}

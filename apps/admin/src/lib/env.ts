export function getApiBaseUrl() {
  const value = import.meta.env.VITE_API_BASE_URL;
  if (value) {
    return value;
  }
  if (import.meta.env.PROD) {
    return window.location.origin;
  }
  return `${window.location.protocol}//${window.location.hostname}:4000`;
}

export function getDemoAppUrl() {
  const value = import.meta.env.VITE_DEMO_APP_URL;
  if (value) {
    return value;
  }
  if (import.meta.env.PROD) {
    return `${window.location.origin}/feedback/`;
  }
  return "http://localhost:4174";
}

export function getTraceGenieDogfoodProjectKey() {
  return import.meta.env.VITE_TRACEGENIE_DOGFOOD_PROJECT_KEY?.trim() || null;
}

export function getTypeSafeApiBaseUrl() {
  return new URL("/api", window.location.origin).href;
}

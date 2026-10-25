// Client-side cookie utilities.
// These functions manage cookies in the browser only.
// Server actions handle cookie updates on the server side.

function cookieAttributes() {
  const secure = typeof window !== "undefined" && window.location.protocol === "https:" ? "; secure" : "";
  return `path=/; samesite=lax${secure}`;
}

function writeClientCookie(serializedCookie: string) {
  // biome-ignore lint/suspicious/noDocumentCookie: This project still uses document.cookie for broad browser support.
  document.cookie = serializedCookie;
}

export function setClientCookie(key: string, value: string, days = 7) {
  const expires = new Date(Date.now() + days * 864e5).toUTCString();
  writeClientCookie(`${key}=${encodeURIComponent(value)}; expires=${expires}; ${cookieAttributes()}`);
}

export function getClientCookie(key: string) {
  const matches = document.cookie.split("; ").filter((row) => row.startsWith(`${key}=`));
  const value = matches.at(-1)?.slice(key.length + 1);
  return value === undefined ? undefined : decodeURIComponent(value);
}

export function deleteClientCookie(key: string) {
  writeClientCookie(`${key}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; ${cookieAttributes()}`);
}

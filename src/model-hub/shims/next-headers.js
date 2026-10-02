/**
 * Minimal next/headers shim (cookies / headers) for OAuth + auth routes.
 */
const store = { cookieHeader: "", jar: new Map() };

export function __setIncomingCookieHeader(header) {
  store.cookieHeader = header || "";
  store.jar.clear();
  for (const part of store.cookieHeader.split(";")) {
    const i = part.indexOf("=");
    if (i > 0) {
      store.jar.set(part.slice(0, i).trim(), part.slice(i + 1).trim());
    }
  }
}

export function __drainSetCookies() {
  const out = store.setCookies || [];
  store.setCookies = [];
  return out;
}

export async function cookies() {
  return {
    get(name) {
      const v = store.jar.get(name);
      return v !== undefined ? { name, value: v } : undefined;
    },
    getAll() {
      return [...store.jar.entries()].map(([name, value]) => ({ name, value }));
    },
    set(name, value, _opts) {
      store.jar.set(name, value);
      store.setCookies = store.setCookies || [];
      store.setCookies.push(`${name}=${value}; Path=/`);
    },
    delete(name) {
      store.jar.delete(name);
    },
  };
}

export async function headers() {
  return new Headers();
}

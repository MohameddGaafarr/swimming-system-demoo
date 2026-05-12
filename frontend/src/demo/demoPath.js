/**
 * Canonical /api/... path for the in-browser mock router.
 * Handles: /api/..., api/..., https://host/api/..., merged baseURL+url, odd encodings.
 */
export function normalizeRoutePath(input) {
  let s = String(input ?? "").trim();
  if (!s) return "/";
  s = s.split("?")[0].split("#")[0];
  try {
    s = decodeURIComponent(s);
  } catch {
    /* keep */
  }

  if (/^https?:\/\//i.test(s)) {
    try {
      s = new URL(s).pathname || "/";
    } catch {
      const m = s.match(/\/api\/[^?]*/i);
      s = m ? m[0] : "/";
    }
  }

  if (!s.startsWith("/")) s = `/${s}`;

  const idx = s.toLowerCase().indexOf("/api/");
  if (idx >= 0) s = s.slice(idx);

  s = s.replace(/\/+$/, "") || "/";
  return s;
}

/**
 * Best-effort path from the axios config passed to the custom adapter.
 */
export function canonicalApiPathFromConfig(config) {
  const url = String(config?.url ?? "").trim();
  const base = String(config?.baseURL ?? "").trim();
  const candidates = [];

  if (url) candidates.push(url);
  if (base && url) {
    if (/^https?:\/\//i.test(url)) {
      candidates.push(url);
    } else if (/^https?:\/\//i.test(base)) {
      const baseNorm = base.endsWith("/") ? base : `${base}/`;
      const rel = url.replace(/^\/+/, "");
      try {
        candidates.push(new URL(rel, baseNorm).href);
      } catch {
        candidates.push(`${base.replace(/\/+$/, "")}/${url.replace(/^\/+/, "")}`);
      }
    } else {
      candidates.push(`${base.replace(/\/+$/, "")}/${url.replace(/^\/+/, "")}`);
    }
  }
  if (typeof window !== "undefined" && url.startsWith("/")) {
    try {
      candidates.push(new URL(url, window.location.origin).href);
    } catch {
      /* ignore */
    }
  }

  for (const c of candidates) {
    const n = normalizeRoutePath(c);
    if (n.startsWith("/api/")) return n;
  }

  return normalizeRoutePath(url || base || "/");
}

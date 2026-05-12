function getContentType(headers) {
  if (!headers) return "";
  if (typeof headers.get === "function") {
    return String(headers.get("content-type") ?? headers.get("Content-Type") ?? "");
  }
  return String(headers["Content-Type"] ?? headers["content-type"] ?? "");
}

export async function normalizeRequestBody(data, headers) {
  if (typeof data === "string") {
    const t = data.trim();
    const ct = getContentType(headers).toLowerCase();

    if (
      ct.includes("application/json") ||
      (t.startsWith("{") && t.endsWith("}")) ||
      (t.startsWith("[") && t.endsWith("]"))
    ) {
      try {
        return JSON.parse(t);
      } catch {
        return data;
      }
    }

    if (ct.includes("application/x-www-form-urlencoded") || (/[=]/.test(t) && !t.startsWith("{"))) {
      try {
        const out = {};
        new URLSearchParams(t).forEach((value, key) => {
          out[key] = value;
        });
        if (Object.keys(out).length) return out;
      } catch {
        /* fall through */
      }
    }

    return data;
  }
  if (data instanceof FormData) {
    const out = {};
    for (const [key, value] of data.entries()) {
      if (value instanceof File && value.size > 0) {
        out[key] = await readFileAsDataUrl(value);
      } else if (key === "age") {
        const n = Number(value);
        out[key] = Number.isFinite(n) ? n : value;
      } else {
        out[key] = value;
      }
    }
    return out;
  }
  return data;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export async function normalizeRequestBody(data) {
  if (typeof data === "string") {
    const t = data.trim();
    if (
      (t.startsWith("{") && t.endsWith("}")) ||
      (t.startsWith("[") && t.endsWith("]"))
    ) {
      try {
        return JSON.parse(t);
      } catch {
        return data;
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

import axios from "axios";
import { normalizeRequestBody } from "../demo/formDataUtils.js";
import { handleDemoRequest } from "../demo/demoStore.js";

function stripQuery(p) {
  return String(p).split("?")[0];
}

function resolveSuccessStatus(path, method) {
  const clean = stripQuery(path);
  if (method !== "post") return 200;
  if (clean === "/api/coaches" || clean === "/api/trainees" || clean === "/api/sessions") return 201;
  if (clean === "/api/attendance") return 201;
  return 200;
}

async function demoDelay() {
  const ms = 45 + Math.floor(Math.random() * 95);
  await new Promise((r) => setTimeout(r, ms));
}

async function demoAdapter(config) {
  await demoDelay();

  const method = String(config.method || "get").toLowerCase();
  const base = String(config.baseURL ?? "").replace(/\/+$/, "");
  const rel = String(config.url ?? "");
  const path = stripQuery(base ? `${base}${rel}` : rel);
  const params = config.params && typeof config.params === "object" ? config.params : {};
  const body = await normalizeRequestBody(config.data);

  try {
    const data = await handleDemoRequest(method, path, params, body);
    const status = resolveSuccessStatus(path, method);
    return {
      data,
      status,
      statusText: status === 201 ? "Created" : "OK",
      headers: {},
      config,
      request: {},
    };
  } catch (e) {
    const status = e?.response?.status ?? 500;
    const payload = e?.response?.data ?? { message: e?.message || "Request failed" };
    const msg = typeof payload.message === "string" ? payload.message : "Request failed";
    const response = { status, data: payload, headers: {}, statusText: "Error", config };
    if (axios.AxiosError) {
      throw new axios.AxiosError(msg, "ERR_BAD_RESPONSE", config, {}, response);
    }
    const err = new Error(msg);
    err.response = response;
    err.config = config;
    err.isAxiosError = true;
    throw err;
  }
}

const api = axios.create({
  adapter: demoAdapter,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status;
    if (status === 401) {
      const hadToken = Boolean(localStorage.getItem("token"));
      if (hadToken) {
        localStorage.removeItem("token");
        window.dispatchEvent(new CustomEvent("auth:forced-logout"));
      }
    }
    return Promise.reject(error);
  },
);

export default api;

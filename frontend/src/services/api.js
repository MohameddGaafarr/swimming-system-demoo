import axios from "axios";
import { canonicalApiPathFromConfig } from "../demo/demoPath.js";
import { normalizeRequestBody } from "../demo/formDataUtils.js";
import { handleDemoRequest } from "../demo/demoStore.js";

function stripQuery(p) {
  return String(p).split("?")[0];
}

function resolveSuccessStatus(path, method) {
  const clean = stripQuery(path);
  const low = String(method || "get").toLowerCase();
  if (low !== "post") return 200;
  if (/\/api\/coaches$/.test(clean) || /\/api\/trainees$/.test(clean) || /\/api\/sessions$/.test(clean)) {
    return 201;
  }
  if (/\/api\/attendance$/.test(clean) && !clean.includes("/trainees")) {
    return 201;
  }
  return 200;
}

async function demoDelay() {
  const ms = 45 + Math.floor(Math.random() * 95);
  await new Promise((r) => setTimeout(r, ms));
}

async function demoAdapter(config) {
  await demoDelay();

  const method = String(config.method || "get").toLowerCase();
  const path = canonicalApiPathFromConfig(config);

  console.info("[SwimaxDemo:adapter]", {
    method,
    resolvedPath: path,
    configUrl: config.url,
    configBaseURL: config.baseURL,
  });

  const params = config.params && typeof config.params === "object" ? config.params : {};
  const body = await normalizeRequestBody(config.data, config.headers);

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
  baseURL: "",
});

api.interceptors.request.use((config) => {
  config.baseURL = "";
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

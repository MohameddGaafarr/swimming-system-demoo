/**
 * Quick Node check: mock router accepts login path variants and credentials.
 * Run: node scripts/verify-demo-login.mjs (from frontend/)
 */
const store = {};
globalThis.localStorage = {
  getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
  setItem: (k, v) => {
    store[k] = String(v);
  },
  removeItem: (k) => {
    delete store[k];
  },
};

const { handleDemoRequest } = await import("../src/demo/demoStore.js");

async function login(pathVariant) {
  return handleDemoRequest(
    "post",
    pathVariant,
    {},
    { username: "demo", password: "demo123" },
  );
}

const paths = [
  "/api/auth/login",
  "api/auth/login",
  "https://swimming-system-demoo.vercel.app/api/auth/login",
  "/prefix/api/auth/login",
];

for (const p of paths) {
  const r = await login(p);
  if (r.token !== "demo-token") throw new Error(`bad token for ${p}`);
  if (r.user?.username !== "demo") throw new Error(`bad user for ${p}`);
}

console.log("verify-demo-login: OK", paths.length, "path variants");

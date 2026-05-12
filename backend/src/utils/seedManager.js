import User from "../models/User.js";

const DEFAULT_USERNAME = "admin";
const DEFAULT_PASSWORD = "admin123";

export async function seedDefaultManager() {
  const enabled = String(process.env.SEED_DEFAULT_ADMIN ?? "").trim().toLowerCase() === "true";

  if (!enabled) {
    if (process.env.NODE_ENV !== "production") {
      console.log("Default admin seed skipped (set SEED_DEFAULT_ADMIN=true to enable)");
    }
    return;
  }

  const existing = await User.findOne({ username: DEFAULT_USERNAME }).lean();
  if (existing) {
    if (process.env.NODE_ENV !== "production") {
      console.log(`Default manager "${DEFAULT_USERNAME}" already exists — skipping seed`);
    }
    return;
  }

  await User.create({
    username: DEFAULT_USERNAME,
    password: DEFAULT_PASSWORD,
  });
  console.log(`Seeded default manager user "${DEFAULT_USERNAME}" (change password immediately)`);
}

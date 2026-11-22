// Loads server/.env (your own, not committed), then server/.env.<mode> (committed defaults).
// The first file to set a key wins, and real environment variables beat both.
// Import this before anything that reads process.env.
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const root = fileURLToPath(new URL("../../", import.meta.url));
const mode = process.env.NODE_ENV === "production" ? "production" : "development";

dotenv.config({ path: [`${root}.env`, `${root}.env.${mode}`], quiet: true });

import { config } from "dotenv";

// Real values live in .env.local, which is gitignored and never committed.
config({ path: ".env.local", quiet: true });

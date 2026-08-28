import { config } from "dotenv";
import pg from "pg";
config({ path: ".env.local", quiet: true });
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
console.log("=== recent SMS attempts (app) ===");
console.table((await c.query(
  `select to_char(created_at at time zone 'Asia/Manila','HH24:MI') as at,
          recipient, kind, ok, coalesce(error,'-') as error
   from sms_log order by created_at desc limit 15`)).rows);
console.log("=== recent OTP sends (pg_net) ===");
console.table((await c.query(
  `select to_char(attempted_at at time zone 'Asia/Manila','HH24:MI') as at,
          status_code, provider_status, left(coalesce(provider_message,'-'),45) as message
   from sms_deliveries limit 8`)).rows);
await c.end();

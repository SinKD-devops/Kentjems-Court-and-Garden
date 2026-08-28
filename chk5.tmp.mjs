import { config } from "dotenv";
import pg from "pg";
config({ path: ".env.local", quiet: true });
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
console.log("=== every SMS attempt, newest first ===");
console.table((await c.query(
  `select to_char(created_at at time zone 'Asia/Manila','MM-DD HH24:MI') as at,
          recipient, kind, ok, left(coalesce(error,'-'),45) as error
   from sms_log order by created_at desc limit 12`)).rows);
console.log("=== recent bookings (did one get made from the phone?) ===");
console.table((await c.query(
  `select to_char(created_at at time zone 'Asia/Manila','MM-DD HH24:MI') as made,
          status, source, contact_name, contact_phone, price_centavos
   from bookings order by created_at desc limit 5`)).rows);
await c.end();

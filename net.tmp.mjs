import { config } from "dotenv";
import pg from "pg";
config({ path: ".env.local", quiet: true });
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
console.log("=== pg_net responses incl. errors ===");
console.table((await c.query(
  `select to_char(created at time zone 'Asia/Manila','HH24:MI:SS') as at,
          status_code, left(coalesce(error_msg,'-'),60) as error_msg
   from net._http_response order by created desc limit 12`)).rows);
await c.end();

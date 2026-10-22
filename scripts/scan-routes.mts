// Calls the scan route handlers directly. npx tsx --conditions=react-server scripts/scan-routes.mts
import { GET as rowGET } from "../src/app/api/scan/row/route.ts";
import { GET as uniGET } from "../src/app/api/scan/universe/route.ts";

const show = async (name: string, res: Response) => {
  const body = await res.json();
  const brief = JSON.stringify(body, (k, v) => (Array.isArray(v) && v.length > 3 ? [...v.slice(0, 2), `…${v.length} items`] : v)).slice(0, 260);
  console.log(`${name} -> ${res.status} cache=${res.headers.get("cache-control") ?? "none"}\n   ${brief}`);
};
const u = (q: string) => new Request("http://localhost/api/scan/" + q);
await show("universe list", await uniGET(u("universe")));
await show("universe niftyit", await uniGET(u("universe?id=niftyit")));
await show("universe bogus", await uniGET(u("universe?id=bogus")));
await show("row bad ticker", await rowGET(u("row?symbol=" + encodeURIComponent("<script>"))));
await show("row INFY.NS", await rowGET(u("row?symbol=infy.ns")));
await show("row not found", await rowGET(u("row?symbol=ZZZZNOTREAL.NS")));
await show("row ETF (unsupported)", await rowGET(u("row?symbol=NIFTYBEES.NS")));

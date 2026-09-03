#!/usr/bin/env node
/**
 * homestead-hunt production server
 * Static dist/ + geocode + school district + live listings.
 * No personal places. User supplies town / ZIP / address.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const PORT = Number(process.env.PORT || 8788);
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const GOOGLE = process.env.GOOGLE_MAPS_API_KEY || "";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function leaf(v) {
  if (v == null) return null;
  if (typeof v === "object" && v !== null && "value" in v) return v.value ?? null;
  return v;
}
function num(v) {
  const x = leaf(v);
  if (typeof x === "number" && Number.isFinite(x)) return x;
  if (typeof x === "string" && x.trim() && Number.isFinite(Number(x))) return Number(x);
  return null;
}
function str(v) {
  const x = leaf(v);
  return x == null ? "" : String(x);
}

function sendJson(res, status, body) {
  const raw = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(raw),
  });
  res.end(raw);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function geocodeCensus(q) {
  const u = new URL("https://geocoding.geo.census.gov/geocoder/locations/onelineaddress");
  u.searchParams.set("address", q);
  u.searchParams.set("benchmark", "Public_AR_Current");
  u.searchParams.set("format", "json");
  const r = await fetch(u.toString(), { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(10000) });
  if (!r.ok) return null;
  const j = await r.json();
  const m = j.result?.addressMatches?.[0];
  if (!m?.coordinates) return null;
  return {
    lat: m.coordinates.y,
    lon: m.coordinates.x,
    label: m.matchedAddress || q,
    source: "census",
  };
}

async function geocodeNominatim(q) {
  const u = new URL("https://nominatim.openstreetmap.org/search");
  u.searchParams.set("q", q);
  u.searchParams.set("format", "json");
  u.searchParams.set("limit", "1");
  u.searchParams.set("addressdetails", "1");
  const r = await fetch(u.toString(), {
    headers: { "User-Agent": "homestead-hunt/0.1 (open source house+land finder)" },
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) return null;
  const arr = await r.json();
  const hit = arr[0];
  if (!hit) return null;
  const a = hit.address || {};
  return {
    lat: Number(hit.lat),
    lon: Number(hit.lon),
    label: hit.display_name,
    city: a.city || a.town || a.village || a.county || "",
    state: a.state || "",
    zip: a.postcode || "",
    source: "nominatim",
  };
}

async function geocodeGoogle(q) {
  if (!GOOGLE) return null;
  const u = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  u.searchParams.set("address", q);
  u.searchParams.set("key", GOOGLE);
  const r = await fetch(u.toString(), { signal: AbortSignal.timeout(10000) });
  if (!r.ok) return null;
  const j = await r.json();
  const hit = j.results?.[0];
  if (!hit) return null;
  const loc = hit.geometry?.location;
  if (!loc) return null;
  const parts = Object.fromEntries((hit.address_components || []).flatMap((c) => c.types.map((t) => [t, c.long_name])));
  return {
    lat: loc.lat,
    lon: loc.lng,
    label: hit.formatted_address,
    city: parts.locality || parts.sublocality || "",
    state: parts.administrative_area_level_1 || "",
    zip: parts.postal_code || "",
    source: "google",
  };
}

async function geocode(q) {
  const query = String(q || "").trim();
  if (query.length < 3) return null;
  return (await geocodeCensus(query)) || (await geocodeGoogle(query)) || (await geocodeNominatim(query));
}

async function schoolDistrict(lat, lon) {
  const u = new URL("https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/School/MapServer/identify");
  u.searchParams.set("geometry", `${lon},${lat}`);
  u.searchParams.set("geometryType", "esriGeometryPoint");
  u.searchParams.set("sr", "4326");
  u.searchParams.set("layers", "all");
  u.searchParams.set("tolerance", "1");
  u.searchParams.set("mapExtent", `${lon - 0.02},${lat - 0.02},${lon + 0.02},${lat + 0.02}`);
  u.searchParams.set("imageDisplay", "400,400,96");
  u.searchParams.set("returnGeometry", "false");
  u.searchParams.set("f", "json");
  const r = await fetch(u.toString(), { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(12000) });
  if (!r.ok) return { name: "", layer: "" };
  const j = await r.json();
  const hits = j.results || [];
  const unified = hits.find((h) => /unified/i.test(h.layerName || "") || /USD|CSD|SD/i.test(h.attributes?.NAME || h.value || ""));
  const pick = unified || hits[0];
  if (!pick) return { name: "", layer: "" };
  const name = pick.attributes?.NAME || pick.attributes?.NAME20 || pick.value || "";
  return { name: String(name), layer: String(pick.layerName || "") };
}

function mlsPhoto(mls, index = 0, dataSourceId = 175) {
  if (!mls) return null;
  const id = String(mls).replace(/[^0-9]/g, "");
  if (id.length < 4) return null;
  const folder = id.slice(-3);
  if (index === 0) return `https://ssl.cdn-redfin.com/photo/${dataSourceId}/mbpaddedwide/${folder}/genMid.${id}_0.jpg`;
  return `https://ssl.cdn-redfin.com/photo/${dataSourceId}/mbpaddedwide/${folder}/genMid.${id}_${index}_0.jpg`;
}

function parseHomes(payload) {
  const homes = payload?.payload?.homes ?? payload?.homes ?? [];
  const out = [];
  const seen = new Set();
  for (const h of homes) {
    const ll = leaf(h.latLong);
    const lat = num(ll?.latitude);
    const lon = num(ll?.longitude);
    if (lat == null || lon == null) continue;
    const street = str(h.streetLine).trim();
    if (!street) continue;
    const lot = num(h.lotSize);
    const acres = lot && lot > 0 ? Math.round((lot / 43560) * 100) / 100 : null;
    const beds = num(h.beds);
    if (!(beds > 0)) continue;
    const key = `${Math.round(lat * 1e5)}:${Math.round(lon * 1e5)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    let url = str(h.url);
    if (url.startsWith("/")) url = "";
    const mls = str(h.mlsId) || null;
    const ds = num(h.dataSourceId) || 175;
    const nPic = num(h.numPictures) || 0;
    const photoUrl = mlsPhoto(mls, 0, ds);
    const photoUrls = [];
    if (photoUrl) {
      photoUrls.push(photoUrl);
      const extra = Math.max(nPic, 1);
      for (let i = 1; i < extra; i++) {
        const u = mlsPhoto(mls, i, ds);
        if (u) photoUrls.push(u);
      }
    }
    const st = str(h.mlsStatus).toLowerCase();
    const status = st.includes("sold") ? "sold" : st.includes("pending") || st.includes("contingent") ? "pending" : "active";
    out.push({
      id: `h-${h.propertyId ?? street}`,
      status,
      address: street,
      city: str(h.city) || str(h.location),
      zip: str(h.zip) || str(h.postalCode),
      lat,
      lon,
      price: num(h.price),
      acres,
      beds,
      baths: num(h.baths),
      sqft: num(h.sqFt),
      yearBuilt: num(h.yearBuilt),
      mls,
      url,
      photoUrl,
      photoUrls,
    });
  }
  return out;
}

async function listingRegion(query) {
  const u = new URL("https://www.redfin.com/stingray/do/location-autocomplete");
  u.searchParams.set("location", query);
  u.searchParams.set("v", "2");
  const r = await fetch(u.toString(), {
    headers: { Accept: "application/json", "User-Agent": UA, Referer: "https://www.redfin.com/" },
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) return null;
  const text = await r.text();
  const json = JSON.parse(text.replace(/^\{\}&&/, ""));
  const rows = json?.payload?.sections?.flatMap((s) => s.rows || []) || json?.payload?.exactMatch || [];
  const list = Array.isArray(rows) ? rows : rows ? [rows] : [];
  const city = list.find((x) => String(x.type) === "2" || /city/i.test(x.name || x.subName || "")) || list[0];
  if (!city) return null;
  const id = num(city.id) ?? num(city.regionId);
  const type = num(city.type) ?? num(city.regionType) ?? 6;
  const name = str(city.name) || str(city.longName) || query;
  if (id == null) return null;
  return { id, type, name };
}

async function fetchRegion(id, type, name) {
  const u = new URL("https://www.redfin.com/stingray/api/gis");
  u.searchParams.set("al", "1");
  u.searchParams.set("num_homes", "350");
  u.searchParams.set("ord", "days-on-redfin-asc");
  u.searchParams.set("page_number", "1");
  u.searchParams.set("region_id", String(id));
  u.searchParams.set("region_type", String(type));
  u.searchParams.set("sf", "1,2,3,5,6,7");
  u.searchParams.set("status", "9");
  u.searchParams.set("uipt", "1,2,3");
  u.searchParams.set("v", "8");
  u.searchParams.set("zoomLevel", "11");
  const r = await fetch(u.toString(), {
    headers: {
      Accept: "application/json",
      "User-Agent": UA,
      Referer: `https://www.redfin.com/city/${id}/${name}`,
    },
    signal: AbortSignal.timeout(12000),
  });
  if (!r.ok) throw new Error(`listings HTTP ${r.status}`);
  const json = JSON.parse((await r.text()).replace(/^\{\}&&/, ""));
  return parseHomes(json);
}

const cache = new Map();
function cached(key, ttl, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.body;
  return fn().then((body) => {
    cache.set(key, { at: Date.now(), body });
    return body;
  });
}

async function fetchBbox(lat, lon) {
  const d = 0.18;
  const poly = `${lon - d} ${lat - d},${lon + d} ${lat - d},${lon + d} ${lat + d},${lon - d} ${lat + d},${lon - d} ${lat - d}`;
  const u = new URL("https://www.redfin.com/stingray/api/gis");
  u.searchParams.set("al", "1");
  u.searchParams.set("num_homes", "350");
  u.searchParams.set("ord", "days-on-redfin-asc");
  u.searchParams.set("page_number", "1");
  u.searchParams.set("poly", poly);
  u.searchParams.set("sf", "1,2,3,5,6,7");
  u.searchParams.set("status", "9");
  u.searchParams.set("uipt", "1,2,3");
  u.searchParams.set("v", "8");
  u.searchParams.set("zoomLevel", "11");
  const r = await fetch(u.toString(), {
    headers: { Accept: "application/json", "User-Agent": UA, Referer: "https://www.redfin.com/" },
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`listings HTTP ${r.status}`);
  const json = JSON.parse((await r.text()).replace(/^\{\}&&/, ""));
  return parseHomes(json);
}

async function hunt(place) {
  const geo = await geocode(place);
  if (!geo) return { error: "Could not find that place. Try City, ST or a ZIP.", geo: null, school: null, homes: [] };
  const school = await schoolDistrict(geo.lat, geo.lon).catch(() => ({ name: "", layer: "" }));
  const q = [geo.city, geo.state].filter(Boolean).join(", ") || geo.label;
  const region = await listingRegion(q).catch(() => null);
  let homes = [];
  let listingsError;
  try {
    if (region) homes = await fetchRegion(region.id, region.type, region.name);
    if (!homes.length) homes = await fetchBbox(geo.lat, geo.lon);
  } catch (e) {
    listingsError = e instanceof Error ? e.message : "listings failed";
  }
  if (!homes.length && !listingsError) listingsError = "No live houses in that map window.";
  return {
    fetchedAt: new Date().toISOString(),
    geo,
    school,
    region,
    homes,
    error: listingsError,
    note: "Not a buy recommendation. Confirm zoning, animals, and schools with the town and district before you act.",
  };
}

function safeFile(urlPath) {
  const decoded = decodeURIComponent((urlPath || "/").split("?")[0]);
  const rel = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const full = path.normalize(path.join(DIST, rel));
  if (!full.startsWith(DIST + path.sep) && full !== DIST) return null;
  return full;
}

function serveFile(res, file) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      const index = path.join(DIST, "index.html");
      fs.readFile(index, (e2, buf) => {
        if (e2) {
          res.writeHead(404);
          res.end("not found");
          return;
        }
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
        res.end(buf);
      });
      return;
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": ext === ".html" ? "no-store" : "public, max-age=3600",
    });
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  try {
    if (url.pathname === "/api/geocode" && req.method === "GET") {
      const q = url.searchParams.get("q") || "";
      const g = await geocode(q);
      sendJson(res, g ? 200 : 404, g || { error: "not found" });
      return;
    }
    if (url.pathname === "/api/school" && req.method === "GET") {
      const lat = Number(url.searchParams.get("lat"));
      const lon = Number(url.searchParams.get("lon"));
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        sendJson(res, 400, { error: "need lat lon" });
        return;
      }
      sendJson(res, 200, await schoolDistrict(lat, lon));
      return;
    }
    if (url.pathname === "/api/hunt" && req.method === "GET") {
      const q = url.searchParams.get("q") || "";
      if (q.trim().length < 3) {
        sendJson(res, 400, { error: "need a town, ZIP, or address" });
        return;
      }
      const body = await cached(`hunt:${q.toLowerCase()}`, 10 * 60 * 1000, () => hunt(q));
      sendJson(res, 200, body);
      return;
    }
    if (url.pathname === "/healthz") {
      sendJson(res, 200, { ok: true });
      return;
    }
    const file = safeFile(url.pathname);
    if (!file) {
      res.writeHead(400);
      res.end("bad path");
      return;
    }
    serveFile(res, file);
  } catch (err) {
    sendJson(res, 500, { error: err instanceof Error ? err.message : "failed" });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`homestead-hunt http://127.0.0.1:${PORT}/`);
  maybeNamePort();
});

function maybeNamePort() {
  if (PORT === 80) {
    console.log("homestead-hunt http://house.local/");
    return;
  }
  const named = http.createServer((req, res) => {
    const hop = http.request(
      {
        hostname: "127.0.0.1",
        port: PORT,
        path: req.url,
        method: req.method,
        headers: req.headers,
      },
      (up) => {
        res.writeHead(up.statusCode || 502, up.headers);
        up.pipe(res);
      },
    );
    hop.on("error", () => {
      res.writeHead(502);
      res.end("hunt");
    });
    req.pipe(hop);
  });
  named.on("error", () => {
    console.log("http://house.local skipped (port 80 in use). App is still up.");
  });
  named.listen(80, "0.0.0.0", () => {
    console.log("homestead-hunt http://house.local/");
  });
}

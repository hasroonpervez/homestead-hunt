import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import L from "leaflet";
import { nearestPerson, type Person } from "@/lib/fit";

type Home = {
  id: string;
  status: string;
  address: string;
  city: string;
  zip: string;
  lat: number;
  lon: number;
  price: number | null;
  acres: number | null;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  url: string;
  photoUrl?: string | null;
  photoUrls?: string[];
};

type Hunt = {
  fetchedAt: string;
  geo: { lat: number; lon: number; label: string; city?: string; zip?: string } | null;
  school: { name: string; layer: string } | null;
  homes: Home[];
  error?: string;
};

const KEY = "homestead-hunt-v1";
const EIGHT = 8;

type Board = "fit" | "eight" | "near" | "saved";

type Saved = {
  place: string;
  animalsAcres: number;
  minBeds: number;
  minBaths: number;
  minAcres: number;
  driveMinutes: number;
  sort: string;
  people: Person[];
  savedIds: string[];
  board: Board;
};

function loadSaved(): Saved {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "null");
    if (v && typeof v.place === "string") {
      return {
        place: v.place,
        animalsAcres: typeof v.animalsAcres === "number" ? v.animalsAcres : 3,
        minBeds: typeof v.minBeds === "number" ? v.minBeds : 3,
        minBaths: typeof v.minBaths === "number" ? v.minBaths : 0,
        minAcres: typeof v.minAcres === "number" ? v.minAcres : 3,
        driveMinutes: typeof v.driveMinutes === "number" ? v.driveMinutes : 20,
        sort: typeof v.sort === "string" ? v.sort : "lot-desc",
        people: Array.isArray(v.people) ? v.people.filter((p: Person) => p?.lat && p?.label) : [],
        savedIds: Array.isArray(v.savedIds) ? v.savedIds.filter((x: unknown) => typeof x === "string") : [],
        board: v.board === "eight" || v.board === "near" || v.board === "saved" || v.board === "fit" ? v.board : "fit",
      };
    }
  } catch {
    /* ignore */
  }
  return {
    place: "",
    animalsAcres: 3,
    minBeds: 3,
    minBaths: 0,
    minAcres: 3,
    driveMinutes: 20,
    sort: "lot-desc",
    people: [],
    savedIds: [],
    board: "fit",
  };
}

function money(n: number | null) {
  if (!n) return "Price ?";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M`;
  if (n >= 10_000) return `$${Math.round(n / 1000)}k`;
  return `$${n.toLocaleString()}`;
}

type Why = { acres: boolean; beds: boolean; drive: boolean; near: ReturnType<typeof nearestPerson> };

function why(h: Home, s: Saved): Why {
  const near = nearestPerson({ lat: h.lat, lon: h.lon }, s.people);
  return {
    acres: s.minAcres <= 0 || (h.acres ?? 0) >= s.minAcres,
    beds: s.minBeds <= 0 || (h.beds ?? 0) >= s.minBeds,
    drive: !s.people.length || (near != null && near.min <= s.driveMinutes),
    near,
  };
}

function misses(w: Why) {
  return [w.acres, w.beds, w.drive].filter((ok) => !ok).length;
}

export function App() {
  const [saved, setSaved] = useState<Saved>(loadSaved);
  const [q, setQ] = useState(saved.place);
  const [busy, setBusy] = useState(false);
  const [hunt, setHunt] = useState<Hunt | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [whoLabel, setWhoLabel] = useState("");
  const [whoAddr, setWhoAddr] = useState("");
  const [whoBusy, setWhoBusy] = useState(false);
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const didBoot = useRef(false);

  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(saved));
  }, [saved]);

  const run = async (place: string) => {
    const p = place.trim();
    if (p.length < 3) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`/api/hunt?q=${encodeURIComponent(p)}`);
      const j = (await r.json()) as Hunt & { error?: string };
      if (!r.ok && !j.geo) throw new Error(j.error || "search failed");
      setHunt(j);
      setSaved((s) => ({ ...s, place: p }));
      if (j.error && !j.homes?.length) setErr(j.error);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "search failed");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (didBoot.current) return;
    didBoot.current = true;
    if (saved.place.trim().length >= 3) void run(saved.place);
  }, []);

  const addPerson = async () => {
    const label = whoLabel.trim() || "Family";
    const address = whoAddr.trim();
    if (address.length < 3 || saved.people.length >= 3) return;
    setWhoBusy(true);
    try {
      const r = await fetch(`/api/geocode?q=${encodeURIComponent(address)}`);
      const g = await r.json();
      if (!r.ok || !g.lat) throw new Error(g.error || "could not find that place");
      const person: Person = {
        id: `${Date.now()}`,
        label,
        address: g.label || address,
        lat: g.lat,
        lon: g.lon,
      };
      setSaved((s) => ({ ...s, people: [...s.people, person] }));
      setWhoLabel("");
      setWhoAddr("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "could not add that person");
    } finally {
      setWhoBusy(false);
    }
  };

  const scored = useMemo(() => {
    if (!hunt?.homes) return [];
    const live = hunt.homes.filter((h) => h.status !== "sold");
    return live.map((h) => {
      const w = why(h, saved);
      return { h, w, miss: misses(w) };
    });
  }, [hunt, saved]);

  const fit = useMemo(() => scored.filter((x) => x.miss === 0), [scored]);
  const near = useMemo(() => scored.filter((x) => x.miss === 1), [scored]);

  const rankedFit = useMemo(() => {
    const miss = (n: number | null) => n == null || n <= 0;
    return [...fit].sort((a, b) => {
      if (saved.sort === "sqft-desc") {
        if (miss(a.h.sqft) !== miss(b.h.sqft)) return miss(a.h.sqft) ? 1 : -1;
        return (b.h.sqft ?? 0) - (a.h.sqft ?? 0);
      }
      if (saved.sort === "price-asc") return (a.h.price || 9e12) - (b.h.price || 9e12);
      if (miss(a.h.acres) !== miss(b.h.acres)) return miss(a.h.acres) ? 1 : -1;
      return (b.h.acres ?? 0) - (a.h.acres ?? 0);
    });
  }, [fit, saved.sort]);

  const shown = useMemo(() => {
    if (saved.board === "saved") return scored.filter((x) => saved.savedIds.includes(x.h.id));
    if (saved.board === "near") return near;
    if (saved.board === "eight") return rankedFit.slice(0, EIGHT);
    return rankedFit;
  }, [saved.board, saved.savedIds, scored, near, rankedFit]);

  useEffect(() => {
    if (!mapEl.current || mapRef.current) return;
    const map = L.map(mapEl.current, { zoomControl: false }).setView([39.8, -98.5], 4);
    L.control.zoom({ position: "bottomright" }).addTo(map);
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
      attribution: "Esri",
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    requestAnimationFrame(() => map.invalidateSize());
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const g = layerRef.current;
    if (!map || !g) return;
    g.clearLayers();
    if (hunt?.geo) {
      L.circleMarker([hunt.geo.lat, hunt.geo.lon], {
        radius: 8,
        color: "#fff",
        weight: 2,
        fillColor: "#1b1b1b",
        fillOpacity: 1,
      })
        .bindTooltip("Search")
        .addTo(g);
      map.setView([hunt.geo.lat, hunt.geo.lon], 12);
    }
    for (const p of saved.people) {
      L.circleMarker([p.lat, p.lon], {
        radius: 7,
        color: "#fff",
        weight: 2,
        fillColor: "#b8860b",
        fillOpacity: 1,
      })
        .bindTooltip(p.label)
        .addTo(g);
    }
    for (const { h, w } of shown) {
      const m = L.circleMarker([h.lat, h.lon], {
        radius: sel === h.id ? 10 : 6,
        color: "#fff",
        weight: 2,
        fillColor: (h.acres ?? 0) >= saved.animalsAcres ? "#157a4b" : "#1f6fe0",
        fillOpacity: 1,
      });
      m.on("click", () => setSel(h.id));
      const drive = w.near ? ` · ${w.near.min} min ${w.near.person.label}` : "";
      m.bindTooltip(`${money(h.price)} · ${h.acres ?? "?"} ac${drive}`);
      m.addTo(g);
    }
    map.invalidateSize();
    const pts: [number, number][] = [];
    if (hunt?.geo) pts.push([hunt.geo.lat, hunt.geo.lon]);
    for (const p of saved.people) pts.push([p.lat, p.lon]);
    for (const { h } of shown) pts.push([h.lat, h.lon]);
    if (pts.length > 1) map.fitBounds(pts, { padding: [28, 28], maxZoom: 14 });
  }, [shown, hunt, sel, saved.people]);

  useEffect(() => {
    if (!sel) return;
    document.getElementById(`home-${sel}`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  const toggleSave = (id: string) => {
    setSaved((s) => {
      const has = s.savedIds.includes(id);
      const savedIds = has ? s.savedIds.filter((x) => x !== id) : [...s.savedIds, id].slice(0, EIGHT);
      return { ...s, savedIds };
    });
  };

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-bg text-fg">
      <aside className="flex h-full w-full shrink-0 flex-col border-r border-border sm:w-[28rem]">
        <div className="shrink-0 border-b border-border px-4 py-4">
          <p className="text-[11px] tracking-wide text-muted uppercase">Homestead hunt</p>
          <h1 className="mt-0.5 text-xl font-semibold">Can we live here?</h1>
          <p className="mt-1 text-sm text-muted">
            Three must haves. People you need nearby. Then look at eight houses, not ninety tabs.
          </p>
          <form
            className="mt-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void run(q);
            }}
          >
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Your town, ZIP, or street"
              className="h-11 min-w-0 flex-1 rounded-full border border-border bg-elevated px-4 text-sm"
            />
            <button type="submit" className="h-11 rounded-full bg-fg px-4 text-sm font-medium text-white">
              {busy ? "…" : "Search"}
            </button>
          </form>
          {hunt?.geo && (
            <p className="mt-2 text-xs text-muted">
              {hunt.geo.label}
              {hunt.school?.name ? ` · ${hunt.school.name}` : ""}
            </p>
          )}

          <p className="mt-3 text-[11px] tracking-wide text-muted uppercase">Must haves</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {(
              [
                [0, "Any lot"],
                [1, "1+ ac"],
                [3, "3+ ac animals"],
                [5, "5+ ac"],
              ] as [number, string][]
            ).map(([n, t]) => (
              <Chip key={n} on={saved.minAcres === n} onClick={() => setSaved((s) => ({ ...s, minAcres: n, animalsAcres: n || s.animalsAcres }))}>
                {t}
              </Chip>
            ))}
            {(
              [
                [0, "Any beds"],
                [2, "2+ bd"],
                [3, "3+ bd"],
                [4, "4+ bd"],
              ] as [number, string][]
            ).map(([n, t]) => (
              <Chip key={`b${n}`} on={saved.minBeds === n} onClick={() => setSaved((s) => ({ ...s, minBeds: n }))}>
                {t}
              </Chip>
            ))}
            {saved.people.length > 0 &&
              ([15, 20, 30] as const).map((n) => (
                <Chip key={`d${n}`} on={saved.driveMinutes === n} onClick={() => setSaved((s) => ({ ...s, driveMinutes: n }))}>
                  ≤{n} min
                </Chip>
              ))}
          </div>

          <p className="mt-3 text-[11px] tracking-wide text-muted uppercase">Who we need nearby</p>
          <div className="mt-1.5 space-y-1">
            {saved.people.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-2 text-sm">
                <span>
                  <span className="font-medium">{p.label}</span>
                  <span className="text-muted"> · {p.address}</span>
                </span>
                <button type="button" className="text-xs text-muted" onClick={() => setSaved((s) => ({ ...s, people: s.people.filter((x) => x.id !== p.id) }))}>
                  Remove
                </button>
              </div>
            ))}
            {saved.people.length < 3 && (
              <form
                className="flex flex-wrap gap-1.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  void addPerson();
                }}
              >
                <input
                  value={whoLabel}
                  onChange={(e) => setWhoLabel(e.target.value)}
                  placeholder="Mom, school, work"
                  className="h-9 w-28 rounded-full border border-border bg-elevated px-3 text-xs"
                />
                <input
                  value={whoAddr}
                  onChange={(e) => setWhoAddr(e.target.value)}
                  placeholder="Their town or street"
                  className="h-9 min-w-0 flex-1 rounded-full border border-border bg-elevated px-3 text-xs"
                />
                <button type="submit" className="h-9 rounded-full border border-border px-3 text-xs">
                  {whoBusy ? "…" : "Add"}
                </button>
              </form>
            )}
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5">
            {(
              [
                ["fit", `Fits us · ${fit.length}`],
                ["eight", "The 8"],
                ["near", `Close · ${near.length}`],
                ["saved", `Saved · ${saved.savedIds.length}`],
              ] as [Board, string][]
            ).map(([k, t]) => (
              <Chip key={k} on={saved.board === k} onClick={() => setSaved((s) => ({ ...s, board: k }))}>
                {t}
              </Chip>
            ))}
            {(["lot-desc", "sqft-desc", "price-asc"] as const).map((k) => (
              <Chip key={k} on={saved.sort === k} onClick={() => setSaved((s) => ({ ...s, sort: k }))}>
                {k === "lot-desc" ? "Lot ↓" : k === "sqft-desc" ? "Sqft ↓" : "Price"}
              </Chip>
            ))}
          </div>
          <p className="mt-2 text-sm text-muted">
            {shown.length} on this board
            {busy ? " · updating…" : ""}
            {saved.board === "eight" ? " · most families only walk eight" : ""}
          </p>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3">
          {err && <p className="text-sm text-red-700">{err}</p>}
          {!hunt && !busy && (
            <p className="text-sm text-muted">
              Add who you need to be near, then search a town. Confirm animals and schools with that town. Not a buy app.
            </p>
          )}
          {hunt && !shown.length && !busy && (
            <p className="text-sm text-muted">
              {saved.board === "near"
                ? "No near misses. That is good, or loosen a must have."
                : saved.board === "saved"
                  ? "Save up to eight. That’s the family shortlist."
                  : "Nothing fits yet. Try Close, or drop one must have. A rigid sqft or acre floor hides good lots."}
            </p>
          )}
          {shown.map(({ h, w }) => (
            <Card
              key={h.id}
              h={h}
              w={w}
              saved={saved.savedIds.includes(h.id)}
              onPick={() => setSel(h.id)}
              onSave={() => toggleSave(h.id)}
            />
          ))}
        </div>
      </aside>
      <div className="relative min-w-0 flex-1">
        <div ref={mapEl} className="absolute inset-0" />
      </div>
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-8 rounded-full border px-3 text-xs ${on ? "border-fg bg-fg text-white" : "border-border"}`}
    >
      {children}
    </button>
  );
}

function Card({
  h,
  w,
  saved,
  onPick,
  onSave,
}: {
  h: Home;
  w: Why;
  saved: boolean;
  onPick: () => void;
  onSave: () => void;
}) {
  const [i, setI] = useState(0);
  const photos = h.photoUrls?.length ? h.photoUrls : h.photoUrl ? [h.photoUrl] : [];
  const n = photos.length;
  const href = `https://www.openstreetmap.org/?mlat=${h.lat}&mlon=${h.lon}#map=18/${h.lat}/${h.lon}`;
  const bits = [
    w.acres ? `${h.acres} ac` : h.acres != null ? `only ${h.acres} ac` : "lot ?",
    w.beds ? `${h.beds} bd` : `${h.beds ?? 0} bd`,
    w.near ? `${w.near.min} min to ${w.near.person.label}` : null,
  ].filter(Boolean);
  return (
    <article id={`home-${h.id}`} className="overflow-hidden rounded-xl border border-border bg-elevated">
      <div className="relative">
        {photos[i] ? (
          <a href={href} target="_blank" rel="noreferrer">
            <img
              src={photos[i]}
              alt=""
              className="h-40 w-full object-cover"
              onError={() => {
                if (i < n - 1) setI(i + 1);
              }}
            />
          </a>
        ) : (
          <div className="grid h-28 place-items-center text-sm text-muted">No photo</div>
        )}
        {n > 1 && (
          <>
            <button type="button" className="absolute top-1/2 left-2 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-lg" onClick={() => setI((p) => (p - 1 + n) % n)}>
              ‹
            </button>
            <button type="button" className="absolute top-1/2 right-2 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-lg" onClick={() => setI((p) => (p + 1) % n)}>
              ›
            </button>
            <span className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/55 px-2 text-[11px] text-white">
              {i + 1} / {n}
            </span>
          </>
        )}
        <button
          type="button"
          onClick={onSave}
          className="absolute top-2 right-2 z-10 min-h-9 min-w-9 rounded-full bg-white/90 px-2 text-xs font-medium shadow"
        >
          {saved ? "Saved" : "Save"}
        </button>
      </div>
      <button type="button" onClick={onPick} className="block w-full p-3 text-left">
        <p className="text-xl font-semibold">{money(h.price)}</p>
        <p className="text-sm">
          {h.beds} bd · {h.baths ?? "?"} ba · {h.sqft ? `${h.sqft.toLocaleString()} sqft` : "n/a"} · {h.acres ?? "?"} ac
        </p>
        <p className="text-sm text-muted">
          {h.address}, {h.city} {h.zip}
        </p>
        <p className={`mt-1 text-xs ${w.acres && w.beds && w.drive ? "text-ok" : "text-muted"}`}>{bits.join(" · ")}</p>
      </button>
      <a href={href} target="_blank" rel="noreferrer" className="text-muted block px-3 pb-3 text-xs">
        Open map. Confirm animals with that town
      </a>
    </article>
  );
}

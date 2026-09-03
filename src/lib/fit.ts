/** Family hunt math. Not legal. Drive time is a road guess, not live traffic. */

export type LatLon = { lat: number; lon: number };

export function haversineMiles(a: LatLon, b: LatLon) {
  const R = 3958.8;
  const p = Math.PI / 180;
  const dLat = (b.lat - a.lat) * p;
  const dLon = (b.lon - a.lon) * p;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * p) * Math.cos(b.lat * p) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Same rule of thumb as a quiet local hunt: miles × 1.35 / 28 mph, floor 4 min. */
export function driveMinutes(a: LatLon, b: LatLon) {
  const miles = haversineMiles(a, b);
  return Math.max(4, Math.round((miles * 1.35) / 28 * 60));
}

export type Person = {
  id: string;
  label: string;
  address: string;
  lat: number;
  lon: number;
};

export function nearestPerson(home: LatLon, people: Person[]) {
  if (!people.length) return null;
  let best = { person: people[0], min: driveMinutes(home, people[0]) };
  for (const p of people.slice(1)) {
    const min = driveMinutes(home, p);
    if (min < best.min) best = { person: p, min };
  }
  return best;
}

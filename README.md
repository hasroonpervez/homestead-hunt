# Homestead hunt

Find a **house with land**, in a **school district you can name**, with a **lot big enough for animals**.

Not a buy app. Confirm zoning, livestock, and schools with the town and the district before you act.

## Quick start

```bash
git clone https://github.com/hasroonpervez/homestead-hunt.git
cd homestead-hunt
npm install
npm run build
npm start
npm run name-house
```

Open http://house.local

## What this is for

A family hunt, not a shopping catalog. Most people freeze after too many tabs. This app keeps three must haves, the people you need nearby, and a short list.

| Board | For |
|---|---|
| Fits us | Land, beds, and minutes to your people |
| The 8 | Same list, stop at eight |
| Close | Missed exactly one must have. Look before you tighten. |
| Saved | Family shortlist, max eight |

Animals is an acre floor **you** set. School is the Census district name at your search, then you confirm with the district. Next step is **call that town’s planning**, not “make an offer.”

## Make it yours

Type **your** town, ZIP, or street in the search box. That becomes the map center. Nothing is locked to one place.

| You type | Example |
|---|---|
| Town | `Boise, ID` |
| ZIP | `12084` |
| Street | `12 Main St, City, ST` |

Then set the lot floor so the list matches how you live:

| Chip | Meaning |
|---|---|
| Lot any | See every house |
| 1+ ac | Small acreage |
| 3+ ac | Default animal floor. Change it. |
| 5+ ac | Larger farm lots |

Green pins meet **your** acre number. Gold pins are people you added.

Filters stay in this browser after refresh.

Optional: copy `hunt.config.example.json` to `hunt.config.json` on **your** machine if you want a default place when the app starts. That file is gitignored so it stays with you.

```json
{
  "place": "Your Town, ST",
  "animalsAcres": 3
}
```

No extra map key required. Census + OpenStreetMap look up the place. If you have a geocoding key, copy `.env.example` to `.env`.

## What the map is telling you

- **Search center:** the town / ZIP / address you typed
- **School name** under the search: Census school district at that pin
- **House cards:** live for-sale houses (beds > 0)
- **Green pin:** lot ≥ your animal acre chip

Call **that town’s** planning department before you count on animals. School assignment is the district’s, not this map’s.

## Develop

Terminal 1: `npm start` (API + static, port 8788)  
Terminal 2: `npm run dev` (Vite on 5174, proxies `/api`)

| File | What to edit |
|---|---|
| `src/App.tsx` | Layout, filters, cards |
| `server/prod.mjs` | Geocode, school district, listings |
| `.env` | Optional geocoding key, `PORT` |

## Data

| Piece | Source |
|---|---|
| Place | US Census geocoder, then OSM Nominatim |
| School district | Census TIGERweb School MapServer |
| Listings | Live for-sale houses (beds > 0) |

If you have zoning GeoJSON for *your* town, fork and add a layer. This app does not ship one town’s zoning map.

## License

MIT. Not a buy recommendation. Not a livestock permit. Not an official school assignment.

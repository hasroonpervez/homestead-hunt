# QA / grill

## PII scrub (must be empty in source)

Grep your own family names, street addresses, and phone numbers. Upstream source has none. Do not add a real home pin to `hunt.config.json` and then commit it.

## Functional

- [ ] `npm run build` exits 0
- [ ] `npm start` serves `/healthz` 200
- [ ] `/api/hunt?q=Boise,%20ID` returns `geo` + `homes` array
- [ ] School name present or empty string, never a crash
- [ ] Photo count = listing `numPictures`, not capped at 6
- [ ] Refresh keeps filters (localStorage `homestead-hunt-v1`)
- [ ] No default map center on a private house

## UX grill

- Explore surface: search + list + map, no marketing hero
- 44px hit targets on search and photo arrows
- Empty state tells you to search a town
- Disclaimer visible

## Backend

- 10 minute cache on `/api/hunt`
- Timeouts on Census / OSM / listings
- Houses only (`beds > 0`)

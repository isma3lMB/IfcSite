<!--
Thanks for contributing. CONTRIBUTING.md has the layering rule and the test
conventions if you have not read it yet.
-->

## What this changes

<!-- And why. If it fixes an issue, "Fixes #123" here. -->

## How it was checked

<!-- Which site did you try it on? Coordinates or a place name is enough. Which
     provider — OSM or IGN? If the change is pure logic, the tests may be the
     whole answer. -->

## Data sources touched

<!-- Delete the line if none. Overpass, IGN Géoplateforme, Nominatim and the
     Terrarium tiles are free services under someone else's terms, so a change
     to how often or how much this asks them for is worth calling out. -->

- [ ] This changes what the app requests from a public service

---

- [ ] `npm run typecheck` passes
- [ ] `npm test` passes
- [ ] `npm run build` passes
- [ ] New pure logic under `lib/geo`, `lib/scene`, `lib/ifc` or `lib/io` comes with a test
- [ ] New or changed user-facing text is in **both** `lib/i18n/en.ts` and `lib/i18n/fr.ts`

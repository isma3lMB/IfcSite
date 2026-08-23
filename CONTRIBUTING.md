# Contributing

Issues and pull requests are welcome.

Start with **[DEVELOPER.md](DEVELOPER.md)**. It covers the architecture, the layering rules, and
the reasoning behind the parts that look strange on purpose — most of which are load-bearing, and
a few of which are the answer to a bug that is not obvious from the code alone.

---

## Before opening a PR

```bash
npm run typecheck
npm test
npm run build
```

All three run on every pull request (see [.github/workflows/ci.yml](.github/workflows/ci.yml)), on
Node 20.19 and Node 22. Running them locally first is faster than finding out from the PR page.

Requires **Node 20.19 or newer**.

---

## The layering rule

This is the one thing worth knowing before you move code around, and it is what makes the project
testable at all:

> **Nothing under `lib/geo`, `lib/scene`, `lib/ifc` or `lib/io/draft` may import three.js or
> Leaflet, touch `window`, or call `fetch`.**

Those modules are closed-form logic over plain arrays and numbers. `lib/geo/rings` is free of
three.js so the IFC serialiser can depend on it without pulling a renderer into its graph;
`lib/geo/rect` is free of Leaflet so the React layer can use it without loading a map. Mesh work
that genuinely needs three lives in `lib/geo/mesh`, and everything that talks to a network service
lives in `lib/sources`.

Two consequences for a PR:

- **New pure logic goes in one of those modules, and arrives with a test.** That is the half of the
  codebase the suite covers, and it is cheap to keep covered.
- **A parser inside a networked module can still be pure.** `parseHeight` in `lib/sources/overpass`
  and `sanitizeTunables` in `lib/build/tunables` both are, and both are tested directly. If you add
  a parser, keep it exported and free of the fetch around it.

`lib/build/tunables` has a stricter version of the same rule, written in its own header: it imports
nothing at runtime, because `components/controls-panel` imports it and must not drag
`polygon-clipping` or three.js into the panel's chunk.

---

## Tests

Vitest, in a plain node environment. There is no jsdom and no browser: the suite covers the
renderer-free, network-free half of `lib/`, and a module that needs a browser is exercised by using
the app.

```bash
npm test                              # once
npm run test:watch                    # on change
npx vitest run tests/geo/rect.test.ts # one file
```

Tests live in `tests/`, mirroring `lib/` — `lib/geo/rect.ts` is tested by `tests/geo/rect.test.ts`.
They are kept out of `lib/` so the directory map in DEVELOPER.md §2 stays true.

Two conventions worth copying from the existing files:

- **Import `describe`/`it`/`expect` from `vitest` explicitly.** Globals are off, which is what lets
  `tsc --noEmit` typecheck the test files without a `types` entry in tsconfig.
- **Test the documented contract, not the current output.** The doc comments in `lib/` state what a
  function is *for*, often with the bug it exists to prevent. Encode that. Where the behaviour and
  the comment disagree, say so in the test rather than quietly pinning whichever one you found —
  there are a couple of tests in the suite that record a rough edge deliberately, and they say as
  much in a comment.

There is no coverage gate, and adding one would be a mistake: the bulk of the codebase is a 3400-line
imperative three.js viewer that this suite does not try to cover, so any percentage it reported
would be noise.

---

## Running it

```bash
npm install
npm run dev     # http://localhost:3000
```

To check a production build:

```bash
npm run build   # static export into out/
npm start       # serves out/ over HTTP
```

**Serve it over HTTP.** Opening `out/index.html` through `file://` gives the page a null origin,
which Overpass rejects — you get an empty result rather than an error, which is much harder to
diagnose than a failure would be.

---

## Text and translations

The app ships in French and English, and French is what it boots into. The pure layer never builds
a user-facing sentence: it emits a key from `lib/i18n/keys.ts` plus a params bag, and the React
layer looks it up. So:

- A new message means a new key in **both** `lib/i18n/en.ts` and `lib/i18n/fr.ts`. A key added to
  one and forgotten in the other is a compile error, because `fr` is declared as `Dict` and
  `Dict = typeof en`.
- A `{placeholder}` must appear in both languages. That one is *not* a compile error, so
  `tests/i18n/parity.test.ts` checks it.

---

## Data sources

The app is a static export with no backend: every request goes from the browser straight to a
service that sends `Access-Control-Allow-Origin: *`. If a change touches Overpass, the IGN
Géoplateforme, Nominatim or the Terrarium tiles, say so in the PR description — these are free
services under someone else's terms, and request volume is a real constraint rather than a
politeness.

---

## Licence

The project is **[GPL-3.0](LICENSE)**. Contributions are accepted under the same licence.

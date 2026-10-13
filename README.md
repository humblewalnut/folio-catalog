# Folio catalog

Public metadata and data releases for the native Folio app. No private collections, purchase costs, certificates, user export files or personal photos belong here. The app source repository is private.

TCGdex is the community foundation; reviewed Folio supplements and exact importer crosswalks carry per-record evidence. English, Japanese and **Simplified Chinese** physical cards only. Coverage remains partial. A reviewed identity does not imply a complete checklist, verified finish variants, pricing or permission to republish artwork.

## Release and coverage

`catalog/manifest.json` points to an immutable SHA-256-addressed payload. Clients verify schema, digest, byte count, regional identities and stored printing stability before adopting it. Cached data and the bundled snapshot are offline fallbacks. Catalog releases contain metadata only, never user collection data or prices. Dated market references live in the separate `pricing/` feed.

`catalog/coverage-audit.json` reports records, supplied artwork, reviewed identities, variant checks, mappings and known missing sets separately. Provider totals and reviewed checklist totals remain distinct. `catalog/artwork-health.json` is a rotating HTTP sample, not a visual authenticity or rights check. `catalog/source-watch.json` is a partial inbox of official product references; leads require review before card records are admitted.

## Maintenance

Run `python3 scripts/refresh-catalog.py`, `python3 scripts/watch-catalog-sources.py`, then `python3 scripts/publish-catalog.py --check-images`. Weekly GitHub Actions publishes a review branch and a complete audit artifact, and attempts to open a PR. If repository policy blocks automatic PR creation, use the published compare link to open it manually. Publication failures retain the full proposed snapshot in the artifact; unavailable source checks are reported and prior reference leads are preserved. It never silently merges a regional identity. Keep reviewed supplements in version control with evidence. Do not reassign IDs or remove printings in a release.

TCGdex metadata is MIT licensed (see `inputs/TCGDEX-LICENSE.txt`). Card artwork and Pokémon trademarks belong to their respective rights holders. Source references are for identity review and do not grant artwork rights. New reference-site artwork is not copied into this repository. See input attribution for the legacy demo metadata.


## Approved regional coverage batch — 12 October 2026

Release `v1-70a7ba27e8b4cf6c` has **44,270 records in 566 admitted sets/products**. It adds 9,316 records and 166 product entries over the previous release: 8,951 Japanese, 116 English and 249 Simplified Chinese. Regional totals are 21,380 English, 22,446 Japanese and 444 Simplified Chinese. The audit includes one additional known Chinese release without records.

Japanese metadata is correlated from the MIT-licensed type-null source using official card IDs and 293 explicit product crosswalks. New product dates/totals remain unknown when not verified. Gem Packs 1–3 represent 115, 140 and 136 listed numbered positions; these include repeated illustrations/finishes. Existing IDs, original reviews and all 23 importer mappings survive.

`catalog/reviewed-artwork.json` fills 970 English image references from the historical Pokémon TCG Data source. Patches require exact unchanged identity, previous URL, source evidence and successful HTTP/image-type checks. Source commit evidence is pinned. No image files, pricing or game text are copied. These checks do not individually certify every image or confer artwork rights. The legacy source is supplemental and needs ongoing availability review.

**Build 25 or later** supports these additional English artwork URLs. Older builds keep their existing catalog if their validator rejects the host. The app merges artwork patches into the bundled catalog without duplicating records. Compatible future metadata releases can update independently of app releases.

Coverage remains incomplete, especially Japanese artwork, historical mainland Chinese products, shared-number variants and exact finishes. The complete master, source inventory and unresolved candidates stay private. Public additions contain only approved identifying facts and evidence. No new catalog API account or subscription is required.

## Japanese artwork reference update — 12 October 2026

Release `v1-a273cbd8abd9741e` preserves all 44,335 records, 568 admitted products and 23 importer mappings. It adds 910 identity-bound Japanese TCGdex image references, for 4,937 Japanese records with supplied artwork. Names and collector numbers were inspected; finish and edition remain unverified. This is an image-reference update, not worldwide coverage completion. No image bytes, private research, local archive paths or noncommercial source assets are published.

## Daily market references

A separate `pricing/manifest.json` points to a small immutable, SHA-256 checked price feed. The daily job runs at **10:43 UTC** (GitHub scheduling can be delayed) and can also be started manually. It downloads Cardmarket's official bulk files to temporary runner storage, verifies exact approved TCGdex printings, and publishes only dated references for the reviewed mappings. Full provider files, private collections and API keys are never committed. The full local archive remains on the owner's external drive.

Price changes on already reviewed identities publish automatically; new identities and variants require review through `backend/marketplace-mappings.json`. The shared mapping/adapter copies originate in the private Folio app repository and must be updated together. A failed card request retains that card's old prices and dates. A broad outage fails the run and keeps the last publication. Explicit changed/ambiguous identities remove obsolete prices. A newly fetched older source price cannot replace a newer observation. Reports give refresh counts; they do not claim catalog-wide pricing coverage.

The app needs one release containing the feed reader. After that, it checks when launched, foregrounded or when a card is opened (at most hourly after success; five-minute backoff after failure), and caches verified updates for offline viewing. Source timestamps remain separate from feed publication time. This feed supplies raw USD/EUR market references, not exact-condition or graded portfolio valuations. No paid pricing API is used by the daily job.

# Folio catalog

Public metadata and data releases for the native Folio app. No private collections, purchase costs, certificates, user export files or personal photos belong here. The app source repository is private.

TCGdex is the community foundation; reviewed Folio supplements and exact importer crosswalks carry per-record evidence. English, Japanese and **Simplified Chinese** physical cards only. Coverage remains partial. A reviewed identity does not imply a complete checklist, verified finish variants, pricing or permission to republish artwork.

## Release and coverage

`catalog/manifest.json` points to an immutable SHA-256-addressed payload. Clients verify schema, digest, byte count, regional identities and stored printing stability before adopting it. Cached data and the bundled snapshot are offline fallbacks. Releases contain metadata only, never user collection data or prices.

`catalog/coverage-audit.json` reports records, supplied artwork, reviewed identities, variant checks, mappings and known missing sets separately. Provider totals and reviewed checklist totals remain distinct. `catalog/artwork-health.json` is a rotating HTTP sample, not a visual authenticity or rights check. `catalog/source-watch.json` is a partial inbox of official product references; leads require review before card records are admitted.

## Maintenance

Run `python3 scripts/refresh-catalog.py`, `python3 scripts/watch-catalog-sources.py`, then `python3 scripts/publish-catalog.py --check-images`. Weekly GitHub Actions publishes a review branch and a complete audit artifact, and attempts to open a PR. If repository policy blocks automatic PR creation, use the published compare link to open it manually. Publication failures retain the full proposed snapshot in the artifact; unavailable source checks are reported and prior reference leads are preserved. It never silently merges a regional identity. Keep reviewed supplements in version control with evidence. Do not reassign IDs or remove printings in a release.

TCGdex metadata is MIT licensed (see `inputs/TCGDEX-LICENSE.txt`). Card artwork and Pokémon trademarks belong to their respective rights holders. Source references are for identity review and do not grant artwork rights. New reference-site artwork is not copied into this repository. See input attribution for the legacy demo metadata.


## Approved regional coverage batch — 12 October 2026

Release `v1-7b911e210657b7e1` contains 34,954 catalog records in 400 admitted sets, adding 843 to the previous release: 707 Japanese identities and 136 mainland Chinese numbered positions. English has 21,264 records, Japanese 13,495, and Simplified Chinese 195. The registry includes two further known mainland products with no records.

The Japanese additions cover CP6, Plasma Gale, 30th CELEBRATION, Sword & Shield promos and Eevee Heroes, correlated from the MIT-licensed type-null Japanese metadata and official Japanese card IDs/product references. New IDs use the official card ID. Previous Folio IDs and all 23 exact importer crosswalks stay intact. The mainland Gem Pack Vol. 2 checklist represents all 140 listed numbered positions, including four existing cards; repeated illustrations/finishes remain separate positions. Every admitted addition carries source evidence. New artwork, prices and game text are not copied.

Record counts do not certify a complete regional catalog or distinct illustration count. Finish and artwork verification remain open. This is an explicitly reviewed addition batch; the complete combined master, source inventory and unresolved candidates stay in the private app repository. Open metadata attribution notices are in `licenses/`. Existing installed clients can retrieve this release through Settings → Coverage & catalog updates; a TestFlight update is unnecessary for metadata alone.

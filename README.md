# Folio catalog

Public metadata and data releases for the native Folio app. No private collections, purchase costs, certificates, user export files or personal photos belong here. The app source repository is private.

TCGdex is the community foundation; reviewed Folio supplements and exact importer crosswalks carry per-record evidence. English, Japanese and **Simplified Chinese** physical cards only. Coverage remains partial. A reviewed identity does not imply a complete checklist, verified finish variants, pricing or permission to republish artwork.

## Release and coverage

`catalog/manifest.json` points to an immutable SHA-256-addressed payload. Clients verify schema, digest, byte count, regional identities and stored printing stability before adopting it. Cached data and the bundled snapshot are offline fallbacks. Releases contain metadata only, never user collection data or prices.

`catalog/coverage-audit.json` reports records, supplied artwork, reviewed identities, variant checks, mappings and known missing sets separately. Provider totals and reviewed checklist totals remain distinct. `catalog/artwork-health.json` is a rotating HTTP sample, not a visual authenticity or rights check. `catalog/source-watch.json` is a partial inbox of official product references; leads require review before card records are admitted.

## Maintenance

Run `python3 scripts/refresh-catalog.py`, `python3 scripts/watch-catalog-sources.py`, then `python3 scripts/publish-catalog.py --check-images`. Weekly GitHub Actions proposes changes as a PR; it never silently merges a regional identity. Keep reviewed supplements in version control with evidence. Do not reassign IDs or remove printings in a release.

TCGdex metadata is MIT licensed (see `inputs/TCGDEX-LICENSE.txt`). Card artwork and Pokémon trademarks belong to their respective rights holders. Source references are for identity review and do not grant artwork rights. New reference-site artwork is not copied into this repository. See input attribution for the legacy demo metadata.

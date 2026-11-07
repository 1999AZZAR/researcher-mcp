# Changelog

## 4.0.0 — consistent search input

- **Breaking:** `google_search` requires `query`, matching the other text-search tools. `q` is rejected, not translated or retained as an alias. Batch APIs keep `queries`.
- Share strict Google search validation between the shipped and modular entrypoints: non-empty trimmed queries, integer result counts from 1 to 10, and rejection of unknown fields before provider requests.
- Report Google search failures as MCP tool errors. Provider-facing HTTP `q` parameters remain unchanged.

All notable changes to this project.

## Unreleased

### Fixed
- Use the public Zod object output type for tool callbacks, restoring clean builds with the declared Zod 4 dependency while retaining Zod 3 compatibility.

## [3.0.0] - 2026-10-31

### Changed
- **Version reset to 3.0.0** — per-server version metadata baseline reset (Phase 7). All `package.json`, MCP `ServerInfo.version`, and HTTP metadata now report `3.0.0`. This is a metadata/interface baseline reset; for `hela-plastid` it is not an upgrade from the previous `4.2.0` advert.

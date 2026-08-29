# FilmSnaps Documentation

Developer documentation for the FilmSnaps monorepo. These docs reflect the
actual implementation — if code changes, update the matching doc in the same
commit.

| Document                        | Contents                                                                                                                                                                          |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Architecture](architecture.md) | Repository layout, apps, packages, data flow, builds, CI.                                                                                                                         |
| [Security](security.md)         | The full security stack: threat model, R0–R8 cascade, L2–L8 desktop layers, mobile native protection, `providers.json` + `filters.txt` v5 config, Ed25519 OTA, audit diagnostics. |
| [Packages](packages.md)         | The internal workspace packages (`shared`, `adblock-config`, `filter-compiler`) and how to add a new one.                                                                         |

## Architecture decision records (ADR)

| Doc                                  | Decision                                                            |
| ------------------------------------ | ------------------------------------------------------------------- |
| [ADR 0002](adr/0002-auth-removal.md) | Remove the no-op web auth scaffolding — the app is fully anonymous. |

## App documentation

| App      | README                                                  |
| -------- | ------------------------------------------------------- |
| Web      | [`apps/web/README.md`](../apps/web/README.md)           |
| Desktop  | [`apps/desktop/README.md`](../apps/desktop/README.md)   |
| Mobile   | [`apps/mobile/README.md`](../apps/mobile/README.md)     |
| Feedback | [`apps/feedback/README.md`](../apps/feedback/README.md) |

## Other top-level docs

| File                                       | Contents                                                                             |
| ------------------------------------------ | ------------------------------------------------------------------------------------ |
| [`../CONTRIBUTING.md`](../CONTRIBUTING.md) | Setup, dev workflow, adding a provider, editing `providers.json` + `filters.txt` v5. |
| [`../SECURITY.md`](../SECURITY.md)         | Security summary + pointer to the full security doc.                                 |
| [`../README.md`](../README.md)             | Project overview and quick start.                                                    |

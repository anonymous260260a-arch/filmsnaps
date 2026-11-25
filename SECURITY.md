# Security

## Supported versions

| Component         | Supported                                         |
| ----------------- | ------------------------------------------------- |
| Desktop (Windows) | The current build on the `desktop` GitHub release |
| Web               | The production deployment of `main`               |
| Mobile            | The current build produced from `main`            |

Older desktop builds receive no fixes. The in-app updater moves them to the
current release.

## Report a vulnerability

Do not open a public issue, and do not post details in a provider discussion.

Use **Report a vulnerability** on the repository's Security tab. That opens a
private advisory only the maintainers can read. If the option is missing, open a
public issue saying only that you have a security report, and wait for a private
channel to be arranged.

Include:

- which app you tested (desktop, web, mobile) and its version,
- the steps to reproduce,
- what an attacker gains,
- logs, screenshots or proof-of-concept files.

## What to expect

Reports are triaged as maintainer time allows; there is no guaranteed response
time. Confirmed issues are fixed in a release before the details are published,
and the report stays private until then.

## Scope

The security stack — network filtering, cosmetic rules, config signing, update
signing, and the known gaps — is documented in [docs/security.md](docs/security.md).

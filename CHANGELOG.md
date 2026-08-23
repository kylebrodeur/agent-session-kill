# Changelog

All notable changes to **agent-session-kill** are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.1]

### Fixed
- **The CLI now actually runs under an `npm`/`npx` install.** The entry guard
  compared `fileURLToPath(import.meta.url)` (the real `src/cli.js` path) against
  `process.argv[1]` (the `.bin` symlink path). Under a `bin` install those never
  match, so `main()` never ran and **every** command — `scan`, `clean`,
  `--help`, `--version` — silently exited 0 with no output. The guard now
  realpaths both sides before comparing. v0.2.0 was effectively non-functional
  when installed; v0.2.1 is the first working release.

### Added
- `--version` (was undefined and errored as an unknown option), wired through
  the same `exitOverride` path as `--help`.
- `test/bin-entry.test.js` — invokes the CLI through a `.bin`-style symlink the
  way npm does, so the entry guard is exercised by CI. The pre-existing tests
  import `main()` directly and never caught the breakage. Verified this test
  fails against the old guard and passes against the fix.

## [0.2.0]

- Initial public release: interactive `npkill`-style picker, `scan`/`clean`
  commands, dry-run/JSON modes, protected paths, trash-first deletion, and
  coverage of Claude Code, Pi/pi-mono, Oh My Pi, GitHub Copilot Chat, and
  subagent temp storage. (Non-functional as installed — see 0.2.1.)

[0.2.1]: https://github.com/kylebrodeur/agent-session-kill/releases/tag/v0.2.1
[0.2.0]: https://github.com/kylebrodeur/agent-session-kill/releases/tag/v0.2.0

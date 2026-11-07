# Security scan status — public beta

Snapshot: 7 November 2026. CodeQL analysis jobs completed successfully, but the source snapshot has **open alerts that still require triage**. A successful analysis job means the scan ran; it is not a clean vulnerability assessment.

The initial baseline contains **203 open alerts**: 84 high, 119 medium. These are scanner classifications, not a count of confirmed exploitable vulnerabilities.

The scan covers the renderer, Studio, local servers, optional developer tools, skills and test fixtures. The initial review found alerts about temporary files, filesystem races, HTTP/file boundaries, message origins and dynamic code. Some locations are deliberate fixture or rendering behavior; runtime findings also remain and must be reviewed individually. None have been dismissed in bulk.

Use this beta only with **trusted local projects and templates**. Its local servers can read and write project files and launch renders; keep them on loopback. Do not treat this release as a hardened multi-user service or open untrusted HTML projects.

Functional build/render tests and credential scanning are separate checks. The curated Git history was scanned with only reviewed, commit-specific fixture/token exclusions. That does not resolve the CodeQL backlog.

Track findings in [GitHub code scanning](https://github.com/guardyanz/clipclap/security/code-scanning). Report vulnerabilities through [private reporting](https://github.com/guardyanz/clipclap/security/advisories/new). A useful contribution is a narrowly scoped runtime fix, a regression demonstrating its behavior, and a review of the corresponding alert.

## Initial rule counts

| CodeQL rule | Open alerts |
| --- | ---: |
| `js/functionality-from-untrusted-source` | 49 |
| `js/insecure-temporary-file` | 31 |
| `js/http-to-file-access` | 21 |
| `js/file-system-race` | 21 |
| `js/client-side-request-forgery` | 18 |
| `js/polynomial-redos` | 11 |
| `js/file-access-to-http` | 10 |
| `js/bad-tag-filter` | 7 |
| `js/missing-origin-check` | 6 |
| `js/html-constructed-from-input` | 5 |
| `js/incomplete-multi-character-sanitization` | 5 |
| `js/regex/missing-regexp-anchor` | 2 |
| `js/unvalidated-dynamic-method-call` | 2 |
| `js/incomplete-sanitization` | 2 |
| `js/bad-code-sanitization` | 2 |
| `actions/code-injection/medium` | 2 |
| `js/log-injection` | 1 |
| `js/unsafe-code-construction` | 1 |
| `js/shell-command-injection-from-environment` | 1 |
| `js/incomplete-url-scheme-check` | 1 |
| `js/xss-through-exception` | 1 |
| `js/xss-through-dom` | 1 |
| `js/prototype-polluting-assignment` | 1 |
| `js/clear-text-storage-of-sensitive-data` | 1 |
| `actions/unpinned-tag` | 1 |

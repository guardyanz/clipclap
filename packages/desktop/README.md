# ClipClap for Windows

The Electron app opens the local template wizard and full Studio editor. It bundles the template/block registries, CLI runtime and FFmpeg. Local servers bind to `127.0.0.1` on random ports. A Chromium rendering runtime is downloaded on first use when needed.

## Build from a fresh clone

Use Windows x64, Node.js 22+, Bun 1.3.14, Python 3.11+ and Git LFS. From the repository root:

```sh
git lfs pull
bun install --frozen-lockfile
bun run build:clipclap
python scripts/prepare-clipclap-ffmpeg.py
bun run --filter @hyperframes/desktop dist
```

The ordered build prepares workspace dependencies before their consumers. The Python helper downloads a pinned FFmpeg archive, verifies SHA-256 and stages the executables with their license/provenance. See [runtime and source details](../../docs/clipclap/FFMPEG.md). No binaries or generated installers are committed.

Output: `packages/desktop/release/ClipClap-Setup-0.1.0-beta.1.exe`. The unpacked test application is under `packages/desktop/release/win-unpacked/`.

## Use the application

**Easy Mode** opens the template picker and editable form. **Full Editor** opens Studio's live preview and timeline. Choose either mode from the ClipClap menu. Source-checkout development also works with `bun run --filter @hyperframes/desktop dev` after the ordered build.

## Beta limits

- Windows x64 only; no macOS or Linux desktop package is offered yet.
- The installer is unsigned and uses Electron's default application icon. Verify release checksums before installing.
- The first browser download and templates using remote fonts/media need internet. Local rendering does not require a paid AI provider; optional AI motion uses your own key.
- Source-regression fixtures are separate from packaged template assets. Generated test renders and local user projects are not shipped.

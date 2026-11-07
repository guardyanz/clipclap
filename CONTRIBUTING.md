# Contributing to ClipClap

Use Bun for workspace operations, Node.js 22+, FFmpeg and Chromium. Start with the source build in README.md.

```sh
bun run --cwd packages/cli test -- src/utils/loopSeam.test.ts src/registry/resolver.test.ts src/server/wizardServer.public.test.ts
bun run --filter @hyperframes/desktop build
bunx oxlint <changed-files>
bunx oxfmt --check <changed-files>
```

Run the relevant package tests for functional changes. Verify a real render after changing templates or capture behavior. New HTML compositions must pass `clipclap check` before screenshots or rendering. Keep motion deterministic and use the upstream composition contract.

Helpful contributions include form-driven templates, Windows packaging, accessible keyboard navigation, offline resource handling and reproducible provider-free regressions. Include a screenshot for visible UI changes and an exact command for render failures.

Keep pull requests focused. Preserve Apache-2.0 and third-party asset notices. Never include API keys, user projects, installers, node_modules, private handoffs or generated regression outputs. The private migration workspace is not the development upstream of this public repository; use public commits here for future work.

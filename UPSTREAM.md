# Upstream and downstream scope

ClipClap is a curated downstream of https://github.com/heygen-com/hyperframes, distributed under Apache-2.0. It is not an official HeyGen product.

The initial public snapshot is based on workspace commit `7b496df4540e71dc4c266a00d9a5829dee42b7c3`. Original copyright, license files, package names and asset notices are retained. Private workspace history and handoff documents are not included in the public repository.

Downstream additions include the Electron Windows shell, beginner wizard, offline registry integration, Studio consumer mode and orientation picker, loop seam checks, ambient-loop template and photo-gallery template. Subsequent public changes are visible in this repository's commit history.

Upstream deployment, package-publishing, community notification and internal infrastructure workflows are intentionally not installed in this fork. CI here verifies the ClipClap distribution. Generated upstream video regression outputs are not distributed as source; render fixtures must be regenerated when using the upstream integration harness.

The internal `@hyperframes/*` package names remain for compatibility. They do not imply npm ownership or upstream endorsement. Compare source and report upstream framework issues to the original project when appropriate; report ClipClap packaging and wizard problems here.

# Security

Report vulnerabilities through [GitHub private vulnerability reporting](https://github.com/guardyanz/clipclap/security/advisories/new). Include the affected version and minimal reproduction. Keep credentials and exploitable details out of public issues.

ClipClap is a public beta. Its local servers bind to loopback and can read project files and launch renders. Keep them local and open only templates and projects you trust. AI motion is optional; its API key is stored in the local browser profile and sent when you request generation. Remove it from that profile when using a shared computer.

The Windows installer is currently unsigned. Verify release checksums before installing. Third-party runtimes retain their own licenses and update schedules.

CodeQL completed its initial scan with open findings across runtime code and developer fixtures. See the [initial security baseline](docs/clipclap/SECURITY_STATUS.md). Functional CI success is separate from security triage.

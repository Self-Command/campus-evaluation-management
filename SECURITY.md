# Security Policy

## Supported versions

| Version | Supported |
| --- | --- |
| `0.1.x` (latest release) | Yes |
| Older tags and `main` snapshots | Best effort only |

## Reporting a vulnerability

Please **do not** open a public Issue, Discussion or pull request for a suspected vulnerability.

Use GitHub's private vulnerability reporting:

1. Open the repository's **Security** tab.
2. Choose **Report a vulnerability**.
3. Include affected version or commit, deployment topology, reproduction steps, impact and any suggested mitigation.

If private reporting is unavailable, contact the repository owner through the contact method listed on their GitHub profile and ask for a private channel before sharing details.

Please never include production credentials, session cookies, personal data, database dumps or evidence attachments in a report. Use synthetic data and redact secrets.

## Scope

Reports are especially relevant for:

- Authentication bypass, captcha or login-throttling bypass, session fixation or revocation failure.
- Privilege escalation or cross-college / cross-class / cross-student access.
- Insecure direct object references in results, evidence, attachments, exports or audit records.
- SQL injection, unsafe deserialization or spreadsheet formula injection.
- Path traversal, unrestricted upload, content-type confusion or unauthorized file download.
- Transaction, idempotency or concurrency flaws that can corrupt grades, deductions, rosters or publications.
- Container escape, secret disclosure or supply-chain issues in the published image.

The following are generally out of scope unless they demonstrate concrete impact:

- Missing security headers with no exploit path.
- Rate limiting on non-sensitive endpoints.
- Automated scanner output without a reproducible proof of impact.
- Social engineering, physical access or denial-of-service against shared infrastructure.
- Vulnerabilities in third-party services outside this repository.

## Handling expectations

We aim to acknowledge a complete report within three business days, validate it, and coordinate a fix and disclosure timeline with the reporter. Timelines depend on severity and deployment impact. Please allow a reasonable remediation window before public disclosure.

## Deployment responsibilities

This repository provides secure defaults, but operators remain responsible for:

- Serving the application over HTTPS through a trusted reverse proxy.
- Keeping `NEXTAUTH_SECRET`, database credentials and `.env.docker` out of version control and backups that are not encrypted.
- Restricting database and application ports to trusted networks.
- Applying image and dependency updates, and monitoring the CI and image-publish workflows.
- Taking and testing backups of the database, evidence volume and attachment volume.
- Configuring institutional logging, monitoring, retention and access review.

## Legacy versions

Only the latest release line receives security fixes. If you deploy an older image or commit, upgrade to the latest published image before reporting an issue that may already be fixed.

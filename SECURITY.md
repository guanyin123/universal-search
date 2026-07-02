# Security Policy

## Supported versions

This project is in active early development. Security fixes are applied to the
latest `main` branch. There is no long-term-support branch yet.

## Reporting a vulnerability

**Please do not open a public issue for security vulnerabilities.**

Instead, use GitHub's private vulnerability reporting:

1. Go to the repository's **Security** tab.
2. Click **Report a vulnerability**.
3. Describe the issue, steps to reproduce, and potential impact.

You'll receive an acknowledgement, and we'll work with you on a fix and
coordinated disclosure. Thank you for helping keep users safe.

## Handling of secrets and keys

- API keys you configure in-app are stored **encrypted at rest** in a local
  SQLite database under `.data/` (never committed — it's gitignored).
- The app talks to third-party services (Tavily, your LLM provider, and any
  optional providers you enable). Review each provider's terms; the project
  never transmits your keys anywhere except to the provider you configure.
- Never commit a real `.env`. Use `.env.example` (placeholders only) to document
  configuration.

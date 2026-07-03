# Security Policy

This project is now marketed as openZetcX. During the rename transition, the repository and security-reporting URLs intentionally remain on the legacy `openZetcX` GitHub path.

## Reporting a Vulnerability

If you discover a security vulnerability, please report it through GitHub:

- Open a private vulnerability report in the repository Security tab when available:
  https://github.com/TomPrestonWernerp/openZetcX/security
- If private reporting is not available, open an issue:
  https://github.com/TomPrestonWernerp/openZetcX/issues

Please include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact

I will respond within 72 hours and work with you on a fix before public disclosure.

## Scope

- Sandbox escape (PathGuard / Seatbelt bypass)
- Credential leakage
- Remote code execution
- Cross-site scripting in the Electron renderer

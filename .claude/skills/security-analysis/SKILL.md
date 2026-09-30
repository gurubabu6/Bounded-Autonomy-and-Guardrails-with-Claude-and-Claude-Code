---
description: Security-focused code review covering OWASP Top 10, secrets, input validation, auth and payment flows
---

# Security Analysis

## Check for
- Injection: string-built SQL/shell/HTML, eval, innerHTML with user data (XSS)
- Broken auth or access control: missing checks, client-side-only premium/role checks
- Secrets: API keys, tokens or passwords in source; secrets logged
- Sensitive data in plaintext storage (localStorage for tokens or payment data)
- Unvalidated input, ReDoS-prone regexes, unsafe JSON.parse of untrusted data
- Payments: trusting client-provided price, plan or status

## Severity
critical = exploitable now; high = missing validation/auth on sensitive flow; medium = weak practice; low = hardening.
Report exact line, attack scenario and a concrete fix.

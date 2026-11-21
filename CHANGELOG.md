# Changelog

## 0.1.0

First release.

- Ktemia node with Lookup, Flight, Hotel, Car, and Account resources: 15 operations covering the whole Ktemia API.
- Ktemia API credential with a free credential test (`GET /key`).
- Usable as an AI Agent tool.
- Retries `RATE_LIMIT_EXCEEDED` after `Retry-After`, never retries `QUOTA_EXCEEDED`, and retries 5xx once.
- Checks dates, codes, and counts before calling the API, so input mistakes cost no quota.

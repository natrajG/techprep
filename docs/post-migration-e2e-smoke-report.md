# Production smoke test after Lightsail upgrade

**Date:** 2026-11-18  
**Environment:** https://interviewassistant.in on `techprep-prod-small` (`small_3_1`, 2 GB RAM); Chrome desktop and mobile, plus authenticated API requests  
**Result:** Core web journeys passed. One pre-existing account-deletion defect was confirmed. This is a representative end-to-end smoke test, **not** certification that every feature works.

| Journey / check | Result | What was verified |
|---|---|---|
| Service availability | Pass | HTTPS `/health` returned `status: ok`; API container healthy and Caddy running after the migration. |
| Account and session | Pass | Disposable signup, login, dashboard access, session persistence on reload, sign-out, re-login, and session rotation. |
| Resume and ATS scoring | Pass | Uploaded a synthetic PDF, extracted its content, generated an ATS score, and retrieved the ATS report. Resume rebuilding/export was not exercised in this pass. |
| Job search | Pass | Resume-driven search, role/location suggestions, profile save/reload, fresh and cached search, and 20 rendered cards with readable snippets. |
| Interview practice | Pass | Generated mock interview questions. Live microphone recording, transcription, and feedback were not exercised. |
| History | Pass | Created, searched, and deleted a history entry. |
| Download | Pass / partial | Authenticated macOS installer ranged **GET** returned HTTP 206 with a DMG content type; the Windows download points to the configured Microsoft Store page. Neither installer was run on its target OS. |
| Mobile entry | Pass | At 390 px, the navigation menu exposed Sign in, opened the login dialog, and had no horizontal page overflow. |
| Negative paths | Pass | Unauthenticated access was rejected and invalid job-search input was rejected. |
| Automated backend regression | Pass | 213 tests and 74 subtests passed; two dependency deprecation warnings. This tests the local source, not a second production instance. |

**Installer test correction:** Initial `HEAD` probes returned 404 because these routes implement `GET`. The successful authenticated macOS ranged `GET` is the applicable download check; the `HEAD` response is not counted as a product defect.

## Confirmed defect

**Medium — Admin account deletion leaves job-search data behind.** After deleting disposable user `qaup1795018244` using `admin.delete_user`, one `job_search_profiles` row for that username remained. The deletion loop in `services/api-fastapi/app/admin.py` (`delete_user`, around lines 331–358) omits `job_search_profiles`, `job_search_cache`, and associated cache items while reporting that all associated data was deleted. This can retain user preferences after account deletion. Delete the user's dependent cache items, cache rows, and profile within the same database transaction as the rest of the account data, then add a regression test that verifies none remain. The three disposable accounts and their job-search records were subsequently removed and their absence verified; no real-user records were changed.

## Coverage limits

Payments and checkout were intentionally excluded. Real Google OAuth consent, password-reset email delivery, native Windows/macOS installation and live audio, microphone-based interview feedback, admin-only UI flows, and resume rebuild/export were **not** verified end to end. These require external accounts, target hardware, privileged access, or payment-gated interaction; their status is **untested**, not passed. The retained pre-upgrade snapshot was not deleted.

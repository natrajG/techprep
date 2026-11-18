# Job Search Card — Live Usability & UI Test Report

| | |
|---|---|
| **Feature under test** | Job Search card (`#job-search`), live production site |
| **URL tested** | https://interviewassistant.in/#job-search |
| **Scope** | Resume-based auto-fill (role/country/location/skills), job provider results (Jooble/Adzuna/USAJOBS), Apply buttons, chips, bulk-select, mobile layout |
| **Out of scope** | Payments/subscription checkout |
| **Test type** | Live exploratory usability/UI testing (desktop + mobile), via disposable self-signup test accounts |
| **Tested by** | Test Engineer (AI-assisted QA pass) |
| **Date** | 2026-11-18 |
| **Environment** | Production (https://interviewassistant.in), Chrome via Playwright, desktop (1440×900) and mobile (390×844, touch) viewports |

---

## 1. Executive Summary

Live testing on production **confirms all of the defects you originally reported, plus one new one found during this pass**. Fixes for the first three are already written and verified locally (backend 212/212 tests + frontend build passing) but have **not yet been deployed** — that's why production still shows the bugs below. Deploying `scripts/push-to-live.sh` will resolve items #1–#3 immediately.

| # | Defect | Severity | Status |
|---|---|---|---|
| 1 | Country auto-fills "United States" instead of the resume's actual country | 🔴 High | Fixed locally, **not deployed** |
| 2 | Location auto-fills a skill/company name (e.g. "Python", "Qvantel") instead of the real city | 🔴 High | Fixed locally, **not deployed** |
| 3 | Job description snippets show raw HTML (`&nbsp;`, `<b>`, `</b>`) | 🟡 Medium | Fixed locally, **not deployed** |
| 4 | "Apply on Jooble/Adzuna/USAJOBS" button has no color/branding | 🟡 Medium | Fixed locally, **not deployed** |
| 5 | `#job-search` deep link does not scroll to the Job Search section (new finding) | ⚪ Low | Not yet fixed |

No blocking crashes, data loss, or security issues were found. Mobile layout is responsive and usable; bulk-select, chip-removal, and "Refresh from sources" controls are all present and render correctly.

---

## 2. What Was Tested

| Area | Conditions covered |
|---|---|
| Deep link / navigation | `#job-search` anchor from anonymous landing page and from an authenticated session |
| Resume-based auto-fill | Pasted resume text containing a city name plus words that look like a country/location ("usage", "expertise in Python", a company name appearing before "in <City>") |
| Country field | Explicit country mention vs. no explicit country mention (relies on city only) |
| Location chips | Auto-filled chips, manual add/remove ("×" button) |
| Job result cards | Apply button styling, description snippet rendering, source badge, salary/relevance chips |
| Bulk actions | "Select all", "Open selected applications" |
| Other controls | "Refresh from sources", skills field, role chips |
| Mobile viewport (390×844, touch) | Hamburger menu → sign in/sign up flow, dashboard layout, job card readability, no horizontal overflow |

---

## 3. Detailed Findings

### 3.1 Defect — Country defaults to "United States" (🔴 High)

**Steps:**
1. Sign in, paste a resume that mentions a city (e.g. "Hyderabad") but never spells out the country, and contains the word "usage" somewhere in the text.
2. Open the Job Search card.

**Observed:** Country field shows **"United States"**.
**Expected:** Country should reflect the resume's actual country (India, based on the city), or be left blank if truly ambiguous.

**Evidence:** `evidence/job-search-qa/23_filters_box.png`

**Root cause:** `_infer_country_code()` in `job_search.py` matched the U.S. alias `"usa"` as a plain substring, so it falsely matched inside unrelated words like "us**a**ge". This also masked the correct India match purely by code-path ordering.

**Fix (already implemented locally, pending deploy):** Replaced substring matching with boundary-safe regex alias matching (`_alias_pattern()` / `_COUNTRY_ALIAS_PATTERNS`), so aliases only match whole words.

---

### 3.2 Defect — Location defaults to a skill name or company name (🔴 High)

**Steps:** Same resume as above, which contains "...expertise in Python..." and a company name ("Qvantel") appearing before the real city in the text.

**Observed:** Locations field shows a chip for **"Python"** (a skill, not a place) alongside the correct "Hyderabad" chip (see `evidence/job-search-qa/32_desktop_filters_chips.png`); in an earlier run, it showed **"Qvantel"** (a company name) instead of the real city (see `evidence/job-search-qa/23_filters_box.png`).

**Expected:** Only real place names should populate the Locations field.

**Root cause:** The location-guessing regex matched any capitalized word following "in"/"at", which also matches skill names ("in Python") and company names ("at Qvantel").

**Fix (already implemented locally, pending deploy):** Added an exclusion list of known skills/tools/process words (`_LOCATION_FALSE_POSITIVES`), and the reliable city-hint based match now always takes priority over the weaker regex-based guess (which is only used as a fallback when no city hint is found).

**Real-world impact observed:** With the wrong location, the job results returned a "Software Engineer" role in **Saint Louis, MO, USA** — irrelevant for a Hyderabad-based candidate. This directly explains the 71→78 ATS-score-adjacent confusion you flagged; the job matching, not the resume content, was misfiring.

---

### 3.3 Defect — Raw HTML/entities leak into job description snippets (🟡 Medium)

**Observed:** Job card descriptions show literal text like `&nbsp;...Employer of Record (EOR)... <b>Backend Engineer </b> in India...&nbsp;&nbsp;...` instead of clean, readable text.

**Evidence:** `evidence/job-search-qa/24_card_zoom.png`, `evidence/job-search-qa/29_mobile_card_zoom.png` (reproduced on both desktop and mobile).

**Root cause:** Adzuna/Jooble/USAJOBS return descriptions with embedded HTML tags and entities; the app only normalized whitespace, not markup.

**Fix (already implemented locally, pending deploy):** Added `_clean_snippet()` (strips HTML tags, decodes entities via `html.unescape`) and applied it to all three providers' snippet fields.

---

### 3.4 Defect — "Apply on Jooble/Adzuna/USAJOBS" button has no color (🟡 Medium)

**Observed:** The Apply button renders as a plain, low-contrast bordered button with no brand color, making it hard to notice as the primary call-to-action on the card.

**Evidence:** `evidence/job-search-qa/24_card_zoom.png`

**Fix (already implemented locally, pending deploy):** Added `applyButtonStyle()` with a distinct gradient color per source (Jooble/Adzuna/USAJOBS) plus a new `.tp-apply-btn` class with hover lift/brightness.

---

### 3.5 New finding — `#job-search` deep link does not scroll into view (⚪ Low)

**Steps:** Navigate directly to `https://interviewassistant.in/#job-search` both as an anonymous visitor and as a signed-in user.

**Observed:**
- Anonymous: no element with `id="job-search"` exists on the public landing page at all — the link is a dead anchor until login.
- Signed-in: the dashboard loads, but the page stays scrolled at the top ("Welcome back...") instead of auto-scrolling to the Job Search section. See `evidence/job-search-qa/30_mobile_top.png`.

**Likely cause:** The Job Search section renders after an async data fetch completes, so the browser resolves the `#job-search` hash-scroll before the target element exists in the DOM.

**Suggested fix (not yet implemented):** After the dashboard's initial data load, programmatically scroll to `document.getElementById('job-search')` if `location.hash === '#job-search'`.

---

## 4. What's Working Correctly

- Signup → login → authenticated dashboard flow works with no blocking defects.
- Resume paste → auto-fill → "Search jobs" → results pipeline completes successfully and results persist with a "Saved results · 24h cache" badge on reload.
- Role/skill chips, "×" remove buttons, "Select all" checkbox, and "Open selected applications" bulk action all render and are clickable.
- "Refresh from sources" link is present and reachable.
- Mobile layout (390×844) is fully responsive: no horizontal overflow, hamburger menu reveals sign-in correctly once the menu button (a small untitled icon button in the header, not the visible desktop "Sign in" button) is tapped, and job cards remain readable at the narrow width.
- When the resume explicitly names the country (e.g., "India" appears in the text), the country field resolves correctly — the bug only triggers when the resume relies on an implied/city-based country, which matches your real resume's phrasing.

---

## 5. Test Environment Notes

- Testing was performed using **disposable, self-signed-up test accounts** on the live production site (e.g. `qajobsearch1794988296@...`), per your approval, since the `#job-search` dashboard view requires authentication. No real user data was touched.
- Production auto-grants a "PRO"/active-subscription badge on signup (appears to be a free trial) — not evaluated as a defect since payments are out of scope.
- All four confirmed defects are **already fixed in the local codebase** (`services/api-fastapi/app/job_search.py`, `frontend/react-web/src/JobSearchPanel.jsx`, `frontend/react-web/src/design-system.css`) and verified via the full backend test suite (212/212 passing) and a production frontend build. They have not yet been pushed live via `scripts/push-to-live.sh`.

---

## 6. Recommendation

**Deploy the existing local fixes** (items #1–#4) via `scripts/push-to-live.sh` — this is the single action that will resolve the majority of what you reported. Item #5 (anchor scroll) is a minor, separate UX issue that can be scheduled independently.

---

## Follow-up — 2026-11-18

The findings above describe the original QA pass. Those changes were subsequently deployed, but the HTML defect persisted for previously cached descriptions and multiply encoded provider markup. A further local fix now cleans both newly ingested and cached snippets, and the job cards have been redesigned into compact white cards with a short preview, source label, available job metadata, posting date, and a visible Apply action. The provider does not supply ratings, experience ranges, Save, or Hide actions, so these are not shown as if they were real data or working controls.

Preview screenshots: [desktop](evidence/job-search-qa/job-card-preview.png) and [mobile](evidence/job-search-qa/job-card-mobile-preview.png). The user approved this follow-up for deployment on 2026-11-18.

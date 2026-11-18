# ATS Resume Builder — Test Result Report

| | |
|---|---|
| **Feature under test** | ATS Resume Builder (Free Score Check, AI Rebuild, Document Export) |
| **Scope** | `resume_builder.py` (ATS scoring), `resume_rebuild.py` (AI rewrite + changes summary), `resume_renderer.py` (PDF/DOCX/RTF/DOC export) |
| **Out of scope** | Payments / Razorpay checkout and entitlement flows (`resume_payment.py`) — excluded per request |
| **Test type** | Functional, negative/security, boundary, regression, exploratory |
| **Tested by** | Lead Test Engineer (AI-assisted QA pass) |
| **Date** | 2026-11-18 |
| **Environment** | Local backend (FastAPI + SQLite, isolated test DB), WeasyPrint PDF rendering, mocked LLM responses |

---

## 1. Executive Summary

Two feature areas were tested end to end: the **free ATS score check** and the **AI resume rebuild** (including the newly added "what changed" summary), plus the underlying **document renderer**.

- **212** pre-existing automated regression tests: **all passing**.
- **40** new exploratory test cases designed for this review (positive, negative, security, boundary, and regression): **all passing** after one test-script correction (see §4).
- **2 real defects were found earlier in this engagement and are already fixed and verified** (see §5) — they are included here for completeness because they affect the areas tested.
- **No new defects were found** in this pass. The feature is functioning as designed for the scenarios covered below, including hostile/malformed input handling.

**Overall status: ✅ READY** (within tested scope; payments not assessed).

---

## 2. What Was Tested

| Area | Examples of conditions covered |
|---|---|
| Free ATS Score Check (`/analyze`) | Strong vs. weak resumes, with/without a job description, duplicate-request caching, empty/whitespace input, oversized input, unauthenticated access, HTML/script injection, non-Latin script + emoji, cross-user data access, daily rate limiting, scoring boundary conditions |
| AI Resume Rebuild (`/rebuild`, `/rebuild/{id}`) | Successful rebuild end-to-end, empty input, unauthenticated access, AI service unavailable, AI returning broken/garbage JSON, AI returning the wrong data shape, AI call throwing a network error, a fully blank AI response, cross-user data access, prompt-injection text in the resume, HTML/script content in AI output, daily rate limiting, free-tier content redaction ("teaser") |
| Document Export (PDF/DOCX/RTF/DOC) | Full resume data, minimal data, fully blank data, HTML/script content, non-Latin script + emoji, RTF special characters, large volume (150 bullet points), two prior defects re-verified as fixed |
| "What Changed" Summary (new feature) | No-change case (no false positives), diffing against an empty original resume, rebuilt resume with no experience entries |

---

## 3. Results Summary

| Suite | Total | Passed | Failed | Notes |
|---|---|---|---|---|
| Existing automated regression suite (`test_resume_builder.py`, `test_resume_rebuild.py`, plus full backend suite) | 212 | 212 | 0 | Run via `pytest`, includes payment tests not otherwise assessed in this report |
| New exploratory test pass (this report) | 40 | 40 | 0 | 1 test required a correction to its own setup, not a product defect (see §4) |
| **Total distinct checks in this report** | **40** | **40** | **0** | |

### 3.1 Detailed Results — Free ATS Score Check

| ID | Test | Type | Result |
|---|---|---|---|
| A1 | Strong resume + job description scores correctly; category totals match the overall score | Positive | ✅ PASS |
| A2 | Weak resume with no job description still scores using baseline keywords | Positive | ✅ PASS |
| A3 | Identical resume + JD is served from cache on the 2nd identical request | Positive | ✅ PASS |
| A4 | Empty resume is rejected | Negative | ✅ PASS |
| A5 | Whitespace-only resume is rejected with a clear message | Negative | ✅ PASS |
| A6 | Request without a login token is rejected (401) | Negative | ✅ PASS |
| A7 | Resume text over the 20,000-character limit is rejected | Negative | ✅ PASS |
| A8 | Job description over the 20,000-character limit is rejected | Negative | ✅ PASS |
| A9 | Resume containing `<script>`/HTML tags does not crash the scorer | Negative/Security | ✅ PASS |
| A10 | Non-Latin script (Telugu) + emoji resume scores without crashing; email still detected | Positive | ✅ PASS |
| A11 | Requesting a report for a non-existent analysis ID returns 404 | Negative | ✅ PASS |
| A12 | User B cannot view User A's saved analysis report (access-control check) | Negative/Security | ✅ PASS |
| A13 | Daily limit of 30 score checks per user is enforced (429 after the limit) | Negative | ✅ PASS |
| A14 | 150-word "too short" formatting boundary behaves exactly as documented | Boundary | ✅ PASS |

### 3.2 Detailed Results — AI Resume Rebuild

| ID | Test | Type | Result |
|---|---|---|---|
| B1 | Well-formed rebuild returns before/after scores, a locked preview, and the new changes summary | Positive | ✅ PASS |
| B2 | Empty resume to rebuild is rejected | Negative | ✅ PASS |
| B3 | Request without a login token is rejected (401) | Negative | ✅ PASS |
| B4 | AI service not configured returns a friendly error, no internal details leaked | Negative | ✅ PASS |
| B5 | AI returns syntactically broken JSON — handled as a clean error, not a server crash | Negative | ✅ PASS |
| B6 | AI returns valid JSON in the wrong shape — handled as a clean error, not a server crash | Negative | ✅ PASS |
| B7 | AI call fails with a network error — handled as a clean error, not a server crash | Negative | ✅ PASS |
| B8 | AI returns a completely empty resume — rejected by the ATS-readability safeguard | Negative | ✅ PASS |
| B9 | Fetching a non-existent rebuilt version returns 404 | Negative | ✅ PASS |
| B10 | User B cannot view User A's rebuilt resume (access-control check) | Negative/Security | ✅ PASS |
| B11 | Text designed to look like an instruction ("ignore previous instructions…") is treated as data, not followed | Negative/Security | ✅ PASS |
| B12 | `<script>` content returned by the AI is safely escaped in the generated document, never executable | Security | ✅ PASS |
| B13 | Daily limit of 10 rebuilds per user is enforced (429 after the limit) | Negative | ✅ PASS |
| B14 | Unpaid users see score changes but not the full rewritten text (paywall integrity) | Positive | ✅ PASS |

### 3.3 Detailed Results — Document Export (PDF/DOCX/RTF/DOC)

| ID | Test | Type | Result |
|---|---|---|---|
| C1 | Full resume data exports to valid, readable PDF/DOCX/RTF/DOC | Positive | ✅ PASS |
| C2 | Minimal data (name only) exports without errors | Positive | ✅ PASS |
| C3 | Completely blank data still produces a file rather than crashing | Boundary | ✅ PASS |
| C4 | HTML/script characters anywhere in the resume are escaped in the output, never raw | Security | ✅ PASS |
| C5 | **Regression** — words like "Telecom"/"Testing"/"TypeScript" are no longer split into two words on export (previously fixed defect, re-verified) | Regression | ✅ PASS |
| C6 | **Regression** — job/education dates stay in correct reading order next to their title, no longer jumping to the top of the document (previously fixed defect, re-verified) | Regression | ✅ PASS |
| C7 | Non-Latin script (Telugu) + emoji content exports without errors | Edge | ✅ PASS |
| C8 | Special RTF characters (braces, backslashes) in user content are escaped correctly | Edge | ✅ PASS |
| C9 | A resume with 150 bullet points exports within an acceptable time (under 10 seconds) | Performance | ✅ PASS |

### 3.4 Detailed Results — "What Changed" Summary (new feature)

| ID | Test | Type | Result |
|---|---|---|---|
| D1 | No real score change produces zero reported changes (no false positives for management/user trust) | Positive | ✅ PASS |
| D2 | Diffing against an empty original resume correctly labels all content as newly added | Edge | ✅ PASS |
| D3 | A rebuild with no experience section at all does not crash the diff logic | Edge | ✅ PASS |

---

## 4. Test Execution Notes

One test (A3 — cache behavior) initially reported a false failure because the test script reused the exact same resume text from an earlier test case under the same user, so the system correctly treated *both* calls as cache hits. This was a flaw in the test's own setup, not in the product. The test was corrected to use a unique resume variant, and it then passed as expected. **No product defect was involved.**

---

## 5. Defects Found and Fixed During This Engagement

These two defects were identified earlier in the same engagement (via direct comparison of a real user-submitted "before" and "after" resume PDF) and have already been **fixed, re-tested, and confirmed resolved** (see regression tests C5 and C6 above). Included here for a complete record.

### Defect 1 — Rewritten words split apart on export (e.g. "Telecom" → "T elecom")

- **Severity:** High — directly undermines the product's core promise of ATS-safe, machine-readable output.
- **Component:** `services/api-fastapi/app/resume_renderer.py`
- **Technical root cause:** The PDF CSS left font kerning/ligatures enabled. For a capital "T" followed by a lowercase vowel (e.g. "Te", "Ty"), the font's kerning pair produces a large, invisible glyph-spacing adjustment in the PDF's internal text layout data. Text-extraction tools — including the app's own ATS re-scoring step and real-world ATS parsers — read that spacing gap as a word break, splitting "Telecom" into "T" and "elecom" even though it looks correct visually.
- **Fix:** Added `font-kerning: none; font-variant-ligatures: none;` to the renderer's CSS.
- **Verification:** Regression test C5 renders a resume containing "Telecom", "Testing", and "TypeScript" and confirms none of them are split on export.

### Defect 2 — Job/education dates extracted out of order (e.g. appearing above the candidate's name)

- **Severity:** High — corrupts the reading order a real ATS parser relies on; was also feeding corrupted text into the app's own re-scoring step.
- **Component:** `services/api-fastapi/app/resume_renderer.py`
- **Technical root cause:** Dates (e.g. "April 2016 – Present") were positioned using CSS `float: right`, which removes an element from the normal document flow. While it looks correctly positioned visually, the underlying PDF text stream recorded that floated content *out of sequence* — in one reproduced case, the date was written into the document's text data before the candidate's own name.
- **Fix:** Replaced the floated layout with a flexbox row, which keeps the title and date in the same line, in the correct source order, while preserving the identical visual layout.
- **Verification:** Regression test C6 confirms the candidate's name always appears before the job date in the extracted text.

---

## 6. Risks / Items Not Covered

- **Payment and entitlement flows** (Razorpay order creation, signature verification, unlock duration) were explicitly excluded from this pass per the request and should be tested separately.
- **Live LLM behavior** was tested using simulated (mocked) AI responses to reliably exercise error paths (invalid JSON, wrong shape, network failure) and security scenarios (prompt injection); it does not substitute for periodic testing against the real AI provider for output quality/tone.
- **Font-rendering edge cases** for scripts beyond Telugu (e.g. Arabic, CJK) were not individually verified and may warrant a follow-up pass if the user base requires them.
- **Multi-worker/concurrency race conditions** on rate limits were not load-tested under true concurrent traffic.

---

## 7. Recommendation

The ATS Resume Builder's scoring, AI rebuild, and document export functionality passed all 40 targeted test cases plus the full 212-test automated regression suite, with no outstanding defects. The two previously-identified rendering defects are confirmed fixed and now have permanent regression coverage. Recommend proceeding, with a follow-up QA pass specifically on the payment/entitlement flow before that area is considered release-ready.

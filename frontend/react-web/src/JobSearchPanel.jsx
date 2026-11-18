import { useEffect, useMemo, useRef, useState } from "react";
import Icon from "./Icon";
import { searchJobs, suggestJobSearch } from "./job-search.mjs";

const API = import.meta.env.VITE_API_URL || "";
const notifyExpired = () => window.dispatchEvent(new Event("auth-expired"));
const ATS_GATE_STORAGE_KEY = "ats_gate";

const COUNTRIES = [
  { code: "in", name: "India" },
  { code: "us", name: "United States" },
  { code: "gb", name: "United Kingdom" },
  { code: "ca", name: "Canada" },
  { code: "au", name: "Australia" },
  { code: "sg", name: "Singapore" },
  { code: "de", name: "Germany" },
  { code: "fr", name: "France" },
  { code: "nl", name: "Netherlands" },
  { code: "ae", name: "United Arab Emirates" },
];

const COUNTRY_FLAGS = {
  in: "🇮🇳",
  us: "🇺🇸",
  gb: "🇬🇧",
  ca: "🇨🇦",
  au: "🇦🇺",
  sg: "🇸🇬",
  de: "🇩🇪",
  fr: "🇫🇷",
  nl: "🇳🇱",
  ae: "🇦🇪",
};

const POPULAR_ROLES = [
  "Full Stack Engineer",
  "Backend Developer",
  "Frontend / React",
  "Cloud & DevOps",
  "AI / Machine Learning",
  "Data Engineer",
];

const CITY_SUGGESTIONS = {
  in: ["Bengaluru", "Hyderabad", "Pune", "Chennai", "Mumbai", "Delhi", "Noida", "Gurugram", "Kolkata", "Ahmedabad"],
  us: ["New York", "San Francisco", "Seattle", "Austin", "Boston", "Chicago", "Los Angeles", "Atlanta", "Dallas", "San Diego"],
  gb: ["London", "Manchester", "Birmingham", "Leeds", "Bristol", "Edinburgh", "Glasgow", "Liverpool", "Reading", "Cambridge"],
  ca: ["Toronto", "Vancouver", "Montreal", "Ottawa", "Calgary", "Waterloo", "Edmonton", "Quebec City", "Winnipeg", "Halifax"],
  au: ["Sydney", "Melbourne", "Brisbane", "Perth", "Canberra", "Adelaide", "Gold Coast", "Newcastle", "Hobart", "Darwin"],
  sg: ["Singapore"],
  de: ["Berlin", "Munich", "Hamburg", "Frankfurt", "Stuttgart", "Cologne", "Dusseldorf", "Leipzig"],
  fr: ["Paris", "Lyon", "Toulouse", "Marseille", "Lille", "Nantes", "Bordeaux", "Nice"],
  nl: ["Amsterdam", "Rotterdam", "Utrecht", "Eindhoven", "The Hague", "Groningen", "Leiden"],
  ae: ["Dubai", "Abu Dhabi", "Sharjah", "Ajman", "Ras Al Khaimah"],
};

const ALL_CITY_SUGGESTIONS = Array.from(
  new Set(Object.values(CITY_SUGGESTIONS).flat()),
);

function countryCodeFromName(name) {
  const normalized = (name || "").trim().toLowerCase();
  return COUNTRIES.find((country) => country.name.toLowerCase() === normalized)?.code || "";
}

function countryNameFromCode(code) {
  return COUNTRIES.find((country) => country.code === (code || "").toLowerCase())?.name || "";
}

function searchProfileKey(user) {
  return `tp:${(user || "").toLowerCase()}:job-search-profile`;
}

function loadSearchProfile(user) {
  try {
    const raw = localStorage.getItem(searchProfileKey(user));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

function toSkillList(raw) {
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 20);
}

function resumeFingerprint(text) {
  const source = (text || "").trim();
  let hash = 0;
  for (let i = 0; i < source.length; i += 1) {
    hash = ((hash << 5) - hash + source.charCodeAt(i)) | 0;
  }
  return `${source.length}:${Math.abs(hash)}`;
}

function readAtsGateState(resume) {
  const trimmed = (resume || "").trim();
  if (!trimmed) {
    return { allowed: false, message: "Upload your resume first." };
  }
  try {
    const raw = localStorage.getItem(ATS_GATE_STORAGE_KEY);
    if (!raw) {
      return { allowed: false, message: "Tip: Run ATS score in Step 01 to improve job-match quality." };
    }
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.fingerprint !== resumeFingerprint(trimmed)) {
      return { allowed: false, message: "Tip: Run ATS score for this resume to improve job recommendations." };
    }
    const max = Number(parsed.max || 100) || 100;
    const score = Number(parsed.score || 0);
    const percentage = Math.round((score / max) * 100);
    if (percentage < 80) {
      return {
        allowed: false,
        message: `ATS score is ${percentage}%. Rebuild in Step 01 to reach 80%+ for stronger matches.`,
      };
    }
    return { allowed: true, message: "" };
  } catch {
    return { allowed: false, message: "Tip: Run ATS score in Step 01 to improve job-match quality." };
  }
}

function normalizeLocationKey(value) {
  return (value || "").trim().toLowerCase();
}

function normalizeRoleKey(value) {
  return (value || "").trim().toLowerCase();
}

function formatSalary(job) {
  if (job.salary_min == null && job.salary_max == null) return "Not disclosed";
  const min = job.salary_min != null ? Math.round(Number(job.salary_min)).toLocaleString() : null;
  const max = job.salary_max != null ? Math.round(Number(job.salary_max)).toLocaleString() : null;
  const currency = job.currency ? ` ${job.currency}` : "";
  if (min && max) return `${min} - ${max}${currency}`;
  return `${min || max}${currency}`;
}

function formatPostedAt(value) {
  if (value == null) return "";
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "";
  const elapsed = Math.max(0, Date.now() - timestamp * 1000);
  const days = Math.floor(elapsed / 86400000);
  if (days === 0) return "Posted today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

function applyButtonStyle(source) {
  const s = (source || "").toLowerCase();
  if (s.includes("adzuna")) {
    return { background: "linear-gradient(135deg, #818cf8, #6366f1)" };
  }
  if (s.includes("jooble")) {
    return { background: "linear-gradient(135deg, #34d399, #10b981)" };
  }
  if (s.includes("usajobs")) {
    return { background: "linear-gradient(135deg, #7dd3fc, #38bdf8)" };
  }
  return { background: "linear-gradient(135deg, #fbbf24, #f59e0b)" };
}

function statusDotColor(status) {
  const s = (status || "").toLowerCase();
  if (s === "ok" || s === "success") return "#4ade80";
  if (s.includes("cached")) return "#38bdf8";
  if (s.includes("rate") || s.includes("limit")) return "#fbbf24";
  return "#f87171";
}

export default function JobSearchPanel({ resume, jd, user }) {
  const [role, setRole] = useState("");
  const [roles, setRoles] = useState([]);
  const [locationInput, setLocationInput] = useState("");
  const [locations, setLocations] = useState([]);
  const [skillsRaw, setSkillsRaw] = useState("");
  const [countryCode, setCountryCode] = useState("");
  const [countryInput, setCountryInput] = useState("");
  const [status, setStatus] = useState("idle"); // idle | suggesting | ready | loading | error
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [selected, setSelected] = useState({});
  const [validationError, setValidationError] = useState("");
  const [showCountrySuggestions, setShowCountrySuggestions] = useState(false);
  const [showCitySuggestions, setShowCitySuggestions] = useState(false);
  const [atsGateTick, setAtsGateTick] = useState(0);
  const cityInputRef = useRef(null);
  const countryInputRef = useRef(null);

  const hasResume = useMemo(() => Boolean(resume?.trim()), [resume]);
  const cityOptions = useMemo(
    () => (countryCode ? (CITY_SUGGESTIONS[countryCode] || ALL_CITY_SUGGESTIONS) : ALL_CITY_SUGGESTIONS),
    [countryCode],
  );
  const filteredCitySuggestions = useMemo(() => {
    const q = (locationInput || "").trim().toLowerCase();
    if (!q) return cityOptions.slice(0, 8);
    return cityOptions.filter((city) => city.toLowerCase().includes(q)).slice(0, 8);
  }, [cityOptions, locationInput]);

  function addLocation(city) {
    const value = (city || "").trim();
    if (!value) return;
    setLocations((previous) => {
      const existingKeys = new Set(previous.map((item) => normalizeLocationKey(item)));
      if (existingKeys.has(normalizeLocationKey(value))) return previous;
      return [...previous, value].slice(0, 10);
    });
    setLocationInput("");
    setShowCitySuggestions(false);
    cityInputRef.current?.focus();
  }

  function addRole(nextRole) {
    const value = (nextRole || "").trim();
    if (!value) return;
    setRoles((previous) => {
      const existingKeys = new Set(previous.map((item) => normalizeRoleKey(item)));
      if (existingKeys.has(normalizeRoleKey(value))) return previous;
      return [...previous, value].slice(0, 8);
    });
    setRole("");
  }

  function consumePendingRoles() {
    const pending = (role || "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    if (!pending.length) return [];
    const uniquePending = [];
    for (const item of pending) {
      if (!uniquePending.includes(item)) uniquePending.push(item);
    }
    setRoles((previous) => {
      const merged = [...previous];
      const existingKeys = new Set(merged.map((item) => normalizeRoleKey(item)));
      for (const value of uniquePending) {
        const key = normalizeRoleKey(value);
        if (!existingKeys.has(key)) {
          merged.push(value);
          existingKeys.add(key);
        }
      }
      return merged.slice(0, 8);
    });
    setRole("");
    return uniquePending;
  }

  function removeRole(value) {
    setRoles((previous) => previous.filter((item) => item !== value));
  }

  function consumePendingLocations() {
    const pending = (locationInput || "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    if (!pending.length) return [];
    const uniquePending = [];
    for (const city of pending) {
      if (!uniquePending.includes(city)) uniquePending.push(city);
    }
    setLocations((previous) => {
      const merged = [...previous];
      const existingKeys = new Set(merged.map((item) => normalizeLocationKey(item)));
      for (const city of uniquePending) {
        const key = normalizeLocationKey(city);
        if (!existingKeys.has(key)) {
          merged.push(city);
          existingKeys.add(key);
        }
      }
      return merged.slice(0, 10);
    });
    setLocationInput("");
    setShowCitySuggestions(false);
    return uniquePending;
  }

  function removeLocation(city) {
    setLocations((previous) => previous.filter((item) => item !== city));
  }

  useEffect(() => {
    if (!hasResume) {
      setRole("");
      setRoles([]);
      setLocationInput("");
      setLocations([]);
      setSkillsRaw("");
      setCountryCode("");
      setCountryInput("");
      setResult(null);
      setSelected({});
      setValidationError("");
      setError("");
      setStatus("idle");
      setShowCountrySuggestions(false);
      setShowCitySuggestions(false);
      return;
    }
    let cancelled = false;
    setStatus("suggesting");
    setError("");
    const savedProfile = loadSearchProfile(user);
    if (
      (savedProfile?.roles?.length || savedProfile?.role?.trim()) &&
      savedProfile?.countryCode &&
      Array.isArray(savedProfile?.locations) &&
      savedProfile.locations.length
    ) {
      const savedRoles = Array.isArray(savedProfile.roles) && savedProfile.roles.length
        ? savedProfile.roles.slice(0, 8)
        : [savedProfile.role].filter(Boolean);
      setRoles(savedRoles);
      setRole("");
      setCountryCode(savedProfile.countryCode);
      setCountryInput(savedProfile.countryInput || countryNameFromCode(savedProfile.countryCode));
      setLocations(savedProfile.locations.slice(0, 10));
      setSkillsRaw(savedProfile.skillsRaw || "");
      executeSearch(
        {
          resume,
          role: savedRoles[0],
          roles: savedRoles,
          location: savedProfile.locations[0],
          locations: savedProfile.locations.slice(0, 10),
          skills: toSkillList(savedProfile.skillsRaw || ""),
          country: savedProfile.countryCode,
          limit: 20,
        },
        false,
      ).catch((e) => {
        if (cancelled) return;
        setStatus("error");
        setError(e.message);
      });
      return () => {
        cancelled = true;
      };
    }

    suggestJobSearch(API, resume, jd, fetch, localStorage, notifyExpired)
      .then((data) => {
        if (cancelled) return;
        const nextRole = data.role || "";
        const nextSkills = data.skills || [];
        const suggestedCountryCode = (data.country || "").toLowerCase();
        const suggestedCountryName = countryNameFromCode(suggestedCountryCode);
        const suggestedLocations = Array.isArray(data.locations)
          ? data.locations.map((item) => (item || "").trim()).filter(Boolean).slice(0, 10)
          : [];

        setRoles(nextRole ? [nextRole] : []);
        setRole("");
        setSkillsRaw(nextSkills.join(", "));
        if (suggestedCountryCode) {
          setCountryCode(suggestedCountryCode);
          setCountryInput(suggestedCountryName || data.country || "");
        }
        if (suggestedLocations.length) {
          setLocations(suggestedLocations);
          setLocationInput("");
        }

        const autoLocations = suggestedLocations.length
          ? suggestedLocations
          : (suggestedCountryName ? [suggestedCountryName] : []);
        if (!nextRole.trim() || !suggestedCountryCode || !autoLocations.length) {
          setStatus("ready");
          return;
        }

        executeSearch({
          resume,
          role: nextRole,
          roles: nextRole ? [nextRole] : [],
          location: autoLocations[0],
          locations: autoLocations,
          skills: nextSkills.slice(0, 20),
          country: suggestedCountryCode,
          limit: 20,
        }).catch((searchError) => {
          if (cancelled) return;
          setStatus("error");
          setError(searchError.message);
        });
      })
      .catch((e) => {
        if (cancelled) return;
        setStatus("error");
        setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [hasResume, resume, jd, user]);

  async function runSearch(forceRefresh = false) {
    const pendingRoles = consumePendingRoles();
    const finalRoles = [...roles];
    for (const value of pendingRoles) {
      if (!finalRoles.some((item) => normalizeRoleKey(item) === normalizeRoleKey(value))) {
        finalRoles.push(value);
      }
    }
    if (!finalRoles.length) {
      setValidationError("Add at least one target role.");
      return;
    }
    const resolvedCountryCode = countryCodeFromName(countryInput) || countryCode;
    if (!resolvedCountryCode) {
      setValidationError("Please choose a country from suggestions.");
      return;
    }
    const pendingLocations = consumePendingLocations();
    const finalLocations = [...locations];
    for (const city of pendingLocations) {
      if (!finalLocations.includes(city)) finalLocations.push(city);
    }
    if (!finalLocations.length) {
      setValidationError("Add at least one location.");
      return;
    }
    setValidationError("");
    try {
      await executeSearch({
        resume,
        role: finalRoles[0],
        roles: finalRoles,
        location: finalLocations[0],
        locations: finalLocations,
        skills: toSkillList(skillsRaw),
        country: resolvedCountryCode,
        limit: 20,
      }, forceRefresh);
    } catch (e) {
      setStatus("error");
      setError(e.message);
    }
  }

  function toggleSelectAll(checked) {
    const jobs = result?.jobs || [];
    const next = {};
    for (const job of jobs) {
      next[job.apply_url] = checked;
    }
    setSelected(next);
  }

  function toggleSelect(url, checked) {
    setSelected((prev) => ({ ...prev, [url]: checked }));
  }

  function openSelectedJobs() {
    const jobs = (result?.jobs || []).filter((job) => selected[job.apply_url]);
    for (const job of jobs) {
      window.open(job.apply_url, "_blank", "noopener,noreferrer");
    }
  }

  const selectedCount = (result?.jobs || []).filter((job) => selected[job.apply_url]).length;
  const countrySuggestions = useMemo(
    () =>
      COUNTRIES.filter((country) =>
        country.name.toLowerCase().includes((countryInput || "").trim().toLowerCase()),
      ).slice(0, 8),
    [countryInput],
  );
  const atsGate = useMemo(() => readAtsGateState(resume), [resume, atsGateTick]);

  useEffect(() => {
    function handleAtsUpdated() {
      setAtsGateTick((tick) => tick + 1);
    }
    window.addEventListener("ats-updated", handleAtsUpdated);
    return () => window.removeEventListener("ats-updated", handleAtsUpdated);
  }, []);

  async function executeSearch(payload, forceRefresh = false) {
    setStatus("loading");
    setError("");
    setValidationError("");
    const data = await searchJobs(
      API,
      { ...payload, force_refresh: forceRefresh },
      fetch,
      localStorage,
      notifyExpired,
    );
    setResult(data);
    const nextSelected = {};
    for (const job of data.jobs || []) {
      nextSelected[job.apply_url] = true;
    }
    setSelected(nextSelected);
    setStatus("ready");
  }

  useEffect(() => {
    if (!hasResume) return;
    const profile = {
      role,
      roles,
      countryCode,
      countryInput,
      locations,
      skillsRaw,
      updatedAt: Date.now(),
    };
    localStorage.setItem(searchProfileKey(user), JSON.stringify(profile));
  }, [hasResume, role, roles, countryCode, countryInput, locations, skillsRaw, user]);

  return (
    <section className="tp-jobs">
      <div>
        <div className="tp-panel-heading">
          <div className="tp-heading-label"><span className="tp-step-number">02</span><h2>Find where you fit</h2></div>
          {result?.cached ? <span className="tp-pill">Saved results · 24h cache</span> : <span className="tp-pill">Resume-based job search</span>}
        </div>
        <p className="tp-panel-description" style={{ marginBottom: 0 }}>
          Your resume pre-fills role and skills. Select one or more locations, then explore Jooble opportunities in one place.
        </p>
      </div>
      <div>
      {!hasResume && (
        <p className="tp-job-empty">
          <Icon name="file" size={16} /> Add your resume above to start manual job search.
        </p>
      )}
      <div className="tp-job-fields">
        <div style={{ ...styles.field, gridColumn: "1 / -1" }}>
          <label htmlFor="target-job-role" style={{ display: "block", marginBottom: 6, fontWeight: 600 }}>Target roles</label>
          {roles.length > 0 && (
            <div style={styles.roleChips}>
              {roles.map((value) => (
                <button type="button" key={value} style={styles.roleChip} onClick={() => removeRole(value)} aria-label={`Remove ${value}`}>
                  {value} <span aria-hidden="true">×</span>
                </button>
              ))}
            </div>
          )}
          <input
            id="target-job-role"
            style={styles.input}
            value={role}
            onChange={(e) => {
              const next = e.target.value;
              if (next.includes(",")) {
                const pieces = next.split(",");
                const tail = pieces.pop() || "";
                const parsed = pieces.map((part) => part.trim()).filter(Boolean);
                if (parsed.length) {
                  for (const value of parsed) addRole(value);
                }
                setRole(tail.trimStart());
              } else {
                setRole(next);
              }
            }}
            onBlur={() => {
              if (role.trim()) addRole(role);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && role.trim()) {
                event.preventDefault();
                addRole(role);
              }
            }}
            placeholder="Type role and press Enter (e.g. Backend Engineer)"
            disabled={!hasResume}
          />
          {hasResume && (
            <div style={styles.quickPillsRow}>
              <span style={styles.quickPillLabel}>Explore:</span>
              {POPULAR_ROLES.map((r) => (
                <button
                  key={r}
                  type="button"
                  style={roles.some((value) => normalizeRoleKey(value) === normalizeRoleKey(r)) ? styles.quickPillActive : styles.quickPill}
                  onClick={() => addRole(r)}
                >
                  {r}
                </button>
              ))}
            </div>
          )}
        </div>
        <label style={styles.field}>
          Country
          <div style={styles.autoCompleteWrap}
            onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setShowCountrySuggestions(false); }}
            onKeyDown={(event) => { if (event.key === "Escape") setShowCountrySuggestions(false); }}>
            <input
              ref={countryInputRef}
              style={styles.input}
              value={countryInput}
              onChange={(e) => {
                const next = e.target.value;
                setCountryInput(next);
                setShowCountrySuggestions(true);
                const nextCode = countryCodeFromName(next);
                if (nextCode) setCountryCode(nextCode);
              }}
              onFocus={() => setShowCountrySuggestions(true)}
              placeholder="Type country name (e.g. India)"
              disabled={!hasResume}
            />
            {hasResume && showCountrySuggestions && (countrySuggestions.length ? countrySuggestions : COUNTRIES.slice(0, 8)).length > 0 && (
              <div style={styles.suggestionBox}>
                {(countrySuggestions.length ? countrySuggestions : COUNTRIES.slice(0, 8)).map((countryOption) => (
                  <button
                    type="button"
                    key={countryOption.code}
                    style={styles.suggestionItem}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      setCountryInput(countryOption.name);
                      setCountryCode(countryOption.code);
                      countryInputRef.current?.focus();
                      setShowCountrySuggestions(false);
                    }}
                  >
                    <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 16 }}>{COUNTRY_FLAGS[countryOption.code] || "🌐"}</span>
                      <span>{countryOption.name}</span>
                    </span>
                    <span style={styles.countryCodeTag}>{countryOption.code.toUpperCase()}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </label>
        <label style={styles.field}>
          Locations
          {locations.length > 0 && (
            <div style={styles.locationChips}>
              {locations.map((city) => (
                <button type="button" key={city} style={styles.locationChip} onClick={() => removeLocation(city)} aria-label={`Remove ${city}`}>
                  {city} <span aria-hidden="true">×</span>
                </button>
              ))}
            </div>
          )}
          <div style={styles.autoCompleteWrap}
            onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setShowCitySuggestions(false); }}
            onKeyDown={(event) => { if (event.key === "Escape") setShowCitySuggestions(false); }}>
            <input
              ref={cityInputRef}
              style={styles.input}
              value={locationInput}
              onChange={(e) => {
                const next = e.target.value;
                if (next.includes(",")) {
                  const pieces = next.split(",");
                  const tail = pieces.pop() || "";
                  const parsed = pieces.map((part) => part.trim()).filter(Boolean);
                  if (parsed.length) {
                    for (const city of parsed) addLocation(city);
                  }
                  setLocationInput(tail.trimStart());
                } else {
                  setLocationInput(next);
                }
                setShowCitySuggestions(true);
              }}
              onFocus={() => setShowCitySuggestions(true)}
              placeholder="Type city and press Enter (e.g. Hyderabad)"
              onKeyDown={(event) => {
                if (event.key === "Enter" && locationInput.trim()) {
                  event.preventDefault();
                  addLocation(locationInput);
                }
              }}
              disabled={!hasResume}
            />
            {hasResume && showCitySuggestions && filteredCitySuggestions.length > 0 && (
              <div style={styles.suggestionBox}>
                {filteredCitySuggestions.map((city) => (
                  <button
                    type="button"
                    key={city}
                    style={styles.suggestionItem}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      addLocation(city);
                    }}
                  >
                    <span>📍 {city}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </label>
        <label style={{ ...styles.field, gridColumn: "1 / -1" }}>
          Skills (comma-separated)
          <input
            style={styles.input}
            value={skillsRaw}
            onChange={(e) => setSkillsRaw(e.target.value)}
            placeholder="python, django, aws"
            disabled={!hasResume}
          />
        </label>
      </div>
      <div style={styles.actions}>
        <button className="tp-btn tp-btn-primary" onClick={() => runSearch(false)} disabled={!hasResume || status === "loading" || status === "suggesting" || (!role.trim() && !roles.length)}>
          <Icon name="search" size={16} /> {status === "loading" ? "Searching sources…" : "Search jobs"}
        </button>
        <button className="tp-btn tp-btn-text" onClick={() => runSearch(true)} disabled={!hasResume || status === "loading" || status === "suggesting" || (!role.trim() && !roles.length)}>
          Refresh from sources
        </button>
      </div>
      {hasResume && !atsGate.allowed && (
        <p role="alert" style={{ ...styles.hint, color: "#fbbf24", marginTop: 8 }}>
          {atsGate.message}
        </p>
      )}
      {status === "suggesting" && (
        <div style={styles.suggestingBox}>
          <span style={styles.pulseDot} />
          <span>Extracting role and skills from your resume…</span>
        </div>
      )}
      {error && <p role="alert" style={{ ...styles.hint, color: "#fca5a5" }}>{error}</p>}
      {validationError && <p role="alert" style={{ ...styles.hint, color: "#fca5a5" }}>{validationError}</p>}
      <p style={{ ...styles.hint, fontSize: 14, marginTop: 12 }}>
        Choose your matches and open their application pages together. You review and submit each application on the external site.
      </p>
      </div>

      {result?.provider_statuses?.length > 0 && (
        <div style={styles.statusRow}>
          {result.provider_statuses.map((sourceState) => (
            <span key={sourceState.source} style={styles.providerBadge}>
              <span style={{ ...styles.statusDot, background: statusDotColor(sourceState.status) }} />
              <span>{sourceState.source}: {sourceState.status}</span>
            </span>
          ))}
        </div>
      )}

      {status === "loading" && (
        <div style={styles.skeletonContainer}>
          <div style={styles.skeletonCard}>
            <div style={styles.skeletonBar} />
            <div style={{ ...styles.skeletonBar, width: "60%" }} />
          </div>
          <div style={styles.skeletonCard}>
            <div style={styles.skeletonBar} />
            <div style={{ ...styles.skeletonBar, width: "45%" }} />
          </div>
        </div>
      )}

      {result?.jobs?.length > 0 && (
        <div style={styles.results}>
          <div style={styles.bulkBar}>
            <label style={styles.selectLabel}>
              <input
                type="checkbox"
                style={styles.checkbox}
                checked={selectedCount === result.jobs.length}
                onChange={(e) => toggleSelectAll(e.target.checked)}
              />
              Select all ({result.jobs.length})
            </label>
            <button className="tp-btn tp-btn-primary" onClick={openSelectedJobs} disabled={!selectedCount}>
              Open selected applications ({selectedCount}) <Icon name="arrow" size={16} />
            </button>
          </div>
          {result.jobs.map((job, index) => (
            <article key={`${job.source}-${job.external_id || job.apply_url}-${index}`} className="tp-job-result">
              <div className="tp-job-main">
                <input
                  type="checkbox"
                  className="tp-job-checkbox"
                  checked={Boolean(selected[job.apply_url])}
                  onChange={(e) => toggleSelect(job.apply_url, e.target.checked)}
                  aria-label={`Select ${job.title}`}
                />
                <div className="tp-job-details">
                  <a href={job.apply_url} target="_blank" rel="noreferrer" className="tp-job-title">
                    {job.title}
                  </a>
                  <div className="tp-job-company">{job.company || "Company Confidential"}</div>
                  <div className="tp-job-meta">
                    {job.remote_type && job.remote_type !== "unspecified" &&
                      !job.location?.toLowerCase().startsWith(job.remote_type.toLowerCase()) && (
                      <span><Icon name="briefcase" size={16} /> {job.remote_type}</span>
                    )}
                    <span><Icon name="wallet" size={16} /> {formatSalary(job)}</span>
                    {job.location && <span><Icon name="pin" size={16} /> {job.location}</span>}
                  </div>
                  {job.description_snippet && (
                    <p className="tp-job-snippet">{job.description_snippet}</p>
                  )}
                  <div className="tp-job-footer">
                    <span>{formatPostedAt(job.posted_at)}</span>
                    <a
                      className="tp-btn tp-apply-btn"
                      style={applyButtonStyle(job.source)}
                      href={job.apply_url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Apply on {job.source} ↗
                    </a>
                  </div>
                </div>
                <div className="tp-job-identity" aria-label={`Source: ${job.source}`}>
                  <span className="tp-job-avatar" aria-hidden="true">
                    {(job.company || job.source || "J").charAt(0).toUpperCase()}
                  </span>
                  <span className="tp-job-source">{job.source}</span>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
      {result && result.jobs.length === 0 && (
        <div style={styles.emptyState}>
          <Icon name="search" size={28} />
          <p style={styles.hint}>No jobs matched this query yet. Try another role, location, or country.</p>
          <p style={styles.hintMuted}>More job sources will be added soon to widen your results.</p>
        </div>
      )}
    </section>
  );
}

const styles = {
  hint: { margin: 0, fontSize: 15, color: "#aaa4bc", lineHeight: 1.5 },
  hintMuted: { margin: 0, fontSize: 13, color: "#7d7692", lineHeight: 1.5, fontStyle: "italic" },
  field: { display: "flex", flexDirection: "column", gap: 6, fontSize: 14, color: "#d3cedf" },
  autoCompleteWrap: { position: "relative" },
  roleChips: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: 6,
  },
  roleChip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    borderRadius: 999,
    border: "1px solid rgba(139, 92, 246, 0.36)",
    background: "rgba(139, 92, 246, 0.18)",
    color: "#ddd6fe",
    fontSize: 12,
    padding: "4px 10px",
    cursor: "pointer",
  },
  locationChips: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: 6,
  },
  locationChip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    borderRadius: 999,
    border: "1px solid rgba(56, 189, 248, 0.32)",
    background: "rgba(56, 189, 248, 0.14)",
    color: "#bae6fd",
    fontSize: 12,
    padding: "4px 10px",
    cursor: "pointer",
  },
  input: {
    background: "#101119",
    border: "1px solid #2b2c3a",
    borderRadius: 8,
    color: "#f8fafc",
    fontSize: 14,
    padding: "9px 12px",
  },
  suggestionBox: {
    position: "absolute",
    top: "calc(100% + 4px)",
    left: 0,
    right: 0,
    background: "#0b1220",
    border: "1px solid #334155",
    borderRadius: 8,
    zIndex: 10,
    maxHeight: 220,
    overflowY: "auto",
    boxShadow: "0 10px 20px rgba(2, 6, 23, 0.45)",
  },
  suggestionItem: {
    width: "100%",
    textAlign: "left",
    background: "transparent",
    border: "none",
    borderBottom: "1px solid rgba(51, 65, 85, 0.4)",
    color: "#e2e8f0",
    padding: "10px 12px",
    fontSize: 14,
    cursor: "pointer",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  countryCodeTag: {
    fontSize: 11,
    fontWeight: 700,
    padding: "2px 6px",
    borderRadius: 4,
    background: "rgba(56, 189, 248, 0.15)",
    color: "#7dd3fc",
  },
  suggestingBox: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 13,
    color: "#7dd3fc",
    background: "rgba(56, 189, 248, 0.08)",
    border: "1px solid rgba(56, 189, 248, 0.25)",
    padding: "8px 12px",
    borderRadius: 8,
  },
  pulseDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    background: "#b3a3fa",
    boxShadow: "0 0 8px #38bdf8",
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 999,
    display: "inline-block",
  },
  actions: { display: "flex", flexWrap: "wrap", gap: 8, marginTop: 20 },
  statusRow: { display: "flex", flexWrap: "wrap", gap: 8 },
  providerBadge: {
    fontSize: 12,
    borderRadius: 999,
    border: "1px solid rgba(148, 163, 184, 0.3)",
    background: "rgba(15, 23, 42, 0.6)",
    color: "#d3cedf",
    padding: "4px 10px",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
  },
  skeletonContainer: {
    display: "grid",
    gap: 12,
  },
  skeletonCard: {
    background: "rgba(15, 23, 42, 0.5)",
    border: "1px solid rgba(148, 163, 184, 0.15)",
    borderRadius: 12,
    padding: 16,
    display: "grid",
    gap: 10,
  },
  skeletonBar: {
    height: 14,
    borderRadius: 6,
    background: "linear-gradient(90deg, rgba(255, 255, 255, 0.04) 25%, rgba(255, 255, 255, 0.09) 50%, rgba(255, 255, 255, 0.04) 75%)",
    width: "80%",
  },
  results: { display: "grid", gap: 12 },
  bulkBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
    padding: "12px 16px",
    background: "#14141e",
    border: "1px solid rgba(56, 189, 248, 0.25)",
    borderRadius: 12,
  },
  selectLabel: {
    display: "inline-flex",
    gap: 8,
    alignItems: "center",
    fontSize: 15,
    color: "#e2e8f0",
    fontWeight: 600,
    cursor: "pointer",
  },
  checkbox: {
    width: 17,
    height: 17,
    accentColor: "#b3a3fa",
    cursor: "pointer",
  },
  quickPillsRow: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 6,
  },
  quickPillLabel: {
    fontSize: 12,
    color: "#aaa4bc",
    fontWeight: 600,
    marginRight: 2,
  },
  quickPill: {
    background: "rgba(255, 255, 255, 0.04)",
    border: "1px solid rgba(255, 255, 255, 0.1)",
    color: "#d3cedf",
    fontSize: 12,
    padding: "3px 9px",
    borderRadius: 999,
    cursor: "pointer",
    transition: "all 0.15s ease",
  },
  quickPillActive: {
    background: "rgba(56, 189, 248, 0.18)",
    border: "1px solid #38bdf8",
    color: "#7dd3fc",
    fontSize: 12,
    padding: "3px 9px",
    borderRadius: 999,
    cursor: "pointer",
    fontWeight: 600,
  },
  emptyState: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "24px 16px",
    gap: 8,
    textAlign: "center",
  },
};

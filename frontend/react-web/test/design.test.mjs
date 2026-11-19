import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildSync } from "esbuild";

const require = createRequire(import.meta.url);
function render(name, props = {}, stored = {}) {
  const compiled = buildSync({
    entryPoints: [fileURLToPath(new URL(`../src/${name}.jsx`, import.meta.url))],
    bundle: true, write: false, format: "cjs", platform: "node", jsx: "automatic",
    external: ["react", "react-dom"],
    loader: { ".svg": "dataurl" },
    define: { "import.meta.env": "{}", "import.meta.url": '""' },
    logLevel: "silent",
  }).outputFiles[0].text;
  const context = { module: { exports: {} }, require, console, URL,
    localStorage: { getItem: (key) => stored[key] ?? null } };
  vm.runInNewContext(compiled, context);
  return renderToStaticMarkup(React.createElement(context.module.exports.default, props));
}

test("landing distinguishes the free score from the paid resume unlock", () => {
  const html = render("Landing", { onSignIn() {}, onSignUp() {} });
  assert.match(html, /ATS resume score/);
  assert.match(html, /downloads for ₹10, with 24-hour access/);
  assert.match(html, /Loading current plan prices/);
  assert.match(html, /aria-label="Main navigation"/);
  assert.match(html, /Illustrative preview/);
  assert.doesNotMatch(html, /100%.*invisible|Free ATS Resume Builder/i);
});

test("landing leads with the interview HUD and highlights the complete career toolkit", () => {
  const html = render("Landing", { onSignIn() {}, onSignUp() {} });
  assert.match(html, /NEXT-GEN STEALTH INTERVIEW INTELLIGENCE/);
  assert.match(html, /Crack Every Tech Interview/);
  assert.match(html, /Invisible AI HUD/);
  assert.match(html, /ATS Resume Builder/);
  assert.match(html, /Mock Interviews/);
  assert.match(html, /Resume-Based Job Search/);
  assert.match(html, /Trusted by <strong>1 Lakh\+ people<\/strong>/);
  assert.match(html, /4\.2\/5/);
  assert.match(html, /from 10K\+ reviews/);
  assert.match(html, /aria-label="HUD preview mode"/);
  assert.match(html, /Protection varies by OS and sharing method/);
  assert.doesNotMatch(html, /undetectable/);
});

test("branding uses the rounded ia mark and locally hosted navigation font", () => {
  const html = render("Landing", { onSignIn() {}, onSignUp() {} });
  assert.match(html, /class="tp-brand-mark"/);
  const dashboard = render("WebDashboard", { user: "Alex" });
  assert.doesNotMatch(dashboard, /Your preparation workspace/);
  assert.match(dashboard, /class="tp-brand" href="#workspace-top" aria-label="TechPrep — Back to top"/);
  assert.match(dashboard, /id="workspace-top"/);
  assert.match(html, /data:image\/svg\+xml/);
  const mark = readFileSync(new URL("../src/assets/techprep-mark.svg", import.meta.url), "utf8");
  assert.match(mark, /fill="#5f46bf"/);
  const css = readFileSync(new URL("../src/design-system.css", import.meta.url), "utf8");
  assert.match(css, /src: url\("\.\/assets\/fonts\/manrope-latin\.woff2"\)/);
  assert.match(css, /\.tp-nav-links a \{[^}]*font-family: "Manrope"[^}]*font-weight: 600/);
  assert.match(css, /\.tp-brand-mark \{[^}]*filter: drop-shadow\(0 2px 7px rgba\(167, 139, 250, \.25\)\)/);
  assert.match(css, /\.tp-brand::before \{[^}]*pointer-events: none;[^}]*background: radial-gradient/);
  const index = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(index, /rel="icon"[^>]+techprep-mark\.svg/);
});

test("empty dashboard requires PDF upload and defers history and account details", () => {
  const html = render("WebDashboard", { user: "Alex" });
  assert.match(html, /Choose your resume PDF/);
  assert.match(html, /disabled="">Analyze my resume/);
  assert.match(html, /Or paste resume text for job search/);
  assert.match(html, /aria-label="Account menu for Alex"/);
  assert.equal((html.match(/Full View/g) || []).length, 1);
  assert.doesNotMatch(html, /Question[s]? Saved|AI Token Usage|Subscription &amp; Credits/);
});

test("dashboard prominently explains desktop requirements and offers subscriptions", () => {
  for (const subscription of [null, { status: "expired" }]) {
    const html = render("WebDashboard", { user: "Alex", subscription });
    assert.match(html, /Desktop Application Required For Live Calls/);
    assert.match(html, /Your interview subscription is inactive/);
    assert.match(html, /View subscription plans/);
    assert.match(html, /href="#desktop-app"[^>]*>.*Get desktop app/);
    assert.match(html, /Visibility depends on your OS and sharing/);
    assert.doesNotMatch(html, /never detect|hardware-level|undetectable|Your interview subscription is active/);
    assert.ok(html.indexOf("View subscription plans") < html.indexOf('aria-label="Quick actions"'));
  }
});

test("dashboard offers plan management or renewal to existing subscribers", () => {
  const active = { status: "active", calls_remaining: 5, call_time_remaining_seconds: 0 };
  const html = render("WebDashboard", { user: "Alex", subscription: active });
  assert.match(html, /Your interview subscription is active/);
  assert.match(html, /Manage subscription/);
  assert.doesNotMatch(html, /Your interview subscription is inactive/);
  const exhausted = render("WebDashboard", { user: "Alex", subscription: { ...active, calls_remaining: 0 } });
  assert.match(exhausted, /Renew to start another live call/);
  assert.match(exhausted, /Renew subscription/);
  const inProgress = render("WebDashboard", { user: "Alex", subscription: { ...active, calls_remaining: 0, call_time_remaining_seconds: 300 } });
  assert.match(inProgress, /Your interview subscription is active/);
  assert.doesNotMatch(inProgress, /Renew to start another live call/);
});

test("pasted text enables job discovery but never enables ATS without a PDF", () => {
  const html = render("WebDashboard", { user: "Alex" }, { resume: "Backend engineer with Python and AWS experience" });
  assert.match(html, /id="target-job-role"/);
  assert.match(html, /disabled="">Analyze my resume/);
});

test("uploaded resume shows a clean summary card and enables ATS analysis", () => {
  const html = render("WebDashboard", { user: "Alex" }, {
    resume: "Backend engineer with Python and AWS experience", resume_uploaded_at: "123",
  });
  assert.doesNotMatch(html, /aria-label="Resume text"/);
  assert.match(html, /Resume uploaded successfully/);
  assert.match(html, /PDF ready for analysis/);
  assert.doesNotMatch(html, /disabled="">Analyze my resume/);
  assert.match(html, /Full rebuild &amp; downloads: ₹10 \/ 24 hours/);
});

test("primary action text meets AA contrast in normal and hover states", () => {
  const css = readFileSync(new URL("../src/design-system.css", import.meta.url), "utf8");
  const colors = [
    css.match(/--tp-primary:\s*(#[\da-f]{6})/i)?.[1],
    css.match(/\.tp-btn-primary:hover:not\(:disabled\)\s*\{\s*background:\s*(#[\da-f]{6})/i)?.[1],
  ];
  for (const color of colors) {
    assert.ok(color, "Primary color declaration must exist");
    const channels = color.slice(1).match(/../g).map((channel) => parseInt(channel, 16) / 255)
      .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
    const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    assert.ok(1.05 / (luminance + 0.05) >= 4.5, `White text on ${color} must reach 4.5:1`);
  }
});

test("supporting copy has readable sizes without enlarging workspace headings", () => {
  const css = readFileSync(new URL("../src/design-system.css", import.meta.url), "utf8");
  for (const [selector, size] of [
    [".tp-field > small", 14],
    [".tp-panel-description", 15],
    [".tp-tool-copy p", 15],
    [".tp-panel-heading h2", 20],
  ]) {
    const rule = css.slice(css.indexOf(`${selector} {`)).split("}")[0];
    assert.match(rule, new RegExp(`font-size: ${size}px;`), selector);
  }
});

test("subscription actions use dark fills with accessible muted amber text", () => {
  const css = readFileSync(new URL("../src/design-system.css", import.meta.url), "utf8");
  const normal = css.match(/\.tp-btn-amber \{([^}]+)\}/)?.[1];
  const hover = css.match(/\.tp-browser \.tp-btn-amber:hover:not\(:disabled\) \{([^}]+)\}/)?.[1];
  assert.ok(normal && hover);
  const foreground = normal.match(/(?:^|;)\s*color:\s*(#[\da-f]{6})/i)?.[1];
  function luminance(color) {
    assert.ok(color);
    const [r, g, b] = color.slice(1).match(/../g).map(channel => parseInt(channel, 16) / 255)
      .map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
    return r * 0.2126 + g * 0.7152 + b * 0.0722;
  }
  for (const rule of [normal, hover]) {
    const background = rule.match(/background:\s*(#[\da-f]{6})/i)?.[1];
    assert.ok(luminance(background) < 0.05, "Button fill must remain dark");
    assert.ok((luminance(foreground) + 0.05) / (luminance(background) + 0.05) >= 4.5);
  }
});

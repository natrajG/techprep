# Desktop overlay: capture protection and packaging

## Implementation and scope

Electron is pinned to **44.7.1** (supported stable; upgraded from end-of-life 33.4.11)
with electron-builder 26.15.3. Installing them requires **Node.js 22.12+** (`.nvmrc`).
Breaking changes between 33 and 44 relevant here: macOS 13+ is required, macOS system-audio
capture needs `NSAudioCaptureUsageDescription` (added), and 32-bit Windows is no longer built.
The platform analysis below was written against 33.4.11; the public APIs used are unchanged,
but **repeat the manual Windows/macOS capture, transparency and audio checks on 44** before
a wide release. Sections below that mention Electron 33 describe the original review.

The overlay uses only Electron's public `BrowserWindow.setContentProtection`
API. No private APIs, native addon, DRM workaround, or screen-recording
detection is included.

| Platform | Runtime requirement for this version | Requested mechanism and limits |
| --- | --- | --- |
| Windows 10 version 2004+, Windows 11 | Windows version/build detected through `os.release()`; 2004 is build 19041 | Electron calls `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)`. Compatible capture paths can omit the window. |
| Windows 10 before 2004 | Electron supports Windows 10; detected build below 19041 | Windows treats the request as `WDA_MONITOR`: compatible captures show blank/black content, not necessarily an omitted window. |
| macOS 13+ | Darwin kernel 22+; Intel or Apple Silicon build as appropriate | Electron sets `NSWindow.sharingType = NSWindowSharingNone`. Some legacy CoreGraphics capture respects this; ScreenCaptureKit-based capture can include the window. |
| Linux and other platforms | Existing Linux runtime requirements unchanged | Unsupported. No native protection call is made and the toggle is disabled. |

Unknown OS versions, missing methods, and Electron versions below the project's
33 minimum are reported as unsupported. This is a project compatibility gate,
not a claim that the API was first introduced in Electron 33. Running a newer
Electron major requires reviewing its implementation again.

Windows display affinity requires desktop composition and only constrains
compatible OS capture paths. It is not DRM and cannot prevent external cameras,
every third-party/driver-level capture mechanism, or every remote/virtualized
capture path. Test each recording tool, backend, share mode, and remote-session
configuration independently. Do not rely on immediate capture during a setting
transition; inspect subsequent frames too.

Electron 33's Windows implementation returns `void` and does **not** propagate
the BOOL returned by `SetWindowDisplayAffinity`. Therefore, an exception-free
call means that the application submitted the request through Electron, not
that native exclusion was verified. API exceptions are reported as failures;
silent native rejections cannot be detected by this version's public API.

### macOS native investigation

The version-pinned Electron implementation already invokes the supported
AppKit window-sharing property. A native addon setting that same property
would not improve its coverage. Apple's `SCContentFilter` filters a stream
created by the **recording application**; it does not let this overlay exclude
itself from other applications' ScreenCaptureKit streams. No suitable public
native alternative was identified for preventing arbitrary external capture.
Consequently, no addon, native compilation step, or extra native lifecycle
management is warranted here.

ScreenCaptureKit is available from macOS 12.3 and capture applications may
select it differently across versions/settings. In particular, do not expect
exclusion from modern macOS native recording or ScreenCaptureKit-based meeting
and recording tools. macOS 11+ is the **Electron launch minimum**, not a promise
that capture protection works for all tools on those releases.

Sources reviewed:

- [Electron 33.4.11 API documentation](https://github.com/electron/electron/blob/v33.4.11/docs/api/base-window.md#winsetcontentprotectionenable-macos-windows)
- [Electron 33.4.11 Windows implementation](https://github.com/electron/electron/blob/v33.4.11/shell/browser/native_window_views.cc)
- [Electron 33.4.11 macOS implementation](https://github.com/electron/electron/blob/v33.4.11/shell/browser/native_window_mac.mm)
- [Electron 33 OS requirements](https://github.com/electron/electron/blob/v33.4.11/docs/breaking-changes.md)
- [Microsoft display-affinity requirements and limitations](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowdisplayaffinity)
- [Apple NSWindow sharingType](https://developer.apple.com/documentation/appkit/nswindow/sharingtype-swift.property)
- [Apple SCContentFilter](https://developer.apple.com/documentation/screencapturekit/sccontentfilter)
- [Electron maintainers' ScreenCaptureKit explanation](https://github.com/electron/electron/issues/48258)

## Preference, status, and window lifecycle

The existing settings mechanism is renderer `localStorage`; the previous
capture toggle had **no persistence** and reset on every launch. The new
`captureProtection` key stores `"true"` or `"false"`, defaulting to true on
Windows and macOS and false elsewhere when no preference exists yet. Resume,
job description, opacity and always-on-top keys are unchanged.

Storage is per renderer origin and Electron user-data profile. Switching
between `localhost:5173` development and `127.0.0.1:8000` production uses separate
preferences, just as it does for existing settings. Keep the origin, port, and
profile stable when testing restart persistence. This change does not migrate
unrelated settings or introduce another settings database.

The controller retains the requested preference for window recreation and
applies it to the new `BrowserWindow` before navigation. Each new overlay is
created hidden. The renderer reads localStorage and restores the preference
through restricted main-frame IPC; the window is shown only after both that
request and `ready-to-show`. This avoids displaying restored protected content
before initialization. Reloads reapply the saved value. A renderer that fails
to initialize after page load produces an explicit startup error after 15
seconds rather than leaving an invisible app indefinitely.

The checkbox reflects **requested intent**, including failed requests, not a
measurement of the recording. The status model carries `supported`,
`requested`, `enabled`, `status`, `mechanism`, `detail`, and `error`.
Here, `enabled` specifically means that an enable call returned without an
exception; it is not native or visual verification.

| Status | Meaning |
| --- | --- |
| `enabled` | Supported mechanism requested through Electron without an exception. UI says "Protection requested (best effort)". |
| `disabled` | An off request completed without an exception. |
| `unsupported` | No supported mechanism was applied. Linux remains usable. |
| `failed` | The API threw or the target window became unavailable. Native capture behavior is unknown, including after a failed disable. |

Preferences are written before requests, so an API failure does not erase the
user's choice; a retry button is available. Storage write errors prevent a new
native request and are shown. Unreadable/corrupt saved preferences cause an
explicit warning and a fallback request for that platform default (on for
Windows/macOS, off elsewhere), without overwriting the bad stored value.
IPC/storage errors suppress stale success text. Capture API failures and
unsupported platforms still show the overlay and its explanation.

Closing the last window still quits the application. No new keyboard shortcuts
were invented: the existing Enter-to-answer shortcut, drag regions, minimum
dimensions, resizing, opacity, on-top toggle, minimize/close controls, profile,
transcription and answer paths remain. The requested visual change makes the
desktop dark/translucent with compact controls and a wider initial window;
browser and Picture-in-Picture styling remain unchanged.

## Build and run

There was no desktop packaging configuration. With the approved overlay-only
scope, electron-builder 26.0.12 was added as a pinned development dependency.
Its Node 20-compatible dependency line is used rather than implicitly updating
to a newer builder requiring Node 22. There are no new runtime dependencies.

The package contains the **Electron shell only**. The separately running server
must serve the UI and proxy or serve the API and `/health` on the same HTTPS
origin. The existing `./run.sh lan` deployment does this at port 5173.
For a direct FastAPI production deployment, the backend's source checkout must
include `frontend/react-web/dist`; building the UI in an unrelated checkout
does not deploy those assets to the backend. `.env`, Python, virtual
environments, credentials, and tests are not included in the desktop archive.
The frontend build is a separate generated artifact, not embedded in the
installer. Deploy it alongside the backend when distributing the shell.
Windows packaging does not build or change the frontend.

Prerequisites: Node.js 22.12+ (`nvm install` reads `.nvmrc`), npm, Python 3.10+ for the
separate backend, and the existing backend requirements. Run from the project
root:

```text
npm --prefix frontend/react-web ci
npm --prefix desktop ci
npm --prefix desktop run build
npm --prefix desktop test
```

### Windows (PowerShell)

#### Connect the Windows app to the existing LAN HTTPS server

1. Open `https://192.168.0.109:5173/` in the Windows browser and sign in.
2. Use the authenticated Windows desktop download in the browser
   (`/api/v1/downloads/windows`). Save
   **TechPrep-Setup.exe**; it is a real NSIS installer, not the unpacked app ZIP.
3. Use the authenticated CA download (`/api/v1/downloads/ca`) or obtain
   `.certs/ca.crt` securely from your server administrator and trust it
   under your Windows account as shown below. Never distribute either private
   key. The installer does not bundle or automatically trust a CA certificate.
4. Double-click the installer, then launch **TechPrep** from its shortcut.
   The installed app connects to `https://192.168.0.109:5173/` without environment
   variables, a terminal, Python, or a local backend.
5. Sign in again in the desktop window. Browser and Electron sessions are
   separate; downloading is not SSO and no browser token is embedded or passed
   into the installer.

The server and its configured LAN address must remain reachable. Existing
Windows certificate trust must cover the certificate's IP subject alternative
name. The current build is unsigned: Windows may show an unknown-publisher or
SmartScreen warning. Verify the file came from your own authenticated server;
do not globally disable operating-system protections.

Use the **desktop executable**, not Edge's floating Picture-in-Picture window, when
you need Windows system-audio loopback and native capture protection. A browser
cannot mark its own window as excluded from another application's screen share.

Keep `./run.sh lan` running on the Linux host. No Python, API keys, or local backend
are needed on Windows when connecting to that host.

Import the host's CA under the current Windows user:

```powershell
Import-Certificate -FilePath .\ca.crt -CertStoreLocation Cert:\CurrentUser\Root
```

Run this from the folder containing `ca.crt`. Close all TechPrep windows before
relaunching after changing certificate trust or the URL. There is no
certificate-validation bypass. An administrator can still override the server
for a particular launch:

```powershell
$env:APP_URL = "https://other-trusted-server.example:5173/"
& "$env:LOCALAPPDATA\Programs\techprep-desktop\TechPrep.exe"
```

Renew the server certificate if its LAN address changes. Remove a previous
`APP_URL` override before testing the installer's embedded default.

The shell checks `/health` on the configured server using Chromium's network
stack, including Windows certificate trust. Network, certificate and unhealthy
backend errors show a startup dialog instead of opening a nonfunctional login
window. URL precedence is `APP_URL`, then the packaged `techprepServerUrl`
metadata. Source development (`npm --prefix desktop start`) still defaults to
`http://127.0.0.1:8000/`, or the existing `PORT` override, regardless of build
metadata. TLS certificate verification is unchanged.

After sign-in, click **Listen to system audio**. Windows loopback captures sound playing through the
output device, including call participants. It does not promise microphone input
or per-call isolation. The desktop handler supplies a display source without the
browser's screen/tab picker; the display video is not uploaded. Only the audio
track is recorded and sent for transcription. Missing sources and transcription
HTTP errors are surfaced rather than silently ignored.

Native capture protection and audio capture are independent: enabling one does
not enable the other. Windows protection remains best effort, not a guarantee;
confirm the receiver's view in your actual meeting tool before relying on it.
Only capture call audio with the participants' permission.

#### Run a backend locally on Windows instead

Set backend environment variables securely in the backend terminal.
The manual command below does not automatically source the root `.env`.
Do not embed API credentials in the Electron package or renderer.

```powershell
cd services/api-fastapi
py -3 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

In another terminal at the root:

```powershell
npm --prefix desktop start
npm --prefix desktop run pack:win
npm --prefix desktop run dist:win
```

`pack:win` creates `desktop/release/windows-installer/win-unpacked/TechPrep.exe`.
`dist:win` creates an x64 NSIS installer in `release/windows-installer/`, then
atomically publishes it to **`desktop/release/TechPrep-Setup.exe`**, the fixed
path served by the authenticated backend download endpoint. Only a successful
build replaces the downloadable file. Older `win-unpacked`, `windows-lan`,
and `mac-check` outputs are not deleted or reused.

#### Build-time server configuration

The maintainable default is `build.extraMetadata.techprepServerUrl` in
`desktop/package.json`. `build-windows.cjs` validates it before building and
puts it at the top level of the packaged `package.json`. To build for another
deployment without changing the source default:

```powershell
$env:TECHPREP_SERVER_URL = "https://other-trusted-server.example:5173/"
npm --prefix desktop run dist:win
```

This must be an absolute HTTPS root URL with no username, password, query,
fragment, or non-root path. Build configuration never includes credentials.
`APP_URL` is the separate runtime override; setting it while building does not
change the embedded default. No automatic updater or external publishing is
enabled (`publish: "never"`). The runtime and builder are pinned at
Electron 44.7.1 and electron-builder 26.15.3. This LAN build is unsigned and for
local testing only; use the production release below for distribution.

#### Linux cross-build actually used

The normal build was attempted first and failed because Wine was missing.
Disabling executable resource editing alone also failed: NSIS needs Wine to
generate its uninstaller. No system packages, sudo, or global settings were
changed. A complete portable Wine 11.0 WoW64 build was downloaded into the
ignored `desktop/release/build-tools/` directory. An earlier, stripped
electron-builder Wine bundle could not initialize and was not used.

Exact successful setup/build commands (from this host):

```bash
cd /home/natraj/techprep./desktop
source "$HOME/.nvm/nvm.sh"
mkdir -p release/build-tools release/build-work
curl -fL --retry 2 \
  https://github.com/Kron4ek/Wine-Builds/releases/download/11.0/wine-11.0-amd64-wow64.tar.xz \
  -o release/build-tools/wine-11.0-amd64-wow64.tar.xz
tar -xf release/build-tools/wine-11.0-amd64-wow64.tar.xz -C release/build-tools
export PATH="$PWD/release/build-tools/wine-11.0-amd64-wow64/bin:/home/natraj/.nvm/versions/node/v20.20.2/bin:$PATH"
export TMPDIR="$PWD/release/build-work"
export WINEPREFIX="$PWD/release/build-tools/wine-wow64-prefix"
export WINEDEBUG=-all WINEDLLOVERRIDES='mscoree,mshtml='
mkdir -p "$WINEPREFIX/dosdevices"
test -L "$WINEPREFIX/dosdevices/t:" || ln -s "$PWD" "$WINEPREFIX/dosdevices/t:"
wine wineboot -u
# Windows strips a trailing dot from a path component. Both mappings below
# are needed for this particular "techprep." checkout.
export TECHPREP_BUILD_OUTPUT="/proc/$$/cwd/release/windows-installer"
npm run dist:win
node --test test/server-url.test.cjs test/main-process.test.cjs
```

`TECHPREP_BUILD_OUTPUT` only changes the builder's work/output directory; the
published download stays at `release/TechPrep-Setup.exe`. Keep the shell alive
until the build completes when using its `/proc/$$/cwd` path. On an ordinary
Windows checkout, just use `npm run dist:win`; Wine and these Linux environment
variables are unnecessary.

The build completed with normal executable resource editing enabled. The
installer is **81,706,403 bytes** (about 77.92 MiB), SHA-256:

```text
f93b07603fac266ca4090a5b47165d872f3e2a200ade4fa2affae34f70f7024a
```

`file` identified the installer as a PE32 Nullsoft self-extracting archive
(the NSIS bootstrap is 32-bit), containing the x64 PE32+ `TechPrep.exe`.
The installer payload was extracted with the existing `7zip-bin` tool:
`resources/app.asar` contains only the six allowlisted shell files, including
`server-url.js` and `package.json`. Its embedded HTTPS URL, exact JavaScript
source contents, TechPrep/version executable resources, and absent Authenticode
signature were checked. No `.env`, private keys, CA certificate, browser
credentials, backend, frontend source, or build tools are included.
The targeted Node tests passed **17/17**. This Linux build does not establish
Windows launch/install, certificate trust, audio, or capture behavior; verify
those on a real Windows machine before wider distribution.

### macOS (Terminal)

Set backend environment variables securely in this terminal; the commands do
not source `.env`. Homebrew or another supported Python distribution may be
needed; do not assume `/usr/bin/python3` supports the project.

```bash
cd services/api-fastapi
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

In another terminal at the root:

```bash
npm --prefix desktop start
npm --prefix desktop run pack:mac
npm --prefix desktop run dist:mac
```

`pack:mac` produces an unpacked `.app`; `dist:mac` produces DMG and ZIP files
under `desktop/release`. By default it uses the build host architecture.
To select both architectures from a macOS host:

```bash
cd desktop
npm run build
npx --no-install electron-builder --mac --x64 --arm64
```

Release signing/notarization must run on macOS with Xcode Command Line Tools,
an Apple Developer ID Application identity, and appropriate notarization
credentials. Configure electron-builder signing credentials via secure
environment/CI secret storage (`CSC_LINK`/`CSC_KEY_PASSWORD` as appropriate);
for notarization use its supported Apple ID/app-specific password/team ID or
App Store Connect API credentials. See the
[builder signing guide](https://www.electron.build/code-signing-mac.html).
For Windows, see [Production signed release](#production-signed-release).
No signing identities or secrets are supplied by this project.

The macOS configuration enables hardened runtime and supplies JIT and audio
input entitlements for Electron and helpers. The microphone and screen-capture
usage descriptions explain existing capture functionality. Screen Recording
permission in System Settings is relevant to **recording other content**, not
to protecting this window. Protecting the overlay itself requires no special
permission or entitlement. No Accessibility permission or native addon is
required. This is a Developer ID distribution configuration, not a Mac App
Store sandbox configuration.

macOS and Windows now request loopback audio through the desktop display-media
handler using basic audio/video capture constraints; microphone-processing
constraints are not valid for display capture. Linux still uses the PulseAudio
monitor path. Transcription and AI code paths are unchanged.

## Microsoft Store package (AppX)

The Store release is separate from the signed NSIS installer below. Partner Center accepts
electron-builder's `.appx` output for an MSIX/AppX submission and signs the package after
certification. This unsigned package is **only** for upload to the Store; it is not the
download served by the TechPrep website and cannot be installed normally outside the Store.

On a Windows 10/11 x64 PC with Node.js 22.12+ and the updated project files, run in
PowerShell from the project root:

```powershell
npm --prefix desktop ci
npm --prefix desktop test
$env:TECHPREP_SERVER_URL = "https://13-201-213-33.sslip.io/"
npm --prefix desktop run store:win
```

Find `desktop/release/store/TechPrep-Store-0.1.1-x64.appx` (the version in the filename
follows `desktop/package.json`). Upload **that `.appx` file**, not `TechPrep-Setup.exe`,
under Partner Center > TechPrep > Submission > Packages. The Store build uses the
reserved identity `NatrajG.TechPrep`, publisher
`CN=97ACEC83-5AB4-4DE7-B316-690EEA92CAF5`, and publisher display name `NatrajG`;
check these still match Product identity exactly before uploading. It embeds the public
HTTPS server URL; the API and web UI stay on Lightsail and must remain available.
The package targets Windows 10 2004+ (x64) and declares internet access and
`runFullTrust` for the Electron desktop application. Store updates must increment
the desktop package version. AppX tile assets in `desktop/build/appx/` and the
Windows executable icon in `desktop/build/icon.ico` must ship with the source
used by the Windows build; the Store listing's 300px icon alone does not change
the installed app's tiles. If you need to test the package outside the Store,
sign a **separate copy** with a locally trusted test certificate or use a Store flight;
the upload artifact itself is not a general-purpose signed installer.

Alternatively, after the updated source is in your GitHub repository, run
**Actions > Windows Store package > Run workflow**. Download the
`techprep-store-appx` artifact from that run, extract it, and upload the `.appx`
inside to Partner Center. The Windows runner builds only the desktop shell;
customers never build or download the source. Keep the archive private until
submission, and confirm the embedded server URL before uploading. GitHub Actions
usage may be billed depending on your repository and plan.

On the production website, the Windows download panel shows "Microsoft Store release
coming soon" until the app has passed certification and its listing is installable.
After publication, set `STORE_APP_PUBLISHED=true` in the server's
`infra/lightsail/production.env` and rerun `infra/lightsail/deploy.sh`.
The panel then opens the Store listing (`9N36X6C5706B`); users install there and
sign in to the desktop app, which still connects to the Lightsail server.
The website's `.exe` endpoint remains reserved for the separate signed installer;
the Store signature cannot be used to distribute that `.exe` from Lightsail.

## Production signed release

`npm --prefix desktop run release:win` (or the manual *Windows signed release* GitHub workflow)
builds the distributable installer. It refuses to run unless all of these hold:

- It runs **on Windows** (signing and verification use Windows tools).
- `TECHPREP_SERVER_URL` is a public DNS HTTPS root (no IP, LAN name, custom port, or path),
  e.g. `https://techprep.duckdns.org/`. The installer embeds it; users need no configuration
  and no certificate import.
- `TECHPREP_SIGNER_SHA1` is the SHA-1 thumbprint of your code-signing certificate.

Signing: with `CSC_LINK`/`CSC_KEY_PASSWORD` (a PFX), or otherwise with the certificate in the
Windows certificate store selected by thumbprint (hardware token or cloud-signing service that
provides a Windows KSP). `forceCodeSigning` makes an unsigned build fail. Optional
`TECHPREP_TIMESTAMP_URL` overrides the RFC 3161 timestamp server.

After building, both `win-unpacked/TechPrep.exe` and `TechPrep-Setup.exe` must report
`Get-AuthenticodeSignature` status **Valid**, the expected thumbprint, and a timestamp.
Only then are `TechPrep-Setup.exe` and `desktop-release.json` (schema 1: file, version,
serverUrl, size, sha256, `signed: true`, signer, builtAt) written to
`desktop/release/production/publish/`. The server serves the installer only when that manifest
matches it. The installer is a per-user one-click NSIS installer; no administrator rights needed.

Obtaining credentials: a publicly trusted OV/EV code-signing certificate requires identity
validation by a certificate authority, and new certificates must keep the private key on a
hardware token, HSM or cloud signing service (so a plain PFX is usually unavailable).
A self-signed certificate does **not** make Windows trust the installer. Signing identifies the
publisher; it does not guarantee immediate SmartScreen reputation, and it cannot override
device policies such as "Your admin caused Windows Security to block this action".

## Automated coverage and actual results

The existing GitHub Actions workflow now also runs the desktop tests on
Linux, Windows and macOS, with unsigned unpacked packaging on the two desktop
targets. Those hosted jobs have not been executed in this local session.

`npm --prefix desktop test` uses Node's built-in test runner. Tests mock the
Electron window and IPC APIs, exercise the actual main/preload wiring, and
render the settings component with the existing React/esbuild dependencies.
They cover OS/version/API capability, enable/disable, creation/recreation,
pre-show initialization ordering, restart persistence, invalid settings,
unsupported platforms, API/IPC/storage failures, sender restrictions, and
rendered status/checkbox/alert/retry behavior.

Earlier baseline checks on the Linux development host (before the downloadable
installer work documented above):

| Command/result | What it proves |
| --- | --- |
| Unit tests: 44 passed, 0 failed | JavaScript behavior and mocked integration, not real native capture exclusion. |
| `npm --prefix desktop run build`: passed | Updated React production assets compile. |
| `npm --prefix desktop run pack:win`: failed, Wine missing | Normal Windows resource editing is not available on this host. |
| `electron-builder --win --x64 --dir -c.win.signAndEditExecutable=false`: completed | Unsigned unpacked Windows shell assembly only; resource editing was explicitly skipped for this local check. |
| `CSC_IDENTITY_AUTO_DISCOVERY=false electron-builder --mac --arm64 --dir -c.directories.output=release/mac-check`: completed | Unsigned macOS arm64 app assembly only; signing was skipped on Linux. |

The unsigned directory outputs were inspected for their executable formats
and archive contents. They have **not** been launched on Windows or macOS.
Those earlier checks did not produce an installer. The later NSIS result is
documented above. No signed/notarized build, DMG, real screen capture, physical
OS regression run, or pixel-perfect screenshot comparison is claimed.

## Manual verification on actual operating systems

Use harmless sample text, not confidential information, while testing. Keep
an unprotected control window beside the overlay. Record OS version/build,
architecture, Electron version, app version, capture tool version, capture
backend, share mode, and outcome (visible, blank, omitted).

1. Start the backend and shell on Windows 10 2004+/Windows 11 or macOS 11+.
   Verify a first-use off checkbox and "Disabled by you". Enable it and confirm
   "Protection requested (best effort)" with the platform caveat.
2. Start capture with protection off, then turn it on during capture, wait for
   subsequent frames, and turn it off again. Repeat with protection enabled
   before starting capture. Inspect the actual saved recording or receiver's
   view, not only the source picker or local preview.
3. On Windows use Snipping Tool/Print Screen, OBS Display Capture and Window
   Capture (record which capture backend each uses), and current Teams/Zoom
   whole-display and application-window sharing. Compatible paths should omit
   the protected window on 2004+; older Windows 10 can show black/blank instead.
   Treat any visible overlay as an unsupported/bypassed path, not a success.
4. On macOS compare Screenshot toolbar (`Shift+Command+5`) still/recording,
   QuickTime screen recording, OBS macOS Screen Capture (ScreenCaptureKit),
   and Teams/Zoom sharing. Where available, separately test a known legacy
   CoreGraphics capture path. Expect ScreenCaptureKit to be able to capture
   the overlay; it is not a supported exclusion path.
5. Restart the application with the setting on, then off, using the same
   origin/profile. Reload the renderer and exercise window recreation in a
   development lifecycle harness. Check initial frames for flashes and confirm
   the preference/status are reapplied. Repeat after minimize/restore, moving
   between displays, resizing and changing opacity/on-top.
6. On Linux confirm an unsupported explanation and disabled toggle, even if
   the profile contains a saved true preference. Confirm drag, resize,
   minimize/close and ordinary use remain available.
7. Confirm Enter-to-answer, manual question input, profile persistence,
   transcription and streamed answers with a configured backend. Verify
   Linux monitor audio plus Windows and macOS loopback paths separately.
8. Repeat against the actual packaged/signed application on Intel/Apple
   Silicon macOS and supported Windows targets, including permission-denied
   capture scenarios. Verify signatures/notarization with `codesign` and
   `spctl` on macOS, and the Authenticode signature on Windows.

The public macOS API cannot satisfy a requirement to hide the overlay from
all modern recording mechanisms. Linux native exclusion, universal Windows
capture exclusion, and actual physical-OS results remain unsupported or
unverified as described above.

## Files inspected and changed

Inspected: desktop main/preload/package manifests and installed Electron
metadata; the full React renderer, entry/layout and Vite configuration;
`run.sh`; FastAPI's static UI serving and AI environment handling; README,
desktop ignore rules, and CI configuration. No secrets were read.

Modified:

- `desktop/main.js`, `desktop/preload.js`: controller/IPC/lifecycle integration,
  platform-scoped Linux launch switch, and separate-backend startup behavior.
- `desktop/package.json`, `desktop/package-lock.json`, `desktop/.gitignore`:
  pinned runtime, approved packager, scripts, build targets and output ignore.
- `frontend/react-web/src/App.jsx`: saved preference wiring and desktop styling.
- `README.md`, `.github/workflows/ci.yml`: updated behavior and platform jobs.

Added:

- `desktop/capture-protection.js`, `desktop/overlay-window.js`: capability,
  state and pre-show lifecycle logic.
- `desktop/entitlements.mac.plist`: macOS packaging entitlements.
- `frontend/react-web/src/capture-protection.mjs`,
  `frontend/react-web/src/CaptureProtectionSettings.jsx`,
  `frontend/react-web/src/overlay.css`: preference helpers, status UI and theme.
- `desktop/test/capture-protection.test.cjs`,
  `desktop/test/renderer-protection.test.cjs`,
  `desktop/test/protection-ui.test.cjs`,
  `desktop/test/main-process.test.cjs`: automated coverage.
- `docs/desktop-capture-protection.md`: this implementation and verification guide.

Generated outputs: React `dist` assets and ignored unsigned desktop package
directories under `desktop/release`.

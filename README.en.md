# CAD AI Bridge

**v0.2.0-preview.1 — Windows user preview.** Tested on Windows 10 x64, Chinese AutoCAD 2022, optional Tangent Electrical V8.0 and WorkBuddy 5.3.8. Internal package/plugin compatibility version remains 0.2.0. [Release notes](docs/releases/v0.2.0-preview.1.md).

1. Download `cad-ai-bridge-0.2.0-preview.1-windows-x64.zip` from this repository's Releases and extract it to a writable user folder. GitHub's automatic Source code ZIP does not include the plugin and portable runtimes.
2. Run `connect-workbuddy.cmd`. In WorkBuddy's custom connectors, trust `cad-ai-bridge` once and wait for its tools to load.
3. Start a task: “Use CAD AI Bridge to check the connection, draw two lights 3000 mm apart, connect WL1, number them L-001 and L-002, save and reopen to verify, and return the DWG/DXF files.”

The ZIP includes official portable Node/PowerShell archives and locked dependencies, allowing offline bridge setup without administrator rights, development tools or a model API key. Your own normally licensed AutoCAD installation is required. Keep the old folder when upgrading; `restore-workbuddy.cmd` restores the previous connector and Skill. [Installation and validation](docs/windows-user-release.md).

**Clean Windows and a separate standard-account acceptance remain unverified.** Local VM acceptance is deferred. Other CAD versions and clients require their own verification. Clients supporting local stdio MCP can import `mcp-config.local.json`; install the portable Skill through the client's own mechanism.

[中文](README.md) · [Packaging and release preparation](docs/releasing.md) · [Reproducible example](examples/electrical/README.md)

CAD AI Bridge connects existing CAD software to the user's AI client through MCP and portable Skill guidance. The current preview provides local MCP and CLI tools for AutoCAD electrical workflows: identify devices, read circuits, produce takeoffs, place symbols, connect explicit routes and number devices.

The [project improvement plan (Chinese)](docs/connector-plan.md) prioritizes simpler setup, reliability and execution efficiency while preserving validated capabilities. School generation is a regression sample, and clients such as WorkBuddy are interoperability test targets. Persistent sessions and broader commands remain follow-up options, subject to demonstrated benefits.

[中文](README.md) · [Technical plan](docs/technical-plan.md) · [Tool contracts](docs/tools.md)

## Build from source

Source development requires Node.js 22.19+, PowerShell 7+, .NET Framework 4.8 and your own normally licensed CAD installation.

```powershell
npm ci
npm run setup -- --workspace "."
npm run demo
```

Setup discovers installed CAD, verifies or builds this project's plugin and generates `mcp-config.local.json`. Import that generated file into a client supporting local MCP stdio. Existing client configuration is not overwritten unless an explicit merge target is supplied. No model API key or REA runtime is required.

For WorkBuddy, run `connect-workbuddy.cmd` to prepare the environment, merge the custom MCP entry and install the self-contained Skill with backups. Existing services and the generated connector proxy are preserved. Enable the connector in WorkBuddy and start a new task. [Setup instructions and desktop validation limits (Chinese)](docs/workbuddy.md).

The WorkBuddy 5.3.8 desktop workflow passed user-assisted acceptance: first-trust confirmation, global Skill invocation, 15 connected tools, an atomic drawing task, saved readback and delivered file cards. The user confirmed visibility and manual opening. Embedded CAD preview and direct card-to-CAD opening are not claimed.

Setup now reuses a verified matching plugin; use `--rebuild` to rebuild explicitly. `setup.cmd` reuses locked dependencies and prepares missing portable runtimes from bundled ZIPs or SHA-256-pinned official downloads without system installers. `--client-config <file>` merges only this server entry and backs up the original. `cad_doctor` remains available when CAD configuration is missing, and `cad_get_job` recovers recorded results without launching CAD or replaying writes. A saved DWG remains available even when subsequent export or cleanup fails.

```powershell
npm run doctor
node bin/cadbridge.mjs demo --host tangent
node bin/cadbridge.mjs mcp --read-only
```

Writes operate on snapshots and save new DWGs. Document identity, SHA-256, revision checks, atomic batches and persistent request IDs protect against stale or duplicate edits. Tangent reads return a compact summary; `cad_read_result` retrieves bounded pages without another CAD launch.

Native acceptance covers five synthetic devices, two circuits, numbering, save/reopen and 12000 mm of routes. The installed vendor example yields 34 recognized lighting/socket devices and 28 wires. Native interpretation resolves architectural objects that appear as proxies in CoreConsole.

Writes support ordinary managed blocks, synthetic Tangent fixtures and verified local engineering instances cloned in prepared project copies. Scales, layers and source attributes are retained, routes use explicitly selected geometric anchors, and new instance numbering does not replace professional name tags. Geometry is planar WCS with declared mm units. Raw census, independent DXF checks and AUDIT repair copies are available. See [engineering-copy validation](docs/project-validation.md).

`node bin/cadbridge.mjs school examples/school-requirements.json` creates an original two-floor, six-classroom school demonstration from a bounded requirements model. It produces editable DWG/DXF, 14 A2 vector PDF sheets, circuit and equipment CSVs, calculations, CAD readback evidence and a delivery manifest. Python with reportlab/pypdf is required; set `CADBRIDGE_PYTHON` to select it. `cad_create_drawing` exposes declarative scene creation over MCP. See the [school workflow, assumptions and review scope](docs/school-project.md). The result is a design-development example pending professional review, not an approved construction design. Photometry, short-circuit protection, grounding and site interfaces require actual inputs.

Root instance counts include legends and repeated views. Circuit label groups do not resolve board/feeder identities; unresolved circuitCount is null. Empty wire metadata and unclassified candidates are reported separately. Observed XData support is not a complete Tangent SDK, native annotation/topology implementation or engineering compliance check. Nested blocks, xrefs, arbitrary external library import and native cable-tray creation require further adapters.

```powershell
npm test
npm run test:cad
npm run test:tangent
node tests/mcp-results.mjs
npm run check
```

Runtime evidence and local settings are Git-ignored. Vendor binaries, libraries, sample drawings and actual engineering documents are not distributed. Independent examples are reproducible from source. See [MIT](LICENSE), [contribution guidelines](CONTRIBUTING.md) and [third-party notices](THIRD_PARTY_NOTICES.md).

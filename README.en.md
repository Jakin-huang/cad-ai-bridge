# CAD AI Bridge

[中文](README.md) · [Packaging and release preparation](docs/releasing.md) · [Reproducible example](examples/electrical/README.md)

Local MCP and CLI tools for AutoCAD electrical workflows: identify devices, read circuits, produce takeoffs, place symbols, connect explicit routes and number devices.

[中文](README.md) · [Technical plan](docs/technical-plan.md) · [Tool contracts](docs/tools.md)

The 0.2 developer preview is tested on Windows x64, Chinese AutoCAD 2022 and Tangent Electrical V8.0. It requires Node.js 22.19+, PowerShell 7+, .NET Framework 4.8 and your own normally licensed CAD installation.

```powershell
npm ci
npm run setup -- --workspace "."
npm run demo
```

Setup discovers installed CAD, compiles this project's plugin and generates `mcp-config.local.json`. Import that generated file into a client supporting local MCP stdio. Existing client configuration is not overwritten. No model API key or REA runtime is required.

```powershell
npm run doctor
node bin/cadbridge.mjs demo --host tangent
node bin/cadbridge.mjs mcp --read-only
```

Writes operate on snapshots and save new DWGs. Document identity, SHA-256, revision checks, atomic batches and persistent request IDs protect against stale or duplicate edits. Tangent reads return a compact summary; `cad_read_result` retrieves bounded pages without another CAD launch.

Native acceptance covers five synthetic devices, two circuits, numbering, save/reopen and 12000 mm of routes. The installed vendor example yields 34 recognized lighting/socket devices and 28 wires. Native interpretation resolves architectural objects that appear as proxies in CoreConsole.

Writes support ordinary managed blocks, synthetic Tangent fixtures and verified local engineering instances cloned in prepared project copies. Scales, layers and source attributes are retained, routes use explicitly selected geometric anchors, and new instance numbering does not replace professional name tags. Geometry is planar WCS with declared mm units. Raw census, independent DXF checks and AUDIT repair copies are available. See [engineering-copy validation](docs/project-validation.md).

Root instance counts include legends and repeated views. Circuit label groups do not resolve board/feeder identities; unresolved circuitCount is null. Empty wire metadata and unclassified candidates are reported separately. Observed XData support is not a complete Tangent SDK, native annotation/topology implementation or engineering compliance check. Nested blocks, xrefs, arbitrary external library import and native cable-tray creation require further adapters.

```powershell
npm test
npm run test:cad
npm run test:tangent
node tests/mcp-results.mjs
npm run check
```

Runtime evidence and local settings are Git-ignored. Vendor binaries, libraries, sample drawings and actual engineering documents are not distributed. Independent examples are reproducible from source. See [MIT](LICENSE), [contribution guidelines](CONTRIBUTING.md) and [third-party notices](THIRD_PARTY_NOTICES.md).

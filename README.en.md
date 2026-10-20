# CAD AI Bridge

A local MCP and Skill connector between your existing CAD software and AI client. The preview preserves read, takeoff, constrained batch editing, file protection, task recovery and pagination capabilities.

**v2.0.0-preview.1 development candidate.** Adds durable multi-drawing projects, tiered verification, traceable engineering quantities/checks, a loopback task center, native batch exports, backend contracts and reproducible evaluation. Final acceptance is tracked in the [implementation ledger](docs/v2-implementation.json). The existing verified host baseline is Windows 10 x64, Chinese AutoCAD 2022 and optional Tangent Electrical V8. Development, local automated validation and external usability are separate conclusions. Use your own normally licensed software.

Extract the complete user ZIP, open **开始使用.exe**, choose your drawing folder and connect WorkBuddy. Complete its first-trust confirmation and select the connector in your task. The [offline illustrated guide](使用说明.html) explains the steps. Portable runtimes, locked dependencies and the project plugin are included; development tools and administrator rights are unnecessary.

**No drawings, example datasets, test previews, private libraries or historical test deliverables are distributed in source or release packages.** Supply your own inputs. Runtime jobs live in per-user data storage; maintainer test data and release staging live outside the source project. [Data separation](docs/asset-separation.md)

Source development requires Node.js 22.19+, PowerShell 7+, .NET Framework 4.8 and AutoCAD 2022. Run npm ci and setup.cmd. Other local stdio MCP clients can import the generated mcp-config.local.json and install the portable Skill through their own mechanism.

Run npm test and npm run check -- --static for source verification. Tests requiring private requirement files explicitly skip when those external inputs are absent. Real CAD verification requires a licensed local host and writes outputs outside the repository.

Clean Windows, a separate standard account, browser download prompts and other CAD/client versions remain unverified. Prior WorkBuddy desktop acceptance is user-assisted; embedded CAD preview and unattended desktop setup are not claimed.

[中文](README.md) · [Release notes](docs/releases/v2.0.0-preview.1.md) · [Tools](docs/tools.md) · [Contributing](CONTRIBUTING.md) · [MIT](LICENSE) · [Third-party notices](THIRD_PARTY_NOTICES.md)

The 24 tools include cad_project, cad_analyze, cad_capabilities, cad_workflow, cad_scan_drawing and experimental cad_session. Capture up to 100000 entities once, then filter/project/page its hash-bound local index without restarting CAD. Combine edit, final CSV and PDF/PNG delivery in one workflow with compact replies and explicit takeoff exclusions. Verification levels distinguish saved bytes, reopening, geometry, preservation, rendering and independent visual review. Projects freeze inputs, retain per-drawing copies and resume only unstarted work. Quantity rules retain object/instance provenance and missing measurements. Open 任务中心.cmd after setup for the loopback browser UI. Local nested blocks and paper layouts remain read-only. See [v2 scope and evidence](docs/v2-usage.md).

The original 18 tools retain scoped editing, managed route updates, dimensions, layouts, and actual CAD PDF/PNG plotting. Optional Tangent V8 support includes real independent straight channel-type (槽式) cable trays, catalog-matched dimensions/models and associated proprietary labels through cad_edit. See [editing scope](docs/editing.md) and [native tray limits](docs/native-trays.md). Connected fittings, other tray families and complete vendor statistics remain outside scope.

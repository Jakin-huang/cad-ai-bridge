# Changelog

## Unreleased: engineering drawing validation

- Add a local V02 standard profile with native DWG audit, complete block catalog, source-bound cable rules, supplemental engineering legends and source hash verification.
- Generate per-panel single-line diagrams and a provenance legend sheet; support solid triangles, polyline widths and text width factors with independent readback and rendering.
- Keep local standard assets out of public source packages and block public example packaging of derived private drawings.

- Add a requirements-driven school project workflow with original geometry and symbols, bounded scene creation, load/lighting/voltage-drop estimates, circuit ownership, device numbering and explicit review boundaries.
- Generate editable DWG/DXF, A2 vector PDF sheets, equipment/circuit CSVs, project calculations and a hashed delivery manifest; verify saved entities, text, attributes and routes with fresh CAD and independent DXF readback.
- Add `cad_create_drawing` and optional layers for new placements/routes; read-only mode hides scene creation as a write tool.

- Audit raw model-space inserts, definitions, text and XData applications, export independent DXF, and compare entities, attributes, wire fields and geometry.
- Recognize additional observed fire, weak-current, switch, board, power and legacy device markers; exclude entirely empty wire metadata and distinguish label groups from resolved circuits.
- Prepare managed engineering copies, deep-clone verified local electrical instances, preserve source properties, use explicit local connection anchors and add instance-owned numbering.
- Bound large MCP replies automatically, retain full evidence for pagination, and accommodate large local audit results.
- Preserve normal full-suite initialization order and bootstrap drawing opens; retain source hashes, original entities, rollback and request replay evidence.

## 0.2.0 preview

- Detect local AutoCAD 2022 and Tangent V8 installations and generate project-owned MCP configuration with backups.
- Add a native Tangent GUI host alongside CoreConsole, ordinary tip suppression with restoration, explicit kernel preload and bounded owned-process execution.
- Read observed Tangent devices, wire specifications and circuits, and report unresolved units and proxy coverage.
- Create independent lighting/socket fixtures and verify batch placement, routes, numbering, save/reopen and statistics.
- Return compact Tangent summaries with local result pagination; support read-only MCP tool discovery.
- Pin independent runtime dependencies and add project documentation, reusable electrical workflow instructions and release checks.

## 0.1.0 local MVP

- CoreConsole .NET plugin for ordinary blocks, explicit planar routes, numbering, takeoff and validation.
- File digest and document revision checks, transactional rollback and persistent request replay handling.

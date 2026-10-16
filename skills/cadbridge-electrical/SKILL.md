---
name: cadbridge-electrical
description: Audit electrical drawing copies, read device and circuit metadata, place synthetic or verified local engineering symbols, connect explicit anchors, number devices and verify saved DWGs through CAD AI Bridge MCP.
---

Use the connected CAD AI Bridge tools. Setup, compatibility and current write limits are described in the repository README; do not install clients or change other application settings merely by invoking this skill.

For existing Tangent drawings, begin with `tangent_inspect`. Its default summary includes coverage, units and a job ID. Retrieve necessary device, wire or circuit records using `cad_read_result`; this does not restart CAD. Select `host: tangent` when native objects need interpretation, or use CoreConsole for ordinary blocks and XData. Report proxies, excluded nested blocks and unclassified entities as coverage limitations.

Undefined drawing units require the user's explicit unit decision before distance-sensitive work. Read-only length conversion accepts `units: mm` and records that assumption. It does not change drawing units or establish an engineering standard.

For the reproducible drawing workflow:

1. Create a template with `cad_create_test_drawing`, optionally `adapter: tangent-v8`.
2. Use its returned file digest, document ID and revision in `electrical_apply`, with a new request UUID. Combine `place_symbols`, `connect_route` and `number_devices` in one atomic request.
3. Test ports `PWR` are insertion-point ports. Provide explicit planar WCS paths whose endpoints match those ports. Synthetic writes use mm and approved fixture definitions.
4. Read the returned new DWG with `tangent_takeoff` or `electrical_takeoff`, then `electrical_validate`. Check saved counts, circuits, geometry lengths and numbers before claiming completion.

`DEVICE_ID` is the bridge's device number; `linenum` is the observed circuit field on new adapter routes. These do not establish the complete Tangent annotation/topology model. Do not treat a drawing count as a load calculation or infer regulatory compliance.

For engineering drawings, use `cad_audit_drawing` and pages of inserts/definitions to verify local ordinary templates and geometry. `cad_prepare_project` creates a managed copy of an explicitly mm drawing. In `electrical_apply`, use `clone_project_symbols` with the audited templateHandle and an explicit local portOffset; preserve the instance scale, layers, attributes and XData. Select geometric anchors from actual definition geometry and check the transformed WCS endpoints. Do not infer manufacturer terminals. New DEVICE_ID attributes belong only to new instances; do not overwrite professional name tags. `cad_repair_copy` runs AUDIT on a separate copy when database export fails; compare repaired electrical records and retain repair evidence before using it.

Counts include legends and repeated views unless a scope has been established externally. Report circuitLabelCount separately; unresolved circuitCount is null. Empty metadata and unclassified electrical blocks are review items. Large requested full replies can become bounded summaries; follow responseTruncated and the paging entry instead of repeating a CAD call.

After a timeout or unknown save state, inspect the retained job evidence before retrying. A request UUID is idempotent within the saved DWG branch only. A conflict or stale digest/revision requires a new inspection and a deliberate update; do not silently regenerate IDs to evade it.

Return the new DWG path, statistics, validation result and any material coverage gap. Source drawings are preserved by the bridge. Do not expose unrelated local paths or include installed vendor files in shared examples.

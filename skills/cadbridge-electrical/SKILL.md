---
name: cadbridge-electrical
description: Read electrical devices and circuits, batch place synthetic symbols, connect routes, number devices and verify saved DWGs through CAD AI Bridge MCP. Use for this bridge's AutoCAD electrical workflows and observed Tangent V8 data.
---

Use the connected CAD AI Bridge tools. Setup, compatibility and current write limits are described in the repository README; do not install clients or change other application settings merely by invoking this skill.

For existing Tangent drawings, begin with `tangent_inspect`. Its default summary includes coverage, units and a job ID. Retrieve necessary device, wire or circuit records using `cad_read_result`; this does not restart CAD. Select `host: tangent` when native objects need interpretation, or use CoreConsole for ordinary blocks and XData. Report proxies, excluded nested blocks and unclassified entities as coverage limitations.

Undefined drawing units require the user's explicit unit decision before distance-sensitive work. Read-only length conversion accepts `units: mm` and records that assumption. It does not change drawing units or establish an engineering standard.

For the reproducible drawing workflow:

1. Create a template with `cad_create_test_drawing`, optionally `adapter: tangent-v8`.
2. Use its returned file digest, document ID and revision in `electrical_apply`, with a new request UUID. Combine `place_symbols`, `connect_route` and `number_devices` in one atomic request.
3. Test ports `PWR` are insertion-point ports. Provide explicit planar WCS paths whose endpoints match those ports. Current writes use mm and approved synthetic definitions; do not substitute arbitrary vendor blocks.
4. Read the returned new DWG with `tangent_takeoff` or `electrical_takeoff`, then `electrical_validate`. Check saved counts, circuits, geometry lengths and numbers before claiming completion.

`DEVICE_ID` is the bridge's device number; `linenum` is the observed circuit field on new adapter routes. These do not establish the complete Tangent annotation/topology model. Do not treat a drawing count as a load calculation or infer regulatory compliance.

After a timeout or unknown save state, inspect the retained job evidence before retrying. A request UUID is idempotent within the saved DWG branch only. A conflict or stale digest/revision requires a new inspection and a deliberate update; do not silently regenerate IDs to evade it.

Return the new DWG path, statistics, validation result and any material coverage gap. Source drawings are preserved by the bridge. Do not expose unrelated local paths or include installed vendor files in shared examples.

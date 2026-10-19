---
name: cadbridge-electrical
description: "通过 CAD AI Bridge 查询、编辑和统计已有 CAD 图纸，批量移动复制旋转、修改属性与图层、标注出图、调整受管理电气路线，保存并校验新 DWG。Query and edit CAD drawings, annotate, plot PDF/PNG, and verify saved copies through the connected bridge."
---

Use the connected CAD AI Bridge tools. Setup, compatibility and current write limits are described in the repository README; do not install clients or change other application settings merely by invoking this skill.

If the client cannot discover any bridge tools, report a disconnected MCP integration rather than a CAD or plugin failure. Loading this Skill does not connect the server. For local stdio, the AI client launches the MCP process; the bridge starts its own CAD worker when needed. Do not tell users to manually start the Bridge, keep CAD open, or load its plugin as a prerequisite for tool discovery. In WorkBuddy, distinguish an installed global Skill, a configured custom connector, and tools actually available to this task. A proxy description mentioning the server is not proof of a successful connection. Use the client's listed tool names (prefixes vary); if reconnecting is needed, preserve the existing configuration and client trust, then verify discovery in a new task. When tools remain missing, return the observed discovery failure without claiming a drawing was created or presenting old files as this task's output.

If a tool reports missing configuration, workspace, PowerShell, CAD or plugin, call `cad_doctor` and explain its failing checks. The diagnostic tool does not launch CAD. Do not ask the user to supply document IDs, hashes, request UUIDs or task paths; carry these from tool results and generate UUIDs as part of the workflow.

When the user requests a drawing task, discover the connected tools by their names or suffixes; clients may prefix them with the server name. Do not run source setup, install dependencies or rebuild a plugin for a normal drawing task. For a first connection check, call `cad_doctor`. For a synthetic demonstration, use `cad_create_test_drawing` and then a single atomic `electrical_apply`; carry the returned drawing identity and digest automatically. Reply in the user's language with the saved file and measured checks.

For a school project from requirements, read [the standalone school workflow scope](references/school-workflow.md). This workflow needs the separately installed bridge CLI; it is not a generic MCP school tool. It supports a bounded teaching-building template and produces a new delivery directory. Record explicit architecture, supply, equipment and standards assumptions; preserve pending professional reviews. The generated model owns circuit identities, unlike unresolved labels read from arbitrary existing DWGs. Its calculations do not establish photometry, native Tangent associations or construction approval.

For a custom original drawing, `cad_create_drawing` accepts only declarative layers, local ordinary symbols, polylines, circles and text. It creates a new mm drawing; then use `electrical_apply` for managed placements, routes and numbering. Use `electrical_takeoff` for these ordinary bridge objects. Do not claim they are vendor-native electrical entities. Inspect saved DWG and independent DXF evidence before delivering a model-derived PDF.

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

For one logical modification, combine placements, explicit routes and numbering in the same `electrical_apply` request (up to the declared 100-operation bound). Do not split a valid atomic task into one CAD launch per device or wire. Query only the needed fields and pages. Existing managed snapshots can be paged using `managedDevices`, `routes`, `symbols` and `issues`; `devices` continues to mean Tangent-classified devices. Result pages never launch CAD.

After a timeout, disconnect or unknown save state, call `cad_get_job` with the returned jobId. If the reply was lost, look up the original requestId and then read the relevant jobId. This query never launches CAD and works without CAD configuration. Check `outcome`, `drawingSaved`, `mutationCommitted` and any retained output. A saved DWG can survive failed DXF export or host cleanup; do not replay its write to obtain the result. An `unconfirmed` state requires checking retained evidence and is not permission to retry. A request UUID is idempotent within the saved DWG branch only. A conflict or stale digest/revision requires a new inspection and a deliberate update; do not silently regenerate IDs to evade it.

Return the new DWG path, statistics, validation result and any material coverage gap. Source drawings are preserved by the bridge. Do not expose unrelated local paths or include installed vendor files in shared examples.

When the client offers a file presentation tool, publish the exact returned DWG/DXF paths through it so users receive file cards or usable links; WorkBuddy exposes `present_files`. Do not copy large drawings into another workspace just to display them when absolute paths are accepted. Report file delivery separately from preview and opening: a successful presentation with `previewed: []` confirms file cards, not embedded CAD viewing. Users can open the delivered drawing with their existing local CAD application. Do not claim the client previewed a drawing merely because a file card was registered.

For existing drawing edits, read [the editing workflow](references/editing-workflow.md). Discover cad_query_entities, cad_edit and cad_export before using them; older connectors may not provide them. Never substitute arbitrary scripts or shell commands for missing bridge operations.

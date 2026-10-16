# Contributing

Use Node.js 22.19+ and `npm ci`. Run `npm test` and `npm run check -- --static` before proposing a change. The generic CI does not establish AutoCAD compatibility.

On a licensed Windows AutoCAD 2022 machine, run `npm run setup`, `npm run test:cad`, and `npm run test:tangent` when changing CAD code, host startup, persistence or Tangent behavior. Preserve error cases, transaction rollback, idempotency and source-file hashes. Keep machine-specific reports local; share a sanitized acceptance summary and synthetic reproduction.

Do not commit vendor binaries, proprietary blocks, vendor DWGs, actual engineering drawings, API keys, local settings or task caches. Do not copy CAD reference DLLs into the plugin output. Add compatibility targets only with the relevant SDK and real-host evidence.

Keep structured operation contracts narrow. Native module detection, command registration, native operation execution and engineering correctness are separate claims. A change to one boundary should update its producer and consumers, rather than accumulating aliases or fallback guesses.

Describe the problem, resulting behavior, validation and remaining limits in pull requests. New adapters should include a reproducible synthetic fixture, documented units and coordinate system, read coverage, and a separate write acceptance test.

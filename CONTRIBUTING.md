# Contributing

Use Node.js 22.19+ and `npm ci`. Run `npm test` and `npm run check -- --static` before proposing a change. The generic CI does not establish AutoCAD compatibility.

On a licensed Windows AutoCAD 2022 machine, run `npm run setup`, `npm run test:cad`, and `npm run test:tangent` when changing CAD code, host startup, persistence or Tangent behavior. Preserve error cases, transaction rollback, idempotency and source-file hashes. Keep machine-specific reports local; share a sanitized acceptance summary and synthetic reproduction.

Do not commit vendor binaries, proprietary blocks, vendor DWGs, actual engineering drawings, API keys, local settings or task caches. Do not copy CAD reference DLLs into the plugin output. Add compatibility targets only with the relevant SDK and real-host evidence.

Keep structured operation contracts narrow. Native module detection, command registration, native operation execution and engineering correctness are separate claims. A change to one boundary should update its producer and consumers, rather than accumulating aliases or fallback guesses.

Describe the problem, resulting behavior, validation and remaining limits in pull requests. New adapters should include a reproducible synthetic fixture, documented units and coordinate system, read coverage, and a separate write acceptance test.

## 本地数据与测试输入

不要提交图纸、示例需求/依据、预览图或本地测试产物。测试和发行暂存均保存在项目外；CADBRIDGE_TEST_HOME 指定维护者目录，CADBRIDGE_SCHOOL_REQUIREMENTS 指定自备需求文件。缺少该输入的专项会明确跳过；普通CI不依赖私有案例。运行时数据通过CADBRIDGE_DATA_HOME或自动用户目录管理。[详细边界](docs/asset-separation.md)

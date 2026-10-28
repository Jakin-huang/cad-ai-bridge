# CAD AI Bridge

Connect existing CAD software to AI clients through MCP and Skill. Organize requirements, source evidence, bounded design, revisions, checks and editable drawing delivery for human review.

Current support covers drawing operations, ordinary lighting and bounded office-space planning. Independent understanding and completion of complex engineering projects remain unaccepted. Hospital, school and office inputs are validation cases; project names do not select a design workflow.

## Get started

Verified host: Windows 10 x64 and Chinese AutoCAD 2022, with optional Tangent Electrical V8. WorkBuddy is the primary tested client.

1. Download the complete [Windows user preview](https://github.com/Jakin-huang/cad-ai-bridge/releases) and extract it to a writable folder.
2. Open **开始使用.exe**, choose your drawing folder and connect WorkBuddy.
3. Find **cad-ai-bridge** in WorkBuddy, complete first-trust confirmation and select the connector in your task.
4. Describe a task and inspect the returned DWG, PDF, PNG or CSV. Open **任务中心.cmd** for common batch tasks.

The user package includes its runtimes. Other local stdio MCP clients can import the generated configuration and install the Skill using their own mechanism. See the [offline guide](使用说明.html), [installation and recovery](docs/windows-user-release.md), and [troubleshooting](docs/troubleshooting.md).

## Scope

| Capability | Current support |
| --- | --- |
| Drawing operations | Queries, text/attribute/layer changes, 2D transforms, additions, dimensions and quantities |
| Batch delivery | Multi-drawing queues, separate outputs, save/reopen checks, PDF/PNG/CSV and bounded recovery |
| Engineering tasks — source increments | Source-linked requirements and conditions, bounded lighting/space solvers, revisions, checks and review packages |
| Current document — experimental | View/selection context and edits bound to document identity and memory revision |
| Optional Tangent extension | Tested V8 electrical reads, independent straight channel trays and associated labels |

The source line is **v2.1 preview plus later increments**. The frozen Windows user package is **v2.0.0-preview.1** and does not include all source design features. [Tool contracts](docs/tools.md) · [Engineering tasks](docs/engineering-tasks.md)

## Acceptance boundaries

- Supply your own drawings and project inputs. Private drawings, vendor libraries and historical test outputs are not distributed.
- Successful execution, reopened CAD, design checks and professional approval are separate conclusions. Keep missing requirements, unknown conditions, conflicts and pending review items visible.
- Design support is bounded. Arbitrary complex buildings, complete multidisciplinary construction design, full vendor-object coverage and other CAD versions remain outside accepted scope.
- Independent customer projects, cross-model behavior, clean machines, external users and professional review remain unaccepted.

See the [current plan](docs/engineering-design-plan.md) and [latest actual-client/CAD evidence](docs/real-agent-standard-conditions.md).

## Develop

Use Node.js 22.19+ and PowerShell 7+. CAD execution also requires local AutoCAD 2022 and .NET Framework 4.8.

```powershell
npm ci
.\setup.cmd
npm test
npm run check -- --static
```

Real CAD tests require the relevant software environment. Keep private inputs and runtime outputs outside the repository. [Contributing](CONTRIBUTING.md) · [Releasing](docs/releasing.md)

[中文](README.md) · [MIT](LICENSE) · [Third-party notices](THIRD_PARTY_NOTICES.md) · [Changelog](CHANGELOG.md)

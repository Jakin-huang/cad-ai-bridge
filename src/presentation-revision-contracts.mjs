import {z} from 'zod';
import {presentationParameters} from './drawing-presentation.mjs';
import {sourceCoverageSchema} from './document-source-coverage.mjs';
import {titleTaskRef} from './engineering-title-contracts.mjs';
const sha=z.string().regex(/^[a-f0-9]{64}$/);
export const presentationRevisionParameters=z.strictObject({expectedRevision:z.number().int().nonnegative(),expectedInputSHA256:sha,presentation:presentationParameters,sourceCoverage:sourceCoverageSchema.optional()});
export const presentationRevisionRef=z.strictObject({jobId:z.string().regex(/^job-presentation-[a-f0-9-]{36}$/),sha256:sha});
export const presentationRevisionActions=[
 z.strictObject({action:z.literal('inspect_presentation'),task:titleTaskRef}),
 z.strictObject({action:z.literal('draft_presentation_revision'),requestId:z.uuid(),task:titleTaskRef,parameters:presentationRevisionParameters,previousDraft:presentationRevisionRef.optional()}),
 z.strictObject({action:z.literal('read_presentation_revision'),task:titleTaskRef,draft:presentationRevisionRef,section:z.enum(['summary','input','source_coverage','presentation']).default('summary'),offset:z.number().int().nonnegative().default(0),limit:z.number().int().min(1).max(100).default(25)}),
 z.strictObject({action:z.literal('commit_presentation_revision'),requestId:z.uuid(),task:titleTaskRef,draft:presentationRevisionRef,expectedInputSHA256:sha,reviewed:z.literal(true)})
];

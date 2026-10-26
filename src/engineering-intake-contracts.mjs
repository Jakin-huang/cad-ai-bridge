import {presentationRevisionActions} from './presentation-revision-contracts.mjs';
import {presentationParameters} from './drawing-presentation.mjs';
import {z} from 'zod';
import {sourceCoverageSchema} from './document-source-coverage.mjs';
import {documentSetRefSchema} from './project-document-contracts.mjs';
import {reviewScopeSchema,readScopeReviewSchema,scopeSelectionSchema,bindScopeTaskSchema} from './engineering-scope-intake.mjs';
const sha=z.string().regex(/^[a-f0-9]{64}$/),id=z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/);
export const intakeEvidenceSchema=z.array(z.strictObject({documentId:id,quote:z.string().min(5).max(4000)})).min(1).max(20);
export const intakeBaselineRefSchema=z.strictObject({jobId:z.string().regex(/^job-intake-[a-f0-9-]{36}$/),sha256:sha,projectId:z.uuid()});
export const intakeDraftRefSchema=z.strictObject({jobId:z.string().regex(/^job-intakedraft-[a-f0-9-]{36}$/),sha256:sha});
export const reprepareIntakeSchema=z.strictObject({action:z.literal('reprepare'),requestId:z.uuid(),task:z.strictObject({jobId:z.string().regex(/^job-task-[a-f0-9-]{36}$/),expectedProjectId:z.uuid(),expectedTaskSHA256:sha}),expectedInputSHA256:sha,documents:documentSetRefSchema,scope:scopeSelectionSchema,reason:z.string().min(10).max(1000),evidence:intakeEvidenceSchema});
export const intakeCommonParameters={presentation:presentationParameters.optional(),sourceCoverage:sourceCoverageSchema.optional(),frozen:z.strictObject({expectedSHA256:sha,reason:z.string().min(10).max(1000),evidence:intakeEvidenceSchema}),documentDispositions:z.array(z.strictObject({documentId:id,disposition:z.enum(['used','context','unresolved']),reason:z.string().min(10).max(1000)})).min(1).max(100),additionalPending:z.array(z.strictObject({id,description:z.string().min(10).max(1000),severity:z.enum(['review','blocking']),evidence:intakeEvidenceSchema})).max(100).default([])};
const baseline=intakeBaselineRefSchema,draft=intakeDraftRefSchema,page={offset:z.number().int().nonnegative().default(0),limit:z.number().int().min(1).max(100).default(25)};
export const engineeringIntakeSchema=z.discriminatedUnion('action',[
 ...presentationRevisionActions,reviewScopeSchema,readScopeReviewSchema,bindScopeTaskSchema,reprepareIntakeSchema,
 z.strictObject({action:z.literal('capabilities'),kind:z.string().regex(/^[a-z][a-z0-9-]{0,63}$/).optional(),section:z.enum(['summary','parameters','conditions','scope','presentation_revision','repreparation']).default('parameters')}),
 z.strictObject({action:z.literal('inspect_baseline'),kind:z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),baselineFile:z.string().min(1).max(2000)}),
 z.strictObject({action:z.literal('freeze'),requestId:z.uuid(),project:z.strictObject({id:z.uuid(),name:z.string().min(1).max(128),type:z.string().min(1).max(64)}),task:z.strictObject({kind:z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),title:z.string().min(1).max(128),objective:z.string().min(20).max(4000)}),documents:documentSetRefSchema,baselineFile:z.string().min(1).max(2000),expectedRawSHA256:sha,scope:scopeSelectionSchema.optional(),requirePresentation:z.boolean().optional()}),
 z.strictObject({action:z.literal('draft'),requestId:z.uuid(),baseline,parameters:z.record(z.string(),z.unknown()),previousDraft:draft.optional()}),
 z.strictObject({action:z.literal('read'),baseline,draft:draft.optional(),section:z.enum(['summary','conditions','requirements','sources','input','source_coverage','presentation']).default('summary'),...page}),
 z.strictObject({action:z.literal('commit'),requestId:z.uuid(),baseline,draft,expectedInputSHA256:sha,reviewed:z.literal(true)}),
 z.strictObject({action:z.literal('status'),baseline})
]);
export const readonlyEngineeringIntakeSchema=z.discriminatedUnion('action',engineeringIntakeSchema.options.filter(s=>['capabilities','inspect_baseline','read','status','read_scope_review','inspect_presentation','read_presentation_revision'].includes(s.shape.action.value)));

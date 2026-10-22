import {z} from 'zod';
import {sourceCoverageSchema} from './document-source-coverage.mjs';
const sha=z.string().regex(/^[a-f0-9]{64}$/),id=z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/);
export const documentSetRefSchema=z.strictObject({jobId:z.string().regex(/^job-docset-[a-f0-9-]{36}$/),revision:z.number().int().nonnegative(),sha256:sha,projectId:z.uuid()});
const task=z.strictObject({jobId:z.string().regex(/^job-task-[a-f0-9-]{36}$/),expectedProjectId:z.uuid(),expectedTaskSHA256:sha});
const page={offset:z.number().int().nonnegative().default(0),limit:z.number().int().min(1).max(100).default(25)};
const doc=z.strictObject({id,title:z.string().min(1).max(200),versionLabel:z.string().min(1).max(100),role:z.enum(['requirements','coordination','standard_excerpt','architecture_notes','catalog','background','evaluation_only']),file:z.string().min(1).max(2000),expectedRawSHA256:sha});
const citation=z.strictObject({documentId:id,textSHA256:sha,quote:z.string().min(1).max(16000)});
const draftRef=z.strictObject({jobId:z.string().regex(/^job-docdraft-[a-f0-9-]{36}$/),sha256:sha});
const draftScope={task,set:documentSetRefSchema,expectedInputSHA256:sha};
const draftDecision=z.strictObject({targetIds:z.array(z.string().min(1).max(250)).min(1).max(500),disposition:z.enum(['supported','assumption','unresolved','conflict']),reason:z.string().min(10).max(2000),citations:z.array(citation.omit({textSHA256:true})).max(50)});
const disposition=z.strictObject({documentId:id,disposition:z.enum(['used','context','unresolved']),reason:z.string().min(10).max(2000)});
export const projectDocumentsSchema=z.discriminatedUnion('action',[
 z.strictObject({action:z.literal('draft_review'),requestId:z.uuid(),...draftScope,previousDraft:draftRef.optional(),decisions:z.array(draftDecision).max(100).default([]),documentDispositions:z.array(disposition).max(100).default([]),sourceCoverage:z.array(sourceCoverageSchema.element.omit({blockSHA256:true})).max(100).default([])}),
 z.strictObject({action:z.literal('read_review_draft'),task,draft:draftRef,section:z.enum(['summary','decisions','documents','source_coverage','missing']).default('summary'),...page}),
 z.strictObject({action:z.literal('commit_review'),requestId:z.uuid(),...draftScope,draft:draftRef}),
 z.strictObject({action:z.literal('create'),requestId:z.uuid(),projectId:z.uuid(),documents:z.array(doc).min(1).max(100),coveragePolicy:z.enum(['fields_only','fields_and_sources']).optional()}),
 z.strictObject({action:z.literal('update'),requestId:z.uuid(),set:documentSetRefSchema,documents:z.array(doc).min(1).max(100),coveragePolicy:z.enum(['fields_only','fields_and_sources']).optional()}),
 z.strictObject({action:z.literal('read'),set:documentSetRefSchema,documentId:id.optional(),...page}),
 z.strictObject({action:z.literal('source_blocks'),set:documentSetRefSchema,documentId:id.optional(),...page}),
 z.strictObject({action:z.literal('read_review'),task,review:z.strictObject({jobId:z.string().regex(/^job-docreview-[a-f0-9-]{36}$/),sha256:sha}),section:z.enum(['summary','targets','decisions','documents','source_coverage']).default('summary'),...page}),
 z.strictObject({action:z.literal('targets'),task,set:documentSetRefSchema,...page}),
 z.strictObject({action:z.literal('review'),requestId:z.uuid(),task,set:documentSetRefSchema,expectedInputSHA256:sha,decisions:z.array(z.strictObject({targetIds:z.array(z.string().min(1).max(250)).min(1).max(500),expectedValuesSHA256:sha,disposition:z.enum(['supported','assumption','unresolved','conflict']),reason:z.string().min(10).max(2000),citations:z.array(citation).max(50)})).min(1).max(2000),documentDispositions:z.array(z.strictObject({documentId:id,disposition:z.enum(['used','context','unresolved']),reason:z.string().min(10).max(2000)})).min(1).max(100),sourceCoverage:sourceCoverageSchema.optional()}),
 z.strictObject({action:z.literal('bind'),requestId:z.uuid(),task,set:documentSetRefSchema,expectedInputSHA256:sha,review:z.strictObject({jobId:z.string().regex(/^job-docreview-[a-f0-9-]{36}$/),sha256:sha})})
]);
export const readonlyProjectDocumentsSchema=z.discriminatedUnion('action',projectDocumentsSchema.options.filter(s=>['read','read_review','read_review_draft','targets','source_blocks'].includes(s.shape.action.value)));

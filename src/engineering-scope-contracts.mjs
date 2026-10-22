import {z} from 'zod';
const sha=z.string().regex(/^[a-f0-9]{64}$/);
export const scopeRevisionParameters=z.strictObject({expectedRevision:z.number().int().nonnegative(),expectedInputSHA256:sha,expectedScope:z.string().min(20).max(3000),scope:z.string().trim().min(20).max(3000).refine(s=>!/[\u0000-\u001f\u007f]/.test(s),'Scope must be one plain-text paragraph'),reason:z.string().min(10).max(1000),evidence:z.array(z.strictObject({documentId:z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/),textSHA256:sha,quote:z.string().min(5).max(4000)})).min(1).max(20)});

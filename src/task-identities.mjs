import crypto from 'node:crypto';
// Formal task receipts use serialized property order, unlike dependency graphs.
// Preserve that existing identity contract when reading historical bindings.
export const taskIdentitySHA256=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

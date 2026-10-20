import test from 'node:test';
import assert from 'node:assert/strict';
import {backendManifestSchema,builtInBackends,requireBackendCapability,createBackendRegistry} from '../../src/backend-contracts.mjs';
test('backend declarations require units and evidence; platform and operation gates fail closed',()=>{
 const m=builtInBackends[0];assert.equal(backendManifestSchema.safeParse({...m,writeUnits:[]}).success,false);assert.equal(backendManifestSchema.safeParse({...m,evidence:[]}).success,false);assert.throws(()=>requireBackendCapability(m,{operation:'write',units:'m',platform:'win32'}),/WRITE_UNITS/);assert.throws(()=>requireBackendCapability(m,{operation:'read',platform:'linux'}),/PLATFORM/);assert.throws(()=>requireBackendCapability(m,{operation:'session',platform:'win32'}),/CAPABILITY/);
});
test('extension registration does not make unsupported hosts available and successful writes need saved evidence',async()=>{
 const registry=createBackendRegistry();await assert.rejects(registry.execute('not-installed',{operation:'read'}),/UNAVAILABLE/);const m={...builtInBackends[0],id:'test-experimental',platform:process.platform,acceptance:'experimental',evidence:[]};registry.register(m,async()=>({ok:true}));await assert.rejects(registry.execute(m.id,{operation:'write',units:'mm'}),/WRITE_EVIDENCE/);assert.equal((await registry.execute(m.id,{operation:'read'})).capability.declaredAcceptance,'experimental');assert.throws(()=>registry.register(m,()=>({ok:true})),/DUPLICATE/);
});

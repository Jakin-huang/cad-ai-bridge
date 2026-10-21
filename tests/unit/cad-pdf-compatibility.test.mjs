import test from 'node:test';import assert from 'node:assert/strict';import {PDFDocument,PDFName,PDFNumber} from 'pdf-lib';
import {normalizeCadPdf,auditCadPdfNormalization} from '../../src/cad-pdf-compatibility.mjs';import {cadPdfFixture} from '../helpers/cad-pdf.mjs';
test('duplicate catalog fields are serialized once with unchanged source, page, payload and deterministic output',async()=>{
 const input=cadPdfFixture(),original=Buffer.from(input),a=await normalizeCadPdf(input,{paper:'A3'}),b=await normalizeCadPdf(input,{paper:'A3'});assert.deepEqual(input,original);assert.deepEqual(a.bytes,b.bytes);assert.equal(a.bytes.toString().match(/\/PageMode/g).length,1);assert.equal(a.audit.pageCount,1);assert.equal(a.audit.originalSourceRewritten,false);assert.equal(a.audit.independentStrictReaderRequired,true);assert.equal(a.audit.professionalApproval,false);assert.notEqual(a.audit.sourceSHA256,a.audit.outputSHA256);assert.equal((await PDFDocument.load(a.bytes)).catalog.get(PDFName.of('PageMode')).toString(),'/UseOC');
});
test('opaque drawing streams containing PDF-like words are not edited or mistaken for signatures',async()=>{
 const input=cadPdfFixture({text:'Visible /PageMode and /ByteRange stay in the drawing'}),r=await normalizeCadPdf(input,{paper:'A3'});assert.equal((await auditCadPdfNormalization(input,r.bytes,{paper:'A3'})).ok,true);assert.ok(r.bytes.includes(Buffer.from('Visible /PageMode and /ByteRange stay in the drawing')));
});
test('wrong paper, malformed input, budget overflow and a declared signed document are rejected',async()=>{
 await assert.rejects(()=>normalizeCadPdf(cadPdfFixture(),{paper:'A1'}),/PAPER_MISMATCH/);await assert.rejects(()=>normalizeCadPdf(Buffer.from('Unit-only invalid export'),{paper:'A3'}),/HEADER_INVALID/);await assert.rejects(()=>normalizeCadPdf(cadPdfFixture(),{paper:'A3',maxBytes:10}),/INPUT_BUDGET/);await assert.rejects(()=>normalizeCadPdf(cadPdfFixture({signature:true}),{paper:'A3'}),/SIGNATURE_UNSUPPORTED/);
});
test('separately reloaded audit catches a changed page rotation or drawing-resource object',async()=>{
 const source=cadPdfFixture(),normalized=await normalizeCadPdf(source,{paper:'A3'}),changed=await PDFDocument.load(normalized.bytes,{updateMetadata:false});changed.getPages()[0].node.set(PDFName.of('Rotate'),PDFNumber.of(180));const bytes=await changed.save({useObjectStreams:false,updateFieldAppearances:false});await assert.rejects(()=>auditCadPdfNormalization(source,bytes,{paper:'A3'}),/CONTENT_OR_GEOMETRY_CHANGED/);
 const resource=await PDFDocument.load(normalized.bytes,{updateMetadata:false});resource.context.lookup(resource.context.enumerateIndirectObjects().find(([ref])=>ref.objectNumber===4)[0]).set(PDFName.of('BaseFont'),PDFName.of('Courier'));const altered=await resource.save({useObjectStreams:false,updateFieldAppearances:false});await assert.rejects(()=>auditCadPdfNormalization(source,altered,{paper:'A3'}),/CONTENT_OR_GEOMETRY_CHANGED/);
});
test('A1 sheets retain their declared physical size and existing interactive field state is not flattened',async()=>{
 const a=await normalizeCadPdf(cadPdfFixture({paper:'A1'}),{paper:'A1'});assert.ok(Math.abs(a.audit.sizeMm[0]-841)<.001);
 const doc=await PDFDocument.load(cadPdfFixture(),{updateMetadata:false}),field=doc.getForm().createTextField('review-note');field.setText('Pending external review');field.addToPage(doc.getPages()[0],{x:30,y:50,width:200,height:20});const original=await doc.save({useObjectStreams:false}),r=await normalizeCadPdf(original,{paper:'A3'});assert.equal((await PDFDocument.load(r.bytes)).getForm().getTextField('review-note').getText(),'Pending external review');
});

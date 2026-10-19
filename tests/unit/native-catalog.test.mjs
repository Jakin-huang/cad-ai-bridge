import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {resolveNativeModels} from '../../src/native-catalog.mjs';

test('Native dimensions resolve an exact installed model without modifying the vendor catalog',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'cad-native-catalog-'));
 try{
  await fs.mkdir(path.join(root,'sys'));
  const file=path.join(root,'sys','AecCable.db'),db=new DatabaseSync(file);
  db.exec('CREATE TABLE "Pipe_C-01" ("型号" TEXT,"B" REAL,"H" REAL)');
  const insert=db.prepare('INSERT INTO "Pipe_C-01" VALUES (?,?,?)');insert.run('C-01-15-4',400,150);insert.run('C-01-2.5-5',50,25);insert.run('C-01-7.5-15',150,75);db.close();
  const before=await fs.readFile(file),op={type:'create_native_tray',width:400,height:150};
  assert.equal((await resolveNativeModels([op],root)).operations[0].nativeModel,'C-01-15-4');
  assert.equal((await resolveNativeModels([{...op,width:50,height:25}],root)).operations[0].nativeModel,'C-01-2.5-5');
  assert.equal((await resolveNativeModels([{...op,width:150,height:75}],root)).operations[0].nativeModel,'C-01-7.5-15');
  assert.equal(op.nativeModel,undefined);
  await assert.rejects(resolveNativeModels([{...op,width:401}],root),/NATIVE_SIZE_NOT_CATALOGUED/);
  assert.deepEqual(await fs.readFile(file),before);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

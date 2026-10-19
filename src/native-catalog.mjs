import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

// Read the installed manufacturer's catalog. Never execute SQL stored in it or
// redistribute its contents. The first supported native family is槽式桥架.
export async function resolveNativeModels(operations,tangentRoot){
 if(operations.every(op=>op.type==='add_native_tray_label'))return{operations};
 const file=path.join(tangentRoot,'sys','AecCable.db');
 const bytes=await fs.readFile(file).catch(error=>{throw Error('NATIVE_CATALOG_UNAVAILABLE: cannot read the selected Tangent tray catalog ('+error.code+')');});
 if(bytes.length>16*1024*1024||bytes.subarray(0,16).toString()!=='SQLite format 3\0')throw Error('NATIVE_CATALOG_INVALID: installed tray catalog is invalid');
 const {DatabaseSync}=await import('node:sqlite');
 const db=new DatabaseSync(file,{readOnly:true,allowExtension:false});
 try{
  db.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF');
  const query=db.prepare('SELECT "型号" AS model FROM "Pipe_C-01" WHERE "B"=? AND "H"=? LIMIT 2');
  const resolved=operations.map(op=>{
   if(op.type==='add_native_tray_label')return op;
   const rows=query.all(op.width,op.height);
   if(rows.length!==1||typeof rows[0].model!=='string'||!/^C-01-[0-9.-]{1,32}$/.test(rows[0].model))throw Error(`NATIVE_SIZE_NOT_CATALOGUED: ${op.width}×${op.height} mm is not uniquely listed in the installed槽式桥架catalog`);
   return{...op,nativeModel:rows[0].model};
  });
  return{operations:resolved,nativeCatalogSHA256:crypto.createHash('sha256').update(bytes).digest('hex')};
 }finally{db.close();}
}

const sizes={A4:[210,297],A3:[297,420],A2:[420,594],A1:[594,841],A0:[841,1189]};
export function verifyPlotBytes(bytes,format,contract){
 if(format==='png'){if(bytes.length<24||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('PLOT_FORMAT_INVALID');return {ok:true,pixels:[bytes.readUInt32BE(16),bytes.readUInt32BE(20)],scope:'PNG signature and dimensions; text legibility not inferred'};}
 if(bytes.subarray(0,5).toString()!=='%PDF-')throw Error('PLOT_FORMAT_INVALID');
 // AutoCAD emits readable page dictionaries. Resolve inherited page properties:
 // a landscape MediaBox with /Rotate 270 is displayed in portrait orientation.
 const text=bytes.toString('latin1'),objects=new Map([...text.matchAll(/(\d+)\s+(\d+)\s+obj\b([\s\S]*?)endobj/g)].map(m=>[m[1]+' '+m[2],m[3].split(/\bstream\b/)[0]]));
 function inherited(key,body,seen=new Set()){
  const pattern=key==='MediaBox'?/\/MediaBox\s*(\[[^\]]+\])/:new RegExp('/'+key+'\\s+(-?\\d+(?:\\.\\d+)?)\\b'),match=body.match(pattern);if(match)return match[1];
  const parent=body.match(/\/Parent\s+(\d+)\s+(\d+)\s+R/),ref=parent&&parent[1]+' '+parent[2];if(!ref)return undefined;if(seen.has(ref)||seen.size>=32)throw Error('PLOT_PAPER_UNVERIFIED: cyclic PDF page inheritance');seen.add(ref);const next=objects.get(ref);if(!next)throw Error('PLOT_PAPER_UNVERIFIED: unreadable PDF page parent');return inherited(key,next,seen);
 }
 const pages=[...objects.values()].filter(body=>/\/Type\s*\/Page\b/.test(body)),boxes=[],rotations=[],displayed=[];
 for(const body of pages){const box=inherited('MediaBox',body),values=box?.match(/-?\d+(?:\.\d+)?/g)?.map(Number),rotation=Number(inherited('Rotate',body)||0),unit=Number(inherited('UserUnit',body)||1);if(values?.length!==4||!Number.isFinite(rotation)||rotation%90||unit!==1){if(contract)throw Error('PLOT_PAPER_UNVERIFIED: unsupported PDF page geometry');continue;}const size=[(values[2]-values[0])*25.4/72,(values[3]-values[1])*25.4/72],turn=(rotation%360+360)%360;boxes.push(size);rotations.push(turn);displayed.push(turn%180?[size[1],size[0]]:size);}
 if(contract){if(!pages.length||boxes.length!==pages.length)throw Error('PLOT_PAPER_UNVERIFIED: PDF has no readable page dictionaries');let expected=sizes[contract.paper];if(contract.orientation==='landscape')expected=[expected[1],expected[0]];if(displayed.some(b=>b.some((v,i)=>Math.abs(v-expected[i])>1)))throw Error('PLOT_PAPER_MISMATCH: displayed PDF page differs from requested paper/orientation');}
 return {ok:true,mediaBoxesMm:boxes,pageRotationDegrees:rotations,displayedPageSizesMm:displayed,requestedPaperVerified:Boolean(contract),scope:'PDF displayed page size/orientation including inherited rotation; scale is checked against host settings, fonts and content remain visual checks'};
}

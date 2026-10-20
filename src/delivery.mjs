const labels={'dwg':'DWG 图纸','summary-csv':'CSV 汇总','detail-csv':'CSV 明细','pdf':'PDF 图纸','png':'PNG 预览','before-png':'修改前 PNG','after-png':'修改后 PNG'};
const order=Object.keys(labels);
export function deliveryLinks(files=[]){
 return files.filter(file=>labels[file.kind]).map(file=>{
  const target=file.file.replaceAll('\\','/').replaceAll('%','%25').replaceAll('#','%23').replaceAll('(','%28').replaceAll(')','%29').replaceAll('<','%3C').replaceAll('>','%3E');
  const label=labels[file.kind]+' · '+file.file.replaceAll('\\','/').split('/').at(-1);
  return {kind:file.kind,file:file.file,label,markdown:`[${label}](<${target}>)`};
 }).sort((a,b)=>order.indexOf(a.kind)-order.indexOf(b.kind));
}
export const deliveryMarkdown=files=>deliveryLinks(files).map(link=>'- '+link.markdown).join('\n');

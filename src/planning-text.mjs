// Approximate CAD text width in full-width characters. Keep ordinary words and
// hashes together where possible; exact glyph layout is still visually checked.
export function planningTextLines(text,budget){
 const lines=[];let rest=String(text);while(rest){let width=0,end=0,lastSpace=-1;for(const c of rest){const next=width+(c.codePointAt(0)>255?1:.6);if(next>budget&&end)break;width=next;end+=c.length;if(c===' ')lastSpace=end;}
  if(end>=rest.length){lines.push(rest);break;}if(lastSpace>Math.floor(end*.5))end=lastSpace;lines.push(rest.slice(0,end).trimEnd());rest=rest.slice(end).trimStart();}return lines;
}

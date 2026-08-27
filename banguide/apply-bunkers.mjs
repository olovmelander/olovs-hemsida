#!/usr/bin/env node
/* Write generated bk arrays back into HOLES, one hole at a time.

   An earlier version did this with a regex and silently skipped two of the eighteen
   holes. This one carves each hole's record out of the source by its own `{n:..,par:..,
   idx:..,` header, finds that record's bk array by bracket depth, and reports what it
   touched, so a skip is loud.

   Run:  node banguide/apply-bunkers.mjs in.html out.html bunkers.json               */
import fs from 'node:fs';

const [,, inFile, outFile, bkFile] = process.argv;
let src = fs.readFileSync(inFile,'utf8');
const BK = JSON.parse(fs.readFileSync(bkFile,'utf8'));

const s=src.indexOf('const HOLES = ['), e=src.indexOf('\nconst CLUB=');
const body=src.slice(s,e);
const HOLES=eval(body.replace('const HOLES = [','[').replace(/\];[\s\S]*$/,'];'));

const marks=[];
for(const h of HOLES){
  const tag='{n:'+h.n+',par:'+h.par+',idx:'+h.idx+',';
  const i=body.indexOf(tag);
  if(i<0) throw new Error('hole '+h.n+': record not found');
  if(body.indexOf(tag,i+1)>=0) throw new Error('hole '+h.n+': record header is not unique');
  marks.push({n:h.n,i});
}
marks.sort((a,b)=>a.i-b.i);
for(let k=0;k<marks.length;k++) marks[k].end = (k+1<marks.length)? marks[k+1].i : body.length;

let rewritten=0, added=0, out=body;
for(let k=marks.length-1;k>=0;k--){            /* back to front, so offsets stay valid */
  const m=marks[k];
  const rec=body.slice(m.i,m.end);
  const list=BK[m.n]||[];
  const text='bk:['+list.map(b=>'['+b.join(',')+']').join(',')+']';
  const bi=rec.indexOf('bk:[');
  let newRec;
  if(bi>=0){
    let depth=0, j=bi+3, endIdx=-1;
    for(; j<rec.length; j++){
      if(rec[j]==='[') depth++;
      else if(rec[j]===']'){ depth--; if(depth===0){ endIdx=j+1; break; } }
    }
    if(endIdx<0) throw new Error('hole '+m.n+': unterminated bk array');
    newRec = rec.slice(0,bi)+text+rec.slice(endIdx);
    rewritten++;
  } else {
    const close=rec.lastIndexOf('}');
    if(close<0) throw new Error('hole '+m.n+': no closing brace');
    const sep = /[,{]\s*$/.test(rec.slice(0,close)) ? '' : ',';
    newRec = rec.slice(0,close)+sep+text+rec.slice(close);
    added++;
  }
  out = out.slice(0,m.i)+newRec+out.slice(m.end);
}
src = src.slice(0,s)+out+src.slice(e);
fs.writeFileSync(outFile, src);
console.log('bk arrays rewritten:', rewritten, '| inserted where absent:', added,
            '| holes:', marks.length, '| bunkers:', Object.values(BK).reduce((a,b)=>a+b.length,0));

#!/usr/bin/env node
/* Re-anchor holes: write new centre lines into HOLES, one hole at a time.

   The lines come from solve-routing's output, which moves each hole as a RIGID BODY -
   translate plus rotate about the hole's own midpoint. That preserves the drawn length
   exactly, which is one of the two protected invariants, so check.mjs must still report a
   0.13% worst error afterwards. It does not preserve the green's angle to the ground, so
   `grot` is rotated by the same amount to keep the putting surface square to the play.

   Each record is located by its own {n:..,par:..,idx:.., header and its `line` array closed
   by counting brackets. Never a regex.

   Run:  node banguide/apply-lines.mjs in.html out.html solved.json                    */
import fs from 'node:fs';

const [,, inFile, outFile, solvedFile] = process.argv;
let src = fs.readFileSync(inFile,'utf8');
const SOLVED = JSON.parse(fs.readFileSync(solvedFile,'utf8'));

const s=src.indexOf('const HOLES = ['), e=src.indexOf('\nconst CLUB=');
let body=src.slice(s,e);
const HOLES=eval(body.replace('const HOLES = [','[').replace(/\];[\s\S]*$/,'];'));

/* the span of one array field inside a record, closed by bracket depth */
function fieldSpan(rec, field){
  const i=rec.indexOf(field+':[');
  if(i<0) return null;
  let depth=0, j=i+field.length;
  for(; j<rec.length; j++){
    if(rec[j]==='[') depth++;
    else if(rec[j]===']'){ depth--; if(depth===0) return {from:i, to:j+1}; }
  }
  throw new Error('unterminated '+field);
}
function recSpan(n, par, idx){
  const tag='{n:'+n+',par:'+par+',idx:'+idx+',';
  const i=body.indexOf(tag);
  if(i<0) throw new Error('hole '+n+': record not found');
  if(body.indexOf(tag,i+1)>=0) throw new Error('hole '+n+': record header is not unique');
  let depth=0, j=i;
  for(; j<body.length; j++){
    if(body[j]==='{') depth++;
    else if(body[j]==='}'){ depth--; if(depth===0){ j++; break; } }
  }
  return {from:i, to:j};
}

const targets = Object.keys(SOLVED).map(Number).sort((a,b)=>b-a);   /* back to front */
const report=[];
for(const n of targets){
  const h=HOLES.find(x=>x.n===n);
  if(!h) throw new Error('hole '+n+' is not in HOLES');
  const sp=recSpan(n, h.par, h.idx);
  let rec=body.slice(sp.from, sp.to);

  const before=h.line.map(p=>[p[0],p[1]]);
  const after=SOLVED[n].line;
  const lineText='line:['+after.map(p=>'['+p[0]+','+p[1]+']').join(',')+']';
  const ls=fieldSpan(rec,'line');
  if(!ls) throw new Error('hole '+n+': no line array');
  rec = rec.slice(0,ls.from)+lineText+rec.slice(ls.to);

  /* the green turns with the hole */
  const rotDeg = SOLVED[n].t ? SOLVED[n].t[2] : 0;
  let grotNote='';
  if(rotDeg){
    const m=rec.match(/grot:(-?[\d.]+)/);
    if(m){
      const ng = +(((+m[1] + rotDeg) % 360).toFixed(1));
      rec = rec.replace(/grot:-?[\d.]+/, 'grot:'+ng);
      grotNote = ` grot ${m[1]} -> ${ng}`;
    }
  }
  body = body.slice(0,sp.from)+rec+body.slice(sp.to);

  const len=L=>{let t=0;for(let i=0;i<L.length-1;i++)t+=Math.hypot(L[i+1][0]-L[i][0],L[i+1][1]-L[i][1]);return t;};
  report.push(`hole ${n}: length ${len(before).toFixed(1)} -> ${len(after).toFixed(1)} m (card ${h.t[0]})`
    + (SOLVED[n].t ? `, moved [${SOLVED[n].t[0].toFixed(1)}, ${SOLVED[n].t[1].toFixed(1)}] rotated ${rotDeg.toFixed(1)} deg` : '')
    + grotNote);
}
src = src.slice(0,s)+body+src.slice(e);
fs.writeFileSync(outFile, src);
for(const r of report.reverse()) console.log(r);
console.log('holes re-anchored:', targets.length);

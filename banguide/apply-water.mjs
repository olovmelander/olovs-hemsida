#!/usr/bin/env node
/* Write generated PONDS / STREAMS / OBLINES back into the page.

   Not a regex rewrite: each array is located by its declaration and then closed by
   counting brackets, so a half-match is impossible. The first PONDS entry is the fjord
   bay behind the 14th green -- it comes from the land-cover raster, not the guide, and
   is carried through untouched.

   Run:  node banguide/apply-water.mjs in.html out.html water.json ob.json           */
import fs from 'node:fs';

const [,, inFile, outFile, waterFile, obFile] = process.argv;
let src = fs.readFileSync(inFile,'utf8');
const {PONDS,STREAMS} = JSON.parse(fs.readFileSync(waterFile,'utf8'));
const OB = JSON.parse(fs.readFileSync(obFile,'utf8'));

/* the span of `const NAME=[ ... ];`, found by bracket depth rather than by pattern */
function span(name){
  const decl='const '+name+'=[';
  const i=src.indexOf(decl);
  if(i<0) throw new Error('apply-water: no declaration of '+name);
  if(src.indexOf(decl,i+1)>=0) throw new Error('apply-water: '+name+' declared more than once');
  let depth=0, j=i+decl.length-1;
  for(; j<src.length; j++){
    if(src[j]==='[') depth++;
    else if(src[j]===']'){ depth--; if(depth===0) break; }
  }
  if(depth!==0) throw new Error('apply-water: unterminated '+name);
  if(src[j+1]!==';') throw new Error('apply-water: '+name+' does not end in a semicolon');
  return {from:i, to:j+2};
}
function replace(name, text){
  const s=span(name);
  const before=src.length;
  src = src.slice(0,s.from) + text + src.slice(s.to);
  console.log(name.padEnd(8), (s.to-s.from)+' bytes ->', text.length);
}

const num = v => +(+v).toFixed(1);
const side = r => r.s ? `,s:'${r.s}'` : '';
const pond   = p => `{pen:'${p.pen}',c:[${num(p.c[0])},${num(p.c[1])}],r:[${num(p.r[0])},${num(p.r[1])}],rot:${num(p.rot)},h:${p.h},k:'${p.k}'${side(p)}}`;
const stream = s => `{pen:'${s.pen}',p:[${s.p.map(q=>`[${num(q[0])},${num(q[1])}]`).join(',')}],w:${s.w},h:${s.h},k:'${s.k}'${side(s)}}`;
const obl    = o => `{p:[${o.p.map(q=>`[${num(q[0])},${num(q[1])}]`).join(',')}],h:${o.h}}`;

replace('PONDS',
`const PONDS=[{c:[-1003,-310],r:[86,74],rot:0,name:'bay14'},
 ${PONDS.map(pond).join(',\n ')}];`);
replace('STREAMS',
`const STREAMS=[
 ${STREAMS.map(stream).join(',\n ')}];`);
replace('OBLINES',
`const OBLINES=[
 ${OB.map(obl).join(',\n ')}];`);

fs.writeFileSync(outFile, src);
console.log('wrote', outFile, '|', PONDS.length,'ponds,',STREAMS.length,'streams,',OB.length,'ob runs');

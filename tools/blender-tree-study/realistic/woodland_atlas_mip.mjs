// Downsample a straight-alpha sRGB branchlet render for the mobile tree tier.
// Each quadrant is a separate UV island. Preserve its 0.5 cutout area and
// bleed the nearest visible pigments into clear pixels for trilinear sampling.
import { decodePNG } from '../../../geobuild/png.mjs';
import { encodePNG } from './tree-png.mjs';

const toLinear = Float64Array.from({length:256},(_,i) => {
  const n=i/255;
  return n<=.04045 ? n/12.92 : ((n+.055)/1.055)**2.4;
});
// A mobile diffuse texel needs no more than six bits per pigment channel.
// The nearest sRGB value is at most two code points away; coverage is 8-bit.
const toSRGB = n => Math.round(Math.round(63*(n<=.0031308 ? 12.92*n : 1.055*n**(1/2.4)-.055))*255/63);
const quadrant = (x,y,size) => 2*Number(y>=size/2)+Number(x>=size/2);

function preserveCutouts(alpha, pixels, size, target) {
  for (let cell=0; cell<4; cell++) {
    const left=(cell%2)*size/2, top=(cell>>1)*size/2;
    const hist=new Uint32Array(65536), edge=[];
    for (let y=top; y<top+size/2; y++)
      for (let x=left; x<left+size/2; x++) hist[alpha[y*size+x]]++;
    let cutoff=65535, above=0;
    while (cutoff>0 && above+hist[cutoff]<target[cell]) above+=hist[cutoff--];
    for (let y=top; y<top+size/2; y++) for (let x=left; x<left+size/2; x++) {
      const i=y*size+x, a=alpha[i];
      // The two linear intervals keep zero and one fixed and move only the
      // tested contour, avoiding inflated fully opaque leaf interiors.
      const out=cutoff===65535 || !cutoff ? a/257 :
        a<=cutoff ? 127*a/cutoff : 128+127*(a-cutoff)/(65535-cutoff);
      pixels[i*4+3]=Math.round(out);
      if (a===cutoff && cutoff>0 && cutoff<65535) edge.push(i);
    }
    // Break equally covered edge samples in a stable spatial order.
    const rank=i=>(Math.imul(i^(i>>>11),0x45d9f3b)>>>0);
    edge.sort((a,b)=>rank(a)-rank(b));
    for (let n=0; n<Math.min(edge.length,target[cell]-above); n++) pixels[edge[n]*4+3]=128;
  }
}

function bleedClearPixels(px,size) {
  const seen=new Uint8Array(size*size), queue=new Uint32Array(size*size);
  let read=0,filled=0;
  for (let i=0;i<seen.length;i++) if (px[i*4+3]) { seen[i]=1;queue[filled++]=i; }
  while (read<filled) {
    const i=queue[read++], x=i%size, y=Math.floor(i/size);
    for (const j of [i-1,i+1,i-size,i+size]) {
      if (j<0 || j>=seen.length || seen[j]) continue;
      const xx=j%size, yy=Math.floor(j/size);
      if (Math.abs(x-xx)>1 || quadrant(x,y,size)!==quadrant(xx,yy,size)) continue;
      for (let c=0;c<3;c++) px[j*4+c]=px[i*4+c];
      seen[j]=1;queue[filled++]=j;
    }
  }
}

export function mobileBranchletAtlas(bytes,size) {
  const {data,width,height,channels}=decodePNG(bytes);
  if (width!==height || channels!==4 || !Number.isInteger(size) || size<2 || size%2 || size>=width)
    throw Error('Invalid branchlet mip dimensions');
  const px=new Uint8Array(size*size*4), alpha=new Uint16Array(size*size);
  const ratio=width/size, goal=[0,0,0,0];
  for (let y=0;y<height;y++) for (let x=0;x<width;x++)
    if (data[(y*width+x)*4+3]>=128) goal[quadrant(x,y,width)]++;
  for (let y=0;y<size;y++) for (let x=0;x<size;x++) {
    const left=x*ratio, right=(x+1)*ratio, top=y*ratio, bottom=(y+1)*ratio;
    let coverage=0,r=0,g=0,b=0;
    for (let yy=Math.floor(top);yy<Math.ceil(bottom);yy++) {
      const dy=Math.min(bottom,yy+1)-Math.max(top,yy);
      for (let xx=Math.floor(left);xx<Math.ceil(right);xx++) {
        const j=4*(yy*width+xx);
        const w=(Math.min(right,xx+1)-Math.max(left,xx))*dy*data[j+3]/255;
        coverage+=w;
        r+=toLinear[data[j]]*w; g+=toLinear[data[j+1]]*w; b+=toLinear[data[j+2]]*w;
      }
    }
    const i=y*size+x;
    alpha[i]=Math.round(65535*Math.min(1,coverage/(ratio*ratio)));
    if (coverage>0) {
      px[i*4]=toSRGB(r/coverage); px[i*4+1]=toSRGB(g/coverage); px[i*4+2]=toSRGB(b/coverage);
    }
  }
  preserveCutouts(alpha,px,size,goal.map(count=>Math.round(count/(ratio*ratio))));
  bleedClearPixels(px,size);
  return encodePNG(size,size,px);
}

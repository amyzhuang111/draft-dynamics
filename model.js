// Draft Dynamics model — the single source of truth, imported by index.html and test.mjs.
const A=[[0.70,0.08,0.06,0.04],[0.08,0.66,0.03,0.05],[0.06,0.03,0.72,0.03],[0.04,0.05,0.03,0.64]];
const B=[[0.04,0.12,0.10,0.06],[0.22,-0.02,0.03,0.02],[0.01,0.08,0.16,0.05],[0.12,-0.04,0.10,-0.06]];
const X0=[0.32,0.18,0.55,0.80], STEPS=40;
const NAMES=["coherence","evidence","voice","openness"], MOVES=["Research","Cut","Rewrite","Polish"];
const PRESETS={"Add a source":[0.95,0.15,0.20,0.10],"Cut a paragraph":[0.10,0.90,0.25,0.20],"Rewrite intro":[0.25,0.30,0.95,0.15],"Polish pass":[0.15,0.35,0.30,0.95]};
export const DEFAULT_U=[0.45,0.35,0.50,0.30];
const clip=v=>Math.max(0,Math.min(1,v));
const matVec=(M,v)=>M.map(r=>r.reduce((s,x,i)=>s+x*v[i],0));
const fmt=(v,d=2)=>v.toFixed(d);
function solve(M,b){const n=b.length,a=M.map((r,i)=>[...r,b[i]]);for(let c=0;c<n;c++){let p=c;for(let r=c+1;r<n;r++)if(Math.abs(a[r][c])>Math.abs(a[p][c]))p=r;[a[c],a[p]]=[a[p],a[c]];const d=a[c][c];for(let j=c;j<=n;j++)a[c][j]/=d;for(let r=0;r<n;r++){if(r===c)continue;const f=a[r][c];for(let j=c;j<=n;j++)a[r][j]-=f*a[c][j];}}return a.map(r=>r[n]);}
function fixedPoint(u){const Bu=matVec(B,u);const IminusA=A.map((r,i)=>r.map((v,j)=>(i===j?1:0)-v));return solve(IminusA,Bu);}
function trajectory(u){const xs=[[...X0]];for(let t=0;t<STEPS;t++){const nxt=matVec(A,xs[t]).map((v,i)=>clip(v+matVec(B,u)[i]));xs.push(nxt);}return xs;}
function eigenvaluesSym(M){let a=M.map(r=>[...r]);for(let s=0;s<100;s++){let off=0;for(let i=0;i<4;i++)for(let j=i+1;j<4;j++)off+=a[i][j]*a[i][j];if(off<1e-12)break;for(let p=0;p<3;p++)for(let q=p+1;q<4;q++){if(Math.abs(a[p][q])<1e-12)continue;const th=0.5*Math.atan2(2*a[p][q],a[q][q]-a[p][p]),c=Math.cos(th),sn=Math.sin(th);for(let k=0;k<4;k++){const akp=a[k][p],akq=a[k][q];a[k][p]=c*akp-sn*akq;a[k][q]=sn*akp+c*akq;}for(let k=0;k<4;k++){const apk=a[p][k],aqk=a[q][k];a[p][k]=c*apk-sn*aqk;a[q][k]=sn*apk+c*aqk;}}}return a.map((r,i)=>r[i]).sort((x,y)=>y-x);}
function matrixText(M){return M.map(r=>"  [ "+r.map(v=>(v<0?"−":" ")+Math.abs(v).toFixed(2)).join("  ")+" ]").join("\n");}
export function distance(u){const xs=trajectory(u),s=fixedPoint(u);return Math.hypot(...xs[STEPS].map((v,i)=>v-s[i]));}
export const fmtDist=d=>d===0?'0':Number(d.toPrecision(3)).toString();
export function eigString(){const eig=eigenvaluesSym(A),rho=Math.max(...eig.map(Math.abs));return `eigenvalues λ(A) = ${eig.map(v=>fmt(v,3)).join(", ")}  ·  spectral radius ρ(A)=${fmt(rho,3)} ${rho<1?"< 1 → stable (unclipped map contracts)":"≥ 1 → not contracting"}`;}
export {A,B,X0,STEPS,NAMES,MOVES,PRESETS,clip,matVec,fmt,solve,fixedPoint,trajectory,eigenvaluesSym,matrixText};

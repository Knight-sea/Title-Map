export const RANKS = [
  { id:0, name:'帝国' },{ id:1, name:'王国' },{ id:2, name:'公爵' },
  { id:3, name:'侯爵' },{ id:4, name:'伯爵' },{ id:5, name:'子爵' },{ id:6, name:'男爵' },
];

export const TERRAINS = {
  plain:    { name:'平地', color:'#8fbc8f', canOwn:true },
  forest:   { name:'森',  color:'#2d5a27', canOwn:true },
  river:    { name:'川',  color:'#4a8fb5', canOwn:true },
  mountain: { name:'山',  color:'#7a7a7a', canOwn:false },
  sea:      { name:'海',  color:'#1a3a5a', canOwn:false },
};

export const TERRAIN_FLAT_COLOR = '#dcdcdc';

export function drawTerrainSymbol(ctx, terrain, cx, cy, s) {
  if (terrain==='plain') return;
  ctx.save(); ctx.translate(cx,cy);
  const r = s * 0.35;
  if (terrain==='forest') {
    ctx.fillStyle='rgba(255,255,255,0.35)';
    ctx.beginPath(); ctx.moveTo(0,-r); ctx.lineTo(-r*.6,r*.4); ctx.lineTo(r*.6,r*.4); ctx.closePath(); ctx.fill();
    ctx.fillRect(-r*.1,r*.4,r*.2,r*.4);
  } else if (terrain==='river') {
    ctx.strokeStyle='rgba(255,255,255,0.35)'; ctx.lineWidth=Math.max(1,s*.06);
    for (let row=0;row<2;row++) {
      ctx.beginPath();
      for (let i=-3;i<=3;i++) { const x=(i/3)*r, y=Math.sin(i*1.2)*r*.3+row*r*.3; i===-3?ctx.moveTo(x,y):ctx.lineTo(x,y); }
      ctx.stroke();
    }
  } else if (terrain==='mountain') {
    ctx.strokeStyle='rgba(255,255,255,0.35)'; ctx.lineWidth=Math.max(1,s*.07);
    ctx.beginPath(); ctx.moveTo(-r,r*.5); ctx.lineTo(-r*.3,-r*.4); ctx.lineTo(0,r*.1); ctx.lineTo(r*.4,-r*.5); ctx.lineTo(r,r*.5); ctx.stroke();
  } else if (terrain==='sea') {
    ctx.strokeStyle='rgba(255,255,255,0.3)'; ctx.lineWidth=Math.max(1,s*.05);
    for (let row=-1;row<=1;row++) {
      ctx.beginPath();
      for (let i=-3;i<=3;i++) { const x=(i/3)*r, y=row*r*.4+Math.sin(i*1.5)*r*.15; i===-3?ctx.moveTo(x,y):ctx.lineTo(x,y); }
      ctx.stroke();
    }
  }
  ctx.restore();
}

export const HUE_NAMES = ['赤','朱','橙','黄橙','黄','黄緑','萌黄','緑','青緑','水','空','青','紺','藍','紫','青紫','薄紫','桃紫','桃','薔薇','茶','肌','灰','銀','墨'];
const HUE_BASE = [[0,70,50],[15,75,50],[30,80,55],[40,80,55],[50,80,55],[75,60,45],[90,55,45],[120,50,40],[160,50,45],[180,55,50],[200,60,55],[220,65,50],[230,55,35],[235,50,30],[270,50,45],[255,45,50],[280,40,60],[320,45,55],[340,55,55],[350,60,50],[25,40,35],[25,40,65],[0,0,50],[0,0,68],[0,0,20]];
export const SHADE_LEVELS = [-2,-1,0,1,2];
export const COLOR_PALETTE = [];
for (let h=0;h<25;h++) for (let s=0;s<5;s++) {
  const [hue,sat,light]=HUE_BASE[h]; const l=Math.max(10,Math.min(90,light+SHADE_LEVELS[s]*12));
  COLOR_PALETTE.push({ hue:h, shade:s, name:`${HUE_NAMES[h]} ${SHADE_LEVELS[s]>=0?'+':''}${SHADE_LEVELS[s]}`, hex:hslToHex(hue,sat,l) });
}
function hslToHex(h,s,l) { s/=100;l/=100; const a=s*Math.min(l,1-l); const f=n=>{const k=(n+h/30)%12;return Math.round(255*(l-a*Math.max(Math.min(k-3,9-k,1),-1))).toString(16).padStart(2,'0');}; return `#${f(0)}${f(8)}${f(4)}`; }
export function getColorHex(hi,si) { return COLOR_PALETTE[hi*5+si]?.hex||'#888'; }
export const UNASSIGNED_COLOR = '#3a3a3a';
export const GRID_COLOR = 'rgba(255,255,255,0.06)';
export const BRUSH_SIZES = [1,2,3,4,5,6,7,8,9,10,15,20,30,50];

export class Camera{constructor(){this.x=0;this.y=0;this.zoom=1;this.minZoom=0.05;this.maxZoom=5;this.cellSize=24;}
get scale(){return this.zoom*this.cellSize;}
worldToScreen(wx,wy){return{x:(wx-this.x)*this.scale,y:(wy-this.y)*this.scale};}
screenToWorld(sx,sy){return{x:sx/this.scale+this.x,y:sy/this.scale+this.y};}
screenToCell(sx,sy){const w=this.screenToWorld(sx,sy);return{x:Math.floor(w.x),y:Math.floor(w.y)};}
pan(dx,dy){this.x-=dx/this.scale;this.y-=dy/this.scale;}
zoomCenter(delta,vw,vh){const cx=vw/2,cy=vh/2,before=this.screenToWorld(cx,cy);this.zoom*=delta>0?0.9:1.1;this.zoom=Math.max(this.minZoom,Math.min(this.maxZoom,this.zoom));const after=this.screenToWorld(cx,cy);this.x-=(after.x-before.x);this.y-=(after.y-before.y);}
fitMap(mw,mh,cw,ch){const zx=cw/(mw*this.cellSize),zy=ch/(mh*this.cellSize);this.zoom=Math.min(zx,zy)*.95;this.x=-(cw/this.scale-mw)/2;this.y=-(ch/this.scale-mh)/2;}
getVisibleRange(cw,ch,mw,mh){const tl=this.screenToWorld(0,0),br=this.screenToWorld(cw,ch);return{x0:Math.max(0,Math.floor(tl.x)),y0:Math.max(0,Math.floor(tl.y)),x1:Math.min(mw-1,Math.ceil(br.x)),y1:Math.min(mh-1,Math.ceil(br.y))};}}

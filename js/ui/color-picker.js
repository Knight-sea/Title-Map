import { COLOR_PALETTE, HUE_NAMES, SHADE_LEVELS, getColorHex } from '../constants.js';
let _resolve=null,_selHue=-1,_selShade=2;
export function initColorPicker(){
  const hc=document.getElementById('cp-hues');hc.innerHTML='';
  for(let h=0;h<25;h++){
    const b=document.createElement('div');b.className='cp-hue-btn';b.style.background=getColorHex(h,2);b.dataset.hue=h;
    const n=document.createElement('span');n.className='cp-hue-name';n.textContent=HUE_NAMES[h];b.appendChild(n);
    b.addEventListener('click',()=>selHue(h));hc.appendChild(b);
  }
  document.getElementById('color-confirm').addEventListener('click',()=>{if(_resolve&&_selHue>=0)_resolve({hue:_selHue,shade:_selShade});close();});
  document.getElementById('color-cancel').addEventListener('click',close);
}
function selHue(h){_selHue=h;document.querySelectorAll('.cp-hue-btn').forEach((e,i)=>e.classList.toggle('selected',i===h));buildShades(h);updPreview();}
function buildShades(h){const c=document.getElementById('cp-shades');c.innerHTML='';for(let s=0;s<5;s++){
  const b=document.createElement('div');b.className='cp-shade-btn';if(s===_selShade)b.classList.add('selected');
  b.style.background=getColorHex(h,s);b.textContent=SHADE_LEVELS[s]>=0?`+${SHADE_LEVELS[s]}`:`${SHADE_LEVELS[s]}`;
  b.addEventListener('click',()=>{_selShade=s;c.querySelectorAll('.cp-shade-btn').forEach((e,i)=>e.classList.toggle('selected',i===s));updPreview();});c.appendChild(b);
}}
function updPreview(){if(_selHue<0)return;document.getElementById('cp-preview').style.background=getColorHex(_selHue,_selShade);
  const sl=SHADE_LEVELS[_selShade];document.getElementById('cp-name').textContent=`${HUE_NAMES[_selHue]} ${sl>=0?'+':''}${sl}`;}
function close(){document.getElementById('color-picker-modal').hidden=true;_resolve=null;}
export function openColorPicker(cur){document.getElementById('color-picker-modal').hidden=false;_selHue=cur?cur.hue:-1;_selShade=cur?cur.shade:2;
  document.querySelectorAll('.cp-hue-btn').forEach((e,i)=>e.classList.toggle('selected',i===_selHue));
  if(_selHue>=0){buildShades(_selHue);updPreview();}else{document.getElementById('cp-shades').innerHTML='';document.getElementById('cp-preview').style.background='transparent';document.getElementById('cp-name').textContent='-';}
  return new Promise(r=>{_resolve=r;});}

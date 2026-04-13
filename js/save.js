import{exportData,loadFromData,getState}from'./state.js';const PFX='territory-map-slot-';
export function saveToSlot(i){const d=exportData();d.currentSlot=i;d.savedAt=new Date().toISOString();try{localStorage.setItem(PFX+i,JSON.stringify(d));return true;}catch{return false;}}
export function loadFromSlot(i){try{const r=localStorage.getItem(PFX+i);if(!r)return null;const d=JSON.parse(r);d.currentSlot=i;loadFromData(d);return d;}catch{return null;}}
export function deleteSlot(i){localStorage.removeItem(PFX+i);}
export function getSlotInfo(i){try{const r=localStorage.getItem(PFX+i);if(!r)return null;const d=JSON.parse(r);return{name:d.slotName||`スロット${i+1}`,size:`${d.mapWidth}×${d.mapHeight}`,territories:d.territories?.length||0};}catch{return null;}}
export function exportJSON(){const d=exportData(),b=new Blob([JSON.stringify(d,null,2)],{type:'application/json'}),u=URL.createObjectURL(b),a=document.createElement('a');a.href=u;a.download=`territory-map-${d.slotName||'export'}.json`;a.click();URL.revokeObjectURL(u);}
export function importJSON(file){return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>{try{const d=JSON.parse(r.result);if(!d.version||!d.mapWidth)throw new Error('Invalid');loadFromData(d);res(d);}catch(e){rej(e);}};r.onerror=rej;r.readAsText(file);});}

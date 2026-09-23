export function signaturePad(canvas,initial=[]){
 const ctx=canvas.getContext('2d');let strokes=structuredClone(initial),active=null;
 function draw(){const box=canvas.getBoundingClientRect(),ratio=devicePixelRatio||1;canvas.width=box.width*ratio;canvas.height=box.height*ratio;ctx.scale(ratio,ratio);ctx.lineWidth=2.5;ctx.lineCap='round';ctx.strokeStyle='#183648';for(const stroke of strokes){ctx.beginPath();stroke.forEach((p,i)=>ctx[i?'lineTo':'moveTo'](p[0]*box.width,p[1]*box.height));ctx.stroke();}}
 function point(e){const b=canvas.getBoundingClientRect();return [Math.max(0,Math.min(1,(e.clientX-b.left)/b.width)),Math.max(0,Math.min(1,(e.clientY-b.top)/b.height))];}
 canvas.onpointerdown=e=>{if(active!==null||strokes.length>=100)return;e.preventDefault();active=e.pointerId;canvas.setPointerCapture(e.pointerId);strokes.push([point(e)]);draw();};
 canvas.onpointermove=e=>{if(active!==e.pointerId)return;if(strokes.reduce((n,s)=>n+s.length,0)>=4000)return;strokes.at(-1).push(point(e));draw();};
 const end=e=>{if(active!==e.pointerId)return;active=null;if(strokes.at(-1)?.length<2)strokes.pop();draw();};
 canvas.onpointerup=end;canvas.onpointercancel=end;
 const observer=new ResizeObserver(draw);observer.observe(canvas);draw();
 return {get:()=>structuredClone(strokes),clear(){strokes=[];draw();},destroy(){observer.disconnect();},draw};
}

export const VERSION='2026-09-23.1';
export const DECLARATION='Confirmo que solicito esta actividad y que el material y punto de aspiración indicados corresponden a la información que proporcioné al operador.';
export const people=['Victor Toro','Sergio Rivera','David Navarro','Pablo Vidal','Angelo Gomez'].map((name,i)=>({id:`persona-${i+1}`,name}));
export const trucks=['SBYF97','SKTK35','KDRR11','VLZR13','SGYV82'].map((plate,i)=>({id:`camion-${i+1}`,plate}));
export const materials={water:'Agua',acid:'Ácido',acidulated:'Solución acidulada',ox:'OXILIX / sospecha',mixed:'Mezcla',unknown:'No sé / otro'};
export const questions={area:'¿En qué área realizarás la tarea?',material:'¿Qué vas a aspirar?',identified:'¿Está confirmado el contenido?',clean:'¿El equipo está limpio y apto?',epp:'¿Cuentas con el EPP específico para ejecutar la tarea?'};
export const choices={area:['dry','wet'],material:Object.keys(materials),identified:['yes','no'],clean:['yes','no'],epp:['yes','no']};
export function nextQuestion(a){if(!a.area)return 'area';if(a.area==='dry')return !a.epp?'epp':null;return ['material','identified','clean','epp'].find(k=>!a[k])||null;}
export function evaluate(a){
 if(a.material==='ox')return {color:'red',reason:'oxilix',detail:'OXILIX o sospecha de presencia.',action:'No aspirar ni transportar, en ninguna área. Detener e informar al responsable.'};
 if(a.area==='wet'&&(['mixed','unknown'].includes(a.material)||a.identified==='no'))return {color:'red',reason:'contenido_no_confirmado',detail:'Contenido sin confirmar o presencia de mezcla.',action:'Detener e informar. Identificar el contenido antes de realizar una nueva consulta.'};
 if(a.clean==='no')return {color:'red',reason:'limpieza_no_confirmada',detail:'El equipo no está confirmado limpio y apto.',action:'Solicitar limpieza y verificación según procedimiento. No incorporar otra carga.'};
 if(a.epp==='no')return {color:'red',reason:'epp_no_confirmados',detail:'EPP específico incompleto o sin confirmar.',action:'No iniciar. Informar al supervisor y disponer de los EPP indicados, puestos y en buen estado.'};
 if(a.area==='dry'&&a.epp==='yes')return {color:'amber',reason:'pendiente_cmz',detail:'Área seca · solo material no líquido',action:'Falta el respaldo de CMZ. No iniciar aún.'};
 if(a.area==='wet'&&['water','acid','acidulated'].includes(a.material)&&a.identified==='yes'&&a.clean==='yes'&&a.epp==='yes')return {color:'amber',reason:'pendiente_cmz',detail:materials[a.material],action:'Falta el respaldo de CMZ. No iniciar aún.'};
 return null;
}
export function assertText(value,label,min=2,max=180){if(typeof value!=='string'||value.trim().length<min||value.trim().length>max||/[\u0000-\u001f]/.test(value))throw Error(`Revisa ${label}.`);return value.trim();}
export function validateSignature(strokes){
 if(!Array.isArray(strokes)||!strokes.length||strokes.length>100)throw Error('Falta la firma.');
 let n=0,minX=1,maxX=0,minY=1,maxY=0;
 for(const stroke of strokes){if(!Array.isArray(stroke)||stroke.length<2)throw Error('Completa la firma.');for(const p of stroke){if(!Array.isArray(p)||p.length!==2||!p.every(v=>Number.isFinite(v)&&v>=0&&v<=1))throw Error('Firma no válida.');n++;minX=Math.min(minX,p[0]);maxX=Math.max(maxX,p[0]);minY=Math.min(minY,p[1]);maxY=Math.max(maxY,p[1]);}}
 if(n<8||n>4000||maxX-minX<.04||maxY-minY<.01)throw Error('Completa la firma dentro del recuadro.');
 return strokes;
}
export function transition(record,body,now){
 const r=structuredClone(record);
 if(body.kind==='abandon'){
  if(!['in_progress','pending_cmz'].includes(r.status))throw Error('La consulta ya terminó.');
  r.status='abandoned';r.ended_at=now;r.result=null;return r;
 }
 if(body.kind==='answer'){
  if(r.status!=='in_progress'||body.question!==nextQuestion(r.answers)||!choices[body.question]?.includes(body.answer))throw Error('Respuesta no válida para este paso.');
  r.answers[body.question]=body.answer;r.result=evaluate(r.answers);
  if(r.result?.color==='red'){r.status='blocked';r.ended_at=now;}
  if(r.result?.color==='amber')r.status='pending_cmz';
  return r;
 }
 if(body.kind==='sign'){
  if(r.status!=='pending_cmz'||evaluate(r.answers)?.color!=='amber')throw Error('Esta consulta no admite autorización.');
  if(body.accepted!==true||body.declaration!==DECLARATION||body.version!==VERSION)throw Error('Debes aceptar la declaración vigente.');
  r.cmz={name:assertText(body.name,'el nombre de CMZ',5,100),identifier:assertText(body.identifier,'el identificador de CMZ',3,50),material:assertText(body.material,'el material específico'),pickup:assertText(body.pickup,'el punto de aspiración'),declaration:DECLARATION,signature:validateSignature(body.signature),signed_at:now};
  r.status='approved';r.ended_at=now;
  r.result={color:'green',reason:'respaldo_cmz_registrado',detail:r.answers.area==='dry'?'Área seca · material no líquido':`Solo ${materials[r.answers.material]}`,action:r.answers.area==='dry'?'Mantén puestos tus EPP. No aspires líquidos. Ante presencia o sospecha de OXILIX, no aspirar ni transportar.':'Mantén puestos tus EPP. No incorporar otra sustancia. Al terminar, limpiar y dejar aptos tolva y mangueras según el procedimiento del producto. No agregar agua al producto para limpiarlo.'};
  return r;
 }
 throw Error('Acción no válida.');
}

import {initializeApp} from 'firebase/app';
import {getAuth,signInAnonymously,signInWithEmailAndPassword,signOut,inMemoryPersistence,setPersistence} from 'firebase/auth';
import {firebaseConfig} from './firebase-config.js';
export const auth=getAuth(initializeApp(firebaseConfig));
let ready;
export async function operatorSession(){
 ready??=(async()=>{await setPersistence(auth,inMemoryPersistence);await signInAnonymously(auth);})();
 try{await ready;}catch(e){ready=null;throw Error('No se pudo iniciar la sesión. Comprueba tu conexión o informa al responsable.');}
}
export async function adminLogin(email,password){await setPersistence(auth,inMemoryPersistence);return signInWithEmailAndPassword(auth,email,password);}
export const logout=()=>signOut(auth);
export async function api(path,method='GET',body){
 if(!auth.currentUser)throw Error('Inicia sesión para continuar.');
 const token=await auth.currentUser.getIdToken();
 let response;try{response=await fetch('/api'+path,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});}catch{throw Error('Sin confirmación del servidor. No iniciar. Reintenta cuando tengas conexión.');}
 let data;try{data=await response.json();}catch{throw Error('Servidor no disponible. No iniciar.');}
 if(!response.ok)throw Error(data.error||'No se pudo guardar.');return data;
}

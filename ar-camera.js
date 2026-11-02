import * as THREE from 'three';

const engineURL='https://papalulala.github.io/mudu-world-ar/external/xr/xr.js';
let enginePromise;
function loadEngine(){
 if(enginePromise)return enginePromise;
 window.THREE=THREE;
 enginePromise=(async()=>{
  if(!window.XR8)await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error('AR 引擎載入逾時，請檢查網路後重試。')),45000);
   const ready=()=>{if(window.XR8){clearTimeout(timer);resolve();}};
   window.addEventListener('xrloaded',ready,{once:true});
   const script=document.createElement('script');script.src=engineURL;script.async=true;script.dataset.preloadChunks='slam';script.onload=ready;script.onerror=()=>{clearTimeout(timer);reject(Error('AR 引擎載入失敗，請檢查網路。'));};document.head.append(script);
  });
  await window.XR8.loadChunk('slam');await window.XR8.initialize();return window.XR8;
 })().catch(e=>{enginePromise=null;throw e;});
 return enginePromise;
}
function motionPermission(){
 return Promise.all([window.DeviceMotionEvent,window.DeviceOrientationEvent].filter(t=>typeof t?.requestPermission==='function').map(t=>t.requestPermission())).then(results=>{if(results.includes('denied'))throw Error('請允許動作與方向感測，才能將校園固定在空間中。');});
}
export function setupCameraAR({button,note,getCampus,onEnter,onExit}){
 const overlay=document.querySelector('#camera-ar'),canvas=document.querySelector('#camera-ar-canvas'),surface=document.querySelector('#camera-ar-stage'),status=document.querySelector('#camera-ar-status'),place=document.querySelector('#camera-ar-place'),reset=document.querySelector('#camera-ar-reset'),exit=document.querySelector('#camera-ar-exit');
 let XR,active=false,starting=false,token=0,tracking=false,placed=false,lastHit=null,anchor,content,reticle,arMixer,arScene,arLights,lastTime=0;
 const pointers=new Map();let gesture=null;
 const setStatus=t=>{status.textContent=t;};
 function resize(){if(!active&&!starting)return;canvas.width=surface.clientWidth;canvas.height=surface.clientHeight;}
 function clearPointers(){for(const id of pointers.keys())try{surface.releasePointerCapture(id);}catch{}pointers.clear();gesture=null;}
 function rebase(){const p=[...pointers.values()];gesture=content?{p:p.map(x=>({...x})),scale:content.scale.x,yaw:content.rotation.y,d:p.length===2?Math.hypot(p[1].x-p[0].x,p[1].y-p[0].y):0,a:p.length===2?Math.atan2(p[1].y-p[0].y,p[1].x-p[0].x):0}:null;}
 surface.addEventListener('pointerdown',e=>{if(!active||!placed||!tracking||pointers.size>=2||(e.pointerType==='mouse'&&e.button!==0))return;e.preventDefault();pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});surface.setPointerCapture(e.pointerId);rebase();});
 surface.addEventListener('pointermove',e=>{if(!pointers.has(e.pointerId)||!gesture)return;e.preventDefault();pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});const p=[...pointers.values()];if(p.length===1&&gesture.p.length===1)content.rotation.y=gesture.yaw+(p[0].x-gesture.p[0].x)*.008;else if(p.length===2&&gesture.d>8){content.scale.setScalar(THREE.MathUtils.clamp(gesture.scale*Math.hypot(p[1].x-p[0].x,p[1].y-p[0].y)/gesture.d,.10,.85));const a=Math.atan2(p[1].y-p[0].y,p[1].x-p[0].x)-gesture.a;content.rotation.y=gesture.yaw+Math.atan2(Math.sin(a),Math.cos(a));}});
 for(const type of ['pointerup','pointercancel','lostpointercapture'])surface.addEventListener(type,e=>{pointers.delete(e.pointerId);rebase();});
 async function stop(){
  ++token;active=false;starting=false;tracking=false;clearPointers();
  try{if(XR){await XR.stop();XR.clearCameraPipelineModules();}}catch(e){console.warn('AR cleanup',e);}
  if(anchor)arScene?.remove(anchor);if(arLights)arScene?.remove(arLights);if(reticle){arScene?.remove(reticle);reticle.geometry.dispose();reticle.material.dispose();}
  anchor=content=reticle=arMixer=arScene=null;lastHit=null;placed=false;overlay.hidden=true;document.body.classList.remove('camera-ar-open');onExit();button.disabled=false;button.focus();
 }
 function fail(e,current){if(current!==token)return;starting=false;active=false;place.disabled=true;setStatus(e?.message||'無法啟動 AR，請確認相機權限。');}
 place.onclick=()=>{
  if(!active||!tracking||!lastHit)return;
  anchor.position.set(lastHit.position.x,lastHit.position.y,lastHit.position.z);anchor.visible=true;placed=true;reticle.visible=false;place.hidden=true;reset.hidden=false;setStatus('單指旋轉・雙指縮放或轉向・移動手機從不同角度觀看');
 };
 reset.onclick=()=>{if(!active)return;clearPointers();placed=false;anchor.visible=false;content.scale.setScalar(.28);content.rotation.set(0,0,0);lastHit=null;place.hidden=false;place.disabled=true;reset.hidden=true;setStatus('請對準新的桌面或地面，慢慢移動手機。');};
 exit.onclick=stop;
 button.onclick=async()=>{
  if(starting||active)return;
  if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia){note.hidden=false;note.textContent='請用手機 Safari 或 Chrome 開啟此網址，才能使用相機 AR。';return;}
  const permission=motionPermission();permission.catch(()=>{});
  const current=++token;starting=true;button.disabled=true;note.hidden=true;overlay.hidden=false;document.body.classList.add('camera-ar-open');onEnter();resize();place.hidden=false;place.disabled=true;reset.hidden=true;setStatus('正在準備相機與校園模型，請允許相機與動作感測…');
  try{
   const [engine,campus]=await Promise.all([loadEngine(),getCampus(),permission]);if(current!==token)return;XR=engine;
   XR.clearCameraPipelineModules();XR.XrController.configure({disableWorldTracking:false,enableLighting:false,enableWorldPoints:false,scale:'responsive'});
   let resolveStart,rejectStart;const started=new Promise((a,b)=>{resolveStart=a;rejectStart=b;});
   const module={name:'boai-animated-campus',onBeforeRun:resize,onStart:()=>{
    if(current!==token){resolveStart();return;}
    const {scene,camera,renderer}=XR.Threejs.xrScene();arScene=scene;renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.9;renderer.shadowMap.enabled=false;
    arLights=new THREE.Group();arLights.add(new THREE.HemisphereLight(0xffffff,0x718260,.85));const key=new THREE.DirectionalLight(0xfff5e7,1.7);key.position.set(-3,5,4);arLights.add(key);const fill=new THREE.DirectionalLight(0xdceaff,.55);fill.position.set(4,3,-3);arLights.add(fill);scene.add(arLights);
    anchor=new THREE.Group();content=new THREE.Group();content.scale.setScalar(.28);content.add(campus.group.clone(true));anchor.add(content);anchor.visible=false;scene.add(anchor);
    // The clone has the same node names, allowing every original GLB clip to run together.
    arMixer=new THREE.AnimationMixer(content);campus.clips.forEach(clip=>arMixer.clipAction(clip).play());
    reticle=new THREE.Mesh(new THREE.RingGeometry(.06,.075,48),new THREE.MeshBasicMaterial({color:0x55e8a4,side:THREE.DoubleSide,depthTest:false}));reticle.rotation.x=-Math.PI/2;reticle.visible=false;scene.add(reticle);
    camera.position.set(0,2,0);XR.XrController.updateCameraProjectionMatrix({origin:camera.position,facing:camera.quaternion});active=true;starting=false;lastTime=performance.now();placed=false;setStatus('請對準桌面或地面，慢慢移動手機以建立定位。');resolveStart();
   },onUpdate:({processCpuResult})=>{
    if(current!==token||!active)return;const now=performance.now(),dt=(now-lastTime)/1000;lastTime=now;
    const reality=processCpuResult?.reality;if(reality){const next=reality.trackingStatus==='NORMAL';if(tracking&&!next){clearPointers();setStatus('定位暫時中斷，請緩慢移動回光線充足、有紋理的環境。');}if(!tracking&&next)setStatus(placed?'單指旋轉・雙指縮放或轉向':'請對準桌面或地面；綠圈出現後，點「放置校園」。');tracking=next;}
    if(placed){anchor.visible=tracking;if(tracking&&!document.hidden)arMixer.update(dt);return;}
    lastHit=null;if(tracking)try{const hits=XR.XrController.hitTest(.5,.6,['DETECTED_SURFACE','ESTIMATED_SURFACE']);lastHit=hits.find(h=>h.position&&[h.position.x,h.position.y,h.position.z].every(Number.isFinite))||null;}catch{}
    reticle.visible=!!lastHit;place.disabled=!lastHit;if(lastHit)reticle.position.set(lastHit.position.x,lastHit.position.y+.002,lastHit.position.z);
   },onException:e=>{rejectStart(e);fail(e,current);},onCameraStatusChange:({status})=>{if(status==='failed')rejectStart(Error('相機無法開啟，請允許相機權限，並關閉其他使用鏡頭的程式。'));}};
   XR.addCameraPipelineModules([XR.GlTextureRenderer.pipelineModule(),XR.Threejs.pipelineModule(),XR.XrController.pipelineModule(),module]);
   Promise.resolve(XR.run({canvas,allowedDevices:XR.XrConfig.device().ANY})).catch(rejectStart);
   let timer;try{await Promise.race([started,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('相機啟動逾時，請返回後再試。')),60000);})]);}finally{clearTimeout(timer);}
  }catch(e){fail(e,current);}
 };
 window.addEventListener('resize',resize);
 document.addEventListener('visibilitychange',()=>{if(!active)return;clearPointers();if(document.hidden){XR.pause();}else{lastTime=performance.now();XR.resume();tracking=false;setStatus('正在恢復空間定位，請緩慢移動手機。');}});
 window.addEventListener('pagehide',()=>{if(active||starting)stop();});
}

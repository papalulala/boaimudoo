import * as THREE from 'three';

const engineURL='https://papalulala.github.io/mudu-world-ar/external/xr/xr.js';
let enginePromise;
function loadEngine(){
 if(enginePromise)return enginePromise;
 window.THREE=THREE;
 enginePromise=(async()=>{
  if(!window.XR8)await new Promise((resolve,reject)=>{
   const script=document.createElement('script');let settled=false;
   const finish=error=>{if(settled)return;settled=true;clearTimeout(timer);window.removeEventListener('xrloaded',ready);script.onload=script.onerror=null;if(error){script.remove();reject(error);}else resolve();};
   const timer=setTimeout(()=>finish(Error('AR 引擎載入逾時，請檢查網路後重試。')),45000);
   const ready=()=>{if(window.XR8)finish();};window.addEventListener('xrloaded',ready);
   script.src=engineURL;script.async=true;script.dataset.preloadChunks='slam';script.onload=ready;script.onerror=()=>finish(Error('AR 引擎載入失敗，請檢查網路。'));document.head.append(script);
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
 let XR,active=false,starting=false,stopping=false,stopPromise=null,cancelStart=null,firstPoseTimer=null,token=0,tracking=false,placed=false,autoPlacePending=false,lastHit=null,anchor,content,reticle,arMixer,arScene,arCamera,arLights,arRenderer,lastTime=0;
 const pointers=new Map();let gesture=null;
 const setStatus=t=>{status.textContent=t;};
 const cleanup=fn=>{try{fn();}catch(e){console.warn('AR cleanup',e);}};
 function resize(){if(!active&&!starting)return;const w=Math.max(1,Math.round(surface.clientWidth)),h=Math.max(1,Math.round(surface.clientHeight));if(canvas.width!==w)canvas.width=w;if(canvas.height!==h)canvas.height=h;}
 function clearPointers(){for(const id of pointers.keys())try{surface.releasePointerCapture(id);}catch{}pointers.clear();gesture=null;}
 function rebase(){const p=[...pointers.values()];gesture=content?{p:p.map(x=>({...x})),scale:content.scale.x,yaw:content.rotation.y,d:p.length===2?Math.hypot(p[1].x-p[0].x,p[1].y-p[0].y):0,a:p.length===2?Math.atan2(p[1].y-p[0].y,p[1].x-p[0].x):0}:null;}
 surface.addEventListener('pointerdown',e=>{if(!active||!placed||pointers.size>=2||(e.pointerType==='mouse'&&e.button!==0))return;e.preventDefault();pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});try{surface.setPointerCapture(e.pointerId);}catch{}rebase();});
 surface.addEventListener('pointermove',e=>{if(!pointers.has(e.pointerId)||!gesture)return;e.preventDefault();pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});const p=[...pointers.values()];if(p.length===1&&gesture.p.length===1)content.rotation.y=gesture.yaw+(p[0].x-gesture.p[0].x)*.008;else if(p.length===2&&gesture.d>8){content.scale.setScalar(THREE.MathUtils.clamp(gesture.scale*Math.hypot(p[1].x-p[0].x,p[1].y-p[0].y)/gesture.d,.10,.85));const a=Math.atan2(p[1].y-p[0].y,p[1].x-p[0].x)-gesture.a;content.rotation.y=gesture.yaw+Math.atan2(Math.sin(a),Math.cos(a));}});
 for(const type of ['pointerup','pointercancel','lostpointercapture'])surface.addEventListener(type,e=>{if(!pointers.has(e.pointerId))return;pointers.delete(e.pointerId);try{surface.releasePointerCapture(e.pointerId);}catch{}rebase();});
 function stop({focus=true}={}){
  if(stopPromise)return stopPromise;
  if(!active&&!starting&&overlay.hidden&&!arScene)return Promise.resolve();
  ++token;active=false;starting=false;stopping=true;tracking=false;clearTimeout(firstPoseTimer);firstPoseTimer=null;cancelStart?.();cancelStart=null;clearPointers();
  button.disabled=true;exit.disabled=true;place.disabled=true;reset.disabled=true;setStatus('正在關閉相機…');
  // Defer cleanup until stopPromise is assigned, even if engine.stop throws
  // synchronously. Otherwise a resolved stale promise can block later exits.
  stopPromise=Promise.resolve().then(async()=>{
   try{await XR?.stop();}catch(e){console.warn('AR camera stop',e);}
   finally{
    cleanup(()=>XR?.clearCameraPipelineModules());
    if(arMixer){cleanup(()=>arMixer.stopAllAction());cleanup(()=>arMixer.uncacheRoot(content));}
    if(anchor)cleanup(()=>arScene?.remove(anchor));if(arLights)cleanup(()=>arScene?.remove(arLights));
    if(reticle){cleanup(()=>arScene?.remove(reticle));cleanup(()=>reticle.geometry.dispose());cleanup(()=>reticle.material.dispose());}
    // XR8 owns its renderer and may reuse it on the next run. Clear our render
    // references, but leave renderer destruction to the engine's lifecycle.
    cleanup(()=>arRenderer?.renderLists?.dispose?.());
    // Do not dispose campus geometry or materials: the home scene shares them.
    anchor=content=reticle=arMixer=arScene=arCamera=arLights=arRenderer=null;lastHit=null;placed=false;autoPlacePending=false;
    overlay.hidden=true;document.body.classList.remove('camera-ar-open');button.disabled=false;exit.disabled=false;reset.disabled=false;stopping=false;stopPromise=null;
    cleanup(onExit);if(focus&&!document.hidden)button.focus();
   }
  });return stopPromise;
 }
 async function fail(e,current){
  if(current!==token||stopping)return;
  let message=e?.message||'AR 暫時無法啟動，請確認網路與相機權限後再試。';
  if(e?.name==='NotAllowedError'||e?.name==='SecurityError')message='相機權限未允許。請在 Safari 的網站設定允許相機後再試。';
  if(e?.name==='NotReadableError')message='相機目前無法使用，請先關閉其他使用鏡頭的程式後再試。';
  await stop({focus:false});note.textContent=message;note.hidden=false;
 }
 place.onclick=()=>{
  if(!active||!arCamera)return;
  clearTimeout(firstPoseTimer);firstPoseTimer=null;autoPlacePending=false;
  if(lastHit&&tracking)anchor.position.set(lastHit.position.x,lastHit.position.y,lastHit.position.z);
  else{
   arCamera.updateMatrixWorld();const direction=arCamera.getWorldDirection(new THREE.Vector3());
   anchor.position.copy(arCamera.getWorldPosition(new THREE.Vector3())).addScaledVector(direction,2);
   anchor.position.y-=.12;
  }
  anchor.visible=true;placed=true;reticle.visible=false;place.hidden=true;reset.hidden=false;
  setStatus(lastHit&&tracking?'單指旋轉・雙指縮放或轉向・移動手機從不同角度觀看':'已先顯示在鏡頭前方。可單指旋轉、雙指縮放；找到桌面後再按「重新定位」。');
 };
 reset.onclick=()=>{if(!active)return;clearTimeout(firstPoseTimer);firstPoseTimer=null;clearPointers();autoPlacePending=false;placed=false;anchor.visible=false;content.scale.setScalar(.28);content.rotation.set(0,0,0);lastHit=null;place.hidden=false;place.disabled=false;place.textContent='先顯示校園';reset.hidden=true;setStatus('請慢慢掃描桌面或地面，或點「先顯示校園」放在鏡頭前方。');};
 exit.onclick=()=>stop();
 button.onclick=async()=>{
  if(starting||active||stopping||document.hidden)return;
  if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia){note.hidden=false;note.textContent='請用手機 Safari 或 Chrome 開啟此網址，才能使用相機 AR。';return;}
  let permission;try{permission=motionPermission();}catch(e){permission=Promise.reject(e);}permission.catch(()=>{});
  const current=++token;const cancelled=new Promise(resolve=>{cancelStart=()=>resolve(null);});
  starting=true;button.disabled=true;exit.disabled=false;note.hidden=true;note.textContent='';overlay.hidden=false;document.body.classList.add('camera-ar-open');place.hidden=false;place.disabled=true;reset.hidden=true;setStatus('正在準備相機與校園模型，請允許相機與動作感測…');
  try{
   onEnter();resize();
   const loaded=await Promise.race([Promise.all([loadEngine(),getCampus(),permission]),cancelled]);if(!loaded||current!==token)return;const [engine,campus]=loaded;XR=engine;
   XR.clearCameraPipelineModules();XR.XrController.configure({disableWorldTracking:false,enableLighting:false,enableWorldPoints:false,scale:'responsive'});
   let resolveStart,rejectStart;const started=new Promise((a,b)=>{resolveStart=a;rejectStart=b;});
   const module={name:'boai-animated-campus',onBeforeRun:()=>{if(current===token)resize();},onStart:()=>{
    if(current!==token){resolveStart();return;}
    const {scene,camera,renderer}=XR.Threejs.xrScene();arScene=scene;arCamera=camera;arRenderer=renderer;renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.9;renderer.shadowMap.enabled=false;
    arLights=new THREE.Group();arLights.add(new THREE.HemisphereLight(0xffffff,0x718260,.85));const key=new THREE.DirectionalLight(0xfff5e7,1.7);key.position.set(-3,5,4);arLights.add(key);const fill=new THREE.DirectionalLight(0xdceaff,.55);fill.position.set(4,3,-3);arLights.add(fill);scene.add(arLights);
    anchor=new THREE.Group();content=new THREE.Group();content.scale.setScalar(.28);content.add(campus.group.clone(true));anchor.add(content);anchor.visible=false;scene.add(anchor);
    // The clone has the same node names, allowing every original GLB clip to run together.
    arMixer=new THREE.AnimationMixer(content);campus.clips.forEach(clip=>arMixer.clipAction(clip).play());arMixer.update(0);
    reticle=new THREE.Mesh(new THREE.RingGeometry(.06,.075,48),new THREE.MeshBasicMaterial({color:0x55e8a4,side:THREE.DoubleSide,depthTest:false}));reticle.rotation.x=-Math.PI/2;reticle.visible=false;scene.add(reticle);
    camera.position.set(0,2,0);XR.XrController.updateCameraProjectionMatrix({origin:camera.position,facing:camera.quaternion});active=true;starting=false;lastTime=performance.now();placed=false;autoPlacePending=true;place.hidden=true;place.disabled=false;setStatus('正在將校園顯示在鏡頭前方…');firstPoseTimer=setTimeout(()=>{if(current===token&&active&&autoPlacePending)place.onclick();},5000);resolveStart();
   },onUpdate:({processCpuResult})=>{
    if(current!==token||!active)return;const now=performance.now(),dt=(now-lastTime)/1000;lastTime=now;
    const reality=processCpuResult?.reality;if(reality){const next=reality.trackingStatus==='NORMAL';if(tracking&&!next){clearPointers();setStatus('定位暫時不穩，請緩慢移動手機，或按「重新定位」。');}if(!tracking&&next)setStatus(placed?'單指旋轉・雙指縮放或轉向':'掃描桌面等待綠圈，或點「先顯示校園」放在鏡頭前方。');tracking=next;}
    if(autoPlacePending&&reality){autoPlacePending=false;place.onclick();}
    if(placed){anchor.visible=true;if(!document.hidden)arMixer.update(dt);return;}
    lastHit=null;if(tracking)for(const y of [.6,.75,.9]){try{const hits=XR.XrController.hitTest(.5,y,['DETECTED_SURFACE','ESTIMATED_SURFACE']);lastHit=hits.find(h=>h.position&&[h.position.x,h.position.y,h.position.z].every(Number.isFinite))||null;}catch{}if(lastHit)break;}
    reticle.visible=!!lastHit;place.disabled=false;place.textContent=lastHit?'放置校園':'先顯示校園';if(lastHit)reticle.position.set(lastHit.position.x,lastHit.position.y+.002,lastHit.position.z);
   },onException:e=>{if(current!==token)return;rejectStart(e);void fail(e,current);},onCameraStatusChange:({status})=>{if(current!==token||status!=='failed')return;const error=Error('相機無法開啟，請允許相機權限，並關閉其他使用鏡頭的程式後再試。');rejectStart(error);if(active)void fail(error,current);}};
   XR.addCameraPipelineModules([XR.GlTextureRenderer.pipelineModule(),XR.Threejs.pipelineModule(),XR.XrController.pipelineModule(),module]);
   Promise.resolve(engine.run({canvas,allowedDevices:engine.XrConfig.device().ANY})).then(async()=>{
    if(current!==token&&!active&&!starting&&!stopping){try{await engine.stop();}catch{}}
   },e=>{if(current===token){rejectStart(e);if(active)void fail(e,current);}});
   let timer;try{await Promise.race([started,cancelled,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('相機啟動逾時，請再試一次。')),60000);})]);}finally{clearTimeout(timer);if(current===token)cancelStart=null;}
  }catch(e){await fail(e,current);}
 };
 window.addEventListener('resize',resize);
 window.addEventListener('blur',clearPointers);
 canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();if(active||starting)void fail(Error('3D 顯示暫時中斷，相機已停止；請再開啟 AR。'),token);});
 document.addEventListener('visibilitychange',()=>{if(document.hidden&&(active||starting))stop({focus:false});});
 window.addEventListener('pagehide',()=>{if(active||starting)stop({focus:false});});
}


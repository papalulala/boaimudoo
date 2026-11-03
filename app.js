import {setupCameraAR} from './ar-camera.js?v=31';
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';

import {DRACOLoader} from 'three/addons/loaders/DRACOLoader.js';
const canvas=document.querySelector('#scene'),panel=document.querySelector('.viewer'),loading=document.querySelector('#loading');
let resolveCampus,rejectCampus;const campusReady=new Promise((resolve,reject)=>{resolveCampus=resolve;rejectCampus=reject;});campusReady.catch(()=>{});
const clock=new THREE.Clock();let mixer=null;const scene=new THREE.Scene();
const camera=new THREE.PerspectiveCamera(38,1,.01,200);
let renderer;
try{renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true});}catch(e){loading.textContent='這個裝置無法開啟 3D，請改用支援 WebGL 的瀏覽器。';throw e;}
renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.9;

const ambient = new THREE.HemisphereLight(0xffffff, 0x718260, .85); scene.add(ambient);
const fill=new THREE.DirectionalLight(0xdceaff,.55);fill.position.set(4,3,-3);scene.add(fill);
renderer.shadowMap.autoUpdate=false;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
const key=new THREE.DirectionalLight(0xfff5e7,1.7);key.position.set(-3,5,4);key.target.position.set(0,.2,0);key.castShadow=true;key.shadow.mapSize.set(2048,2048);Object.assign(key.shadow.camera,{left:-2.5,right:2.5,top:2,bottom:-2,near:.1,far:15});key.shadow.bias=-.00015;key.shadow.normalBias=.003;key.shadow.radius=2;scene.add(key,key.target);

const controls=new OrbitControls(camera,canvas);controls.enableDamping=true;controls.minDistance=1;controls.maxDistance=12;controls.maxPolarAngle=Math.PI*.48;controls.autoRotateSpeed=.7;
function reset(){camera.position.set(0,.35,3.8);controls.target.set(0,.22,0);controls.update();}reset();
const draco=new DRACOLoader();draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
new GLTFLoader().setDRACOLoader(draco).load('campus.glb?v=28',g=>{const model=g.scene;if(g.animations.length){mixer=new THREE.AnimationMixer(model);g.animations.forEach(clip=>mixer.clipAction(clip).play());}model.traverse(o=>{if(o.isMesh){o.castShadow=!/^(Cluster\d_Star|Train|Rail|Bird)/.test(o.name);o.receiveShadow=true;const mats=Array.isArray(o.material)?o.material:[o.material];for(const m of mats){m.roughness=Math.max(m.roughness??.8,.75);}}});const box=new THREE.Box3();model.updateMatrixWorld(true);model.traverse(o=>{if(o.isMesh&&!/^(Train|Rail|Bird)/.test(o.name))box.expandByObject(o);});const center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3());const scale=3.6/Math.max(size.x,size.y,size.z);model.position.sub(center);const group=new THREE.Group();group.add(model);group.scale.setScalar(scale);group.position.y=size.y*scale/2;scene.add(group);renderer.shadowMap.needsUpdate=true;loading.hidden=true;resolveCampus({group,clips:g.animations});document.querySelector('#ar').disabled=false;},e=>{if(e.total)loading.textContent=`正在載入校園 ${Math.min(100,Math.round(e.loaded/e.total*100))}%`;},()=>{loading.textContent='模型載入失敗，請重新整理頁面。';rejectCampus(Error('校園模型載入失敗，請重新整理。'));});
new ResizeObserver(()=>{const w=panel.clientWidth,h=panel.clientHeight;renderer.setSize(w,h,false);camera.aspect=w/h;camera.setViewOffset(w,h,0,h*.09,w,h);camera.updateProjectionMatrix();}).observe(panel);
const phases = [
  [0, 0xffffff, 0xffffff, 0xfff5e7, 1.7, 0xffffff, .85, .55, 1],
  [22, 0xffffff, 0xffffff, 0xfff5e7, 1.7, 0xffffff, .85, .55, 1],
  [36, 0x8270b5, 0xffcf9b, 0xff9d54, 1.5, 0xffc69f, .76, .48, .78],
  [49, 0x263357, 0xad8fbd, 0xa58bff, .66, 0x97aaff, .62, .43, .45],
  [58, 0x202c49, 0x66789e, 0x829dff, .48, 0x91a8ff, .57, .42, .32],
  [72, 0x202c49, 0x66789e, 0x829dff, .48, 0x91a8ff, .57, .42, .32],
  [84, 0xb8c3e4, 0xffdfbd, 0xffc18e, 1.25, 0xffdec7, .78, .50, .75],
  [96, 0xffffff, 0xffffff, 0xfff5e7, 1.7, 0xffffff, .85, .55, 1],
].map(([time, top, bottom, sun, sunPower, sky, skyPower, fillPower, shadow]) => ({
  time, top: new THREE.Color(top), bottom: new THREE.Color(bottom),
  sun: new THREE.Color(sun), sky: new THREE.Color(sky), sunPower, skyPower, fillPower, shadow,
}));
const topColor = new THREE.Color(), bottomColor = new THREE.Color();
let dayTime = 0, lastLightingTime = -1;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
function updateDaylight(delta) {
  if (reducedMotion.matches) dayTime = 0;
  else dayTime = (dayTime + Math.min(delta, .1)) % 96;
  if (Math.abs(dayTime - lastLightingTime) < 1 / 24) return;
  lastLightingTime = dayTime;
  const next = phases.findIndex(phase => phase.time > dayTime);
  const from = phases[next - 1], to = phases[next];
  const fraction = (dayTime - from.time) / (to.time - from.time);
  const blend = fraction * fraction * (3 - 2 * fraction);
  key.color.copy(from.sun).lerp(to.sun, blend);
  ambient.color.copy(from.sky).lerp(to.sky, blend);
  key.intensity = THREE.MathUtils.lerp(from.sunPower, to.sunPower, blend);
  ambient.intensity = THREE.MathUtils.lerp(from.skyPower, to.skyPower, blend);
  fill.intensity = THREE.MathUtils.lerp(from.fillPower, to.fillPower, blend);
  key.shadow.intensity = THREE.MathUtils.lerp(from.shadow, to.shadow, blend);
  const whitening = THREE.MathUtils.smoothstep(dayTime, 22, 52) * (1 - THREE.MathUtils.smoothstep(dayTime, 72, 96));
  panel.style.setProperty("--lettering-white", whitening.toFixed(3));
  topColor.copy(from.top).lerp(to.top, blend);
  bottomColor.copy(from.bottom).lerp(to.bottom, blend);
  panel.style.backgroundImage = 'linear-gradient(180deg,' + topColor.getStyle() + ',' + bottomColor.getStyle() + ')';
}
function renderFrame() {
  const delta = clock.getDelta();
  controls.update();
  if (mixer) {
    mixer.update(delta);
    updateDaylight(delta);
  }
  renderer.render(scene, camera);
}
renderer.setAnimationLoop(renderFrame);


const ar=document.querySelector('#ar'),note=document.querySelector('#ar-note');
setupCameraAR({button:ar,note,getCampus:()=>campusReady,onEnter:()=>renderer.setAnimationLoop(null),onExit:()=>{clock.start();renderer.setAnimationLoop(renderFrame);}});

// Compact lettering only after a real orbit, not a click, pan, or zoom.
const lettering=document.querySelector('.lettering');
let orbitStart=null;
controls.addEventListener('start',()=>{orbitStart={azimuth:controls.getAzimuthalAngle(),polar:controls.getPolarAngle()};});
controls.addEventListener('change',()=>{if(!orbitStart||lettering.classList.contains('is-compact'))return;const angle=Math.abs(controls.getAzimuthalAngle()-orbitStart.azimuth)+Math.abs(controls.getPolarAngle()-orbitStart.polar);if(angle>.006)lettering.classList.add('is-compact');});
controls.addEventListener('end',()=>{orbitStart=null;});
const expoLink=document.querySelector('.expo-link');
new ResizeObserver(entries=>{document.querySelector('.actions').style.setProperty('--ar-button-width',`${entries[0].target.getBoundingClientRect().width}px`);}).observe(ar);
expoLink.addEventListener('pointerdown',e=>{if(e.pointerType!=='mouse')expoLink.classList.add('is-touching');});
const releaseExpo=()=>expoLink.classList.remove('is-touching');
expoLink.addEventListener('pointerup',releaseExpo);expoLink.addEventListener('pointercancel',releaseExpo);expoLink.addEventListener('pointerleave',releaseExpo);












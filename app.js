import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';

import {DRACOLoader} from 'three/addons/loaders/DRACOLoader.js';
const canvas=document.querySelector('#scene'),panel=document.querySelector('.viewer'),loading=document.querySelector('#loading');
const scene=new THREE.Scene();scene.background=new THREE.Color(0xffffff);
const camera=new THREE.PerspectiveCamera(38,1,.01,200);
let renderer;
try{renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true});}catch(e){loading.textContent='這個裝置無法開啟 3D，請改用支援 WebGL 的瀏覽器。';throw e;}
renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.9;

scene.add(new THREE.HemisphereLight(0xffffff,0x718260,.85));
const fill=new THREE.DirectionalLight(0xdceaff,.55);fill.position.set(4,3,-3);scene.add(fill);
renderer.shadowMap.autoUpdate=false;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
const key=new THREE.DirectionalLight(0xfff5e7,1.7);key.position.set(-3,5,4);key.target.position.set(0,.2,0);key.castShadow=true;key.shadow.mapSize.set(2048,2048);Object.assign(key.shadow.camera,{left:-2.5,right:2.5,top:2,bottom:-2,near:.1,far:15});key.shadow.bias=-.00015;key.shadow.normalBias=.003;key.shadow.radius=2;scene.add(key,key.target);

const controls=new OrbitControls(camera,canvas);controls.enableDamping=true;controls.minDistance=1;controls.maxDistance=12;controls.maxPolarAngle=Math.PI*.48;controls.autoRotateSpeed=.7;
function reset(){camera.position.set(0,.35,3.8);controls.target.set(0,.22,0);controls.update();}reset();
const draco=new DRACOLoader();draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
new GLTFLoader().setDRACOLoader(draco).load('campus.glb?v=4',g=>{const model=g.scene;model.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;const mats=Array.isArray(o.material)?o.material:[o.material];for(const m of mats){m.roughness=Math.max(m.roughness??.8,.75);}}});const box=new THREE.Box3().setFromObject(model),center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3());const scale=3.6/Math.max(size.x,size.y,size.z);model.position.sub(center);const group=new THREE.Group();group.add(model);group.scale.setScalar(scale);group.position.y=size.y*scale/2;scene.add(group);renderer.shadowMap.needsUpdate=true;loading.hidden=true;},e=>{if(e.total)loading.textContent=`正在載入校園 ${Math.min(100,Math.round(e.loaded/e.total*100))}%`;},()=>{loading.textContent='模型載入失敗，請重新整理頁面。';});
new ResizeObserver(()=>{const w=panel.clientWidth,h=panel.clientHeight;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();}).observe(panel);
renderer.setAnimationLoop(()=>{controls.update();renderer.render(scene,camera);});


const ar=document.querySelector('#ar'),arModel=document.querySelector('#ar-model'),note=document.querySelector('#ar-note');
await customElements.whenDefined('model-viewer');
arModel.addEventListener('load',()=>{ar.disabled=false;});
arModel.addEventListener('error',()=>{note.textContent='AR 模型載入失敗，請重新整理再試。';});
ar.onclick=async()=>{note.hidden=false;if(!arModel.canActivateAR){note.textContent='請使用支援 AR 的 Android 手機或 iPhone Safari 開啟此網址。';return;}try{await arModel.activateAR();}catch(e){note.textContent='AR 尚未啟動，請確認相機權限後再試。';}};
arModel.addEventListener('ar-status',e=>{if(e.detail.status==='failed')note.textContent='無法啟動 AR，請確認裝置支援與相機權限。';});










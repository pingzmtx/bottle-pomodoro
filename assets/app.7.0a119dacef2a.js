(function(){let blocks=[];let pending=[];let mmOpen={};let pref={};let defClosed={};let _moTimer=null;let _bootWait=0;function foldData(){try{if(appData&&appData.uiPrefs){if(!appData.uiPrefs.foldPrefs||typeof appData.uiPrefs.foldPrefs!=='object')appData.uiPrefs.foldPrefs={};return appData.uiPrefs.foldPrefs;}}catch(e){if(window.__silent)window.__silent(e,'07:foldData');}
return null;}
function loadFoldFromData(){let d=foldData();if(d){pref=d;return true;}
return false;}
function persistFold(){let d=foldData();if(!d)return;appData.uiPrefs.foldPrefs=pref;try{saveDataNow();}catch(e){if(window.__silent)window.__silent(e,'07:persistFold');}}
function waitDataThenSync(){try{if(window.__bootDone&&loadFoldFromData()){sync();return;}}catch(e){if(window.__silent)window.__silent(e,'07:waitDataThenSync');}
if(_bootWait<100){_bootWait++;setTimeout(waitDataThenSync,100);}}
function q(s){try{return document.querySelector(s);}catch(e){return null;}}
function isMinimal(){return!!(document.body&&document.body.classList.contains('minimal-mode'));}
function byKey(k){for(let i=0;i<blocks.length;i++){if(blocks[i].key===k)return blocks[i];}
return null;}
function wantOpen(b){if(isMinimal())return mmOpen[b.key]===true;if(pref[b.key]===undefined&&defClosed[b.key])return false;return pref[b.key]!==false;}
function applyOne(b){let open=wantOpen(b);b.sec.classList.toggle('fb-closed',!open);try{b.title.setAttribute('aria-expanded',open?'true':'false');}catch(e){if(window.__silent)window.__silent(e,'07:applyOne');}
if(b.arrow)b.arrow.style.transform=open?'rotate(0deg)':'rotate(-90deg)';}
function sync(){for(let i=0;i<blocks.length;i++)applyOne(blocks[i]);}
function toggleKey(k){let b=byKey(k);if(!b)return;let cur=wantOpen(b),nv=!cur;if(isMinimal()){mmOpen[k]=nv;}else{pref[k]=nv;persistFold();}
applyOne(b);}
function makeBlock(key,sec,title,label){if(!key||!sec||!title)return null;let old=byKey(key);if(old)return old;if(sec.__uiFoldDone)return null;sec.__uiFoldDone=true;title.classList.add('fb-hd');let arrow=document.createElement('span');arrow.className='fb-arrow';arrow.setAttribute('aria-hidden','true');arrow.textContent='▼';title.appendChild(arrow);title.title=title.title||'点击收起 / 展开';title.onclick=(function(k){return function(e){try{e=e||window.event;if(e.stopPropagation)e.stopPropagation();toggleKey(k);}catch(_e){if(window.__silent)window.__silent(_e,'07:makeBlock');}};})(key);let b={key:key,label:label||title.textContent||key,sec:sec,title:title,arrow:arrow};blocks.push(b);applyOne(b);return b;}
function injectCSS(){try{if(document.getElementById('__uiFoldCss'))return;let st=document.createElement('style');st.id='__uiFoldCss';st.textContent=''+'.fb-hd{display:flex!important;align-items:center;justify-content:space-between;gap:var(--sp-8);cursor:pointer;-webkit-user-select:none;user-select:none;}'+'.fb-hd .fb-arrow{font-size:var(--fs-caption);color:var(--text-light);flex-shrink:0;transition:transform .18s ease;line-height:1;}'+'.fb-closed>*:not(:first-child){display:none!important;}';(document.head||document.documentElement).appendChild(st);}catch(e){if(window.__silent)window.__silent(e,'07:injectCSS');}}
function autoTitle(sec){let t=null;for(let j=0;j<sec.children.length;j++){let c=sec.children[j];if(c&&c.className&&(''+c.className).indexOf('state-section-title')>=0){t=c;break;}}
if(!t&&sec.children.length)t=sec.children[0];return t;}
function findBlocks(){let wrap=q('#view-timer .current-todo-section');if(!wrap)return;let secs=wrap.querySelectorAll('.state-section');for(let i=0;i<secs.length;i++){let sec=secs[i];if(!sec||sec.__uiFoldDone)continue;let title=autoTitle(sec);if(!title)continue;let text=title.textContent||'';let key=null;if(text.indexOf('当前状态')>=0)key='timer_state';else if(text.indexOf('任务难度')>=0)key='timer_diff';if(!key)continue;makeBlock(key,sec,title,text);}}
function resolve(v){if(!v)return null;if(typeof v==='function'){try{return resolve(v());}catch(e){return null;}}
if(typeof v==='string')return q(v);return v.nodeType?v:null;}
function register(cfg){try{if(!cfg||!cfg.key)return false;if(byKey(cfg.key))return true;let sec=resolve(cfg.sec),title=resolve(cfg.title);if(!title&&sec)title=autoTitle(sec);if(!sec||!title){if(!hasPending(cfg.key))pending.push({cfg:cfg,at:Date.now()});flushPending();return false;}
return!!makeBlock(cfg.key,sec,title,cfg.label);}catch(e){return false;}}
function hasPending(k){for(let i=0;i<pending.length;i++){if(pending[i].cfg.key===k)return true;}
return false;}
function flushPending(){if(!pending.length)return;let left=[];for(let i=0;i<pending.length;i++){let it=pending[i];let sec=resolve(it.cfg.sec),title=resolve(it.cfg.title);if(!title&&sec)title=autoTitle(sec);if(sec&&title){if(byKey(it.cfg.key))continue;makeBlock(it.cfg.key,sec,title,it.cfg.label);}else if(Date.now()-it.at<15000)left.push(it);}
pending=left;}
function remove(key){let b=byKey(key);if(!b)return false;try{b.sec.classList.remove('fb-closed');b.sec.__uiFoldDone=false;b.title.classList.remove('fb-hd');if(b.arrow&&b.arrow.parentNode)b.arrow.parentNode.removeChild(b.arrow);try{b.title.onclick=null;}catch(e){if(window.__silent)window.__silent(e,'07:remove');}
b.title.removeAttribute('aria-expanded');}catch(e){if(window.__silent)window.__silent(e,'07:remove');}
let idx=-1;for(let i=0;i<blocks.length;i++){if(blocks[i].key===key){idx=i;break;}}
if(idx>=0)blocks.splice(idx,1);delete pref[key];persistFold();delete mmOpen[key];return true;}
function patchMinimal(){try{if(typeof window.applyMinimalMode!=='function')return;let orig=window.applyMinimalMode;window.applyMinimalMode=function(){try{return orig.apply(this,arguments);}finally{try{mmOpen={};sync();}catch(e){if(window.__silent)window.__silent(e,'07:patchMinimal');}}};}catch(e){if(window.__silent)window.__silent(e,'07:patchMinimal');}}
function patchObserver(){try{if(typeof MutationObserver==='undefined'||!document.body)return;let mo=new MutationObserver(function(){try{if(_moTimer)clearTimeout(_moTimer);_moTimer=setTimeout(function(){try{flushPending();sync();}catch(e){if(window.__silent)window.__silent(e,'07:patchObserver');}},40);}catch(e){if(window.__silent)window.__silent(e,'07:patchObserver');}});mo.observe(document.body,{attributes:true,attributeFilter:['class']});}catch(e){if(window.__silent)window.__silent(e,'07:patchObserver');}}
try{injectCSS();findBlocks();patchMinimal();patchObserver();flushPending();sync();waitDataThenSync();window.__uiFold={toggle:function(k){toggleKey(k);},sync:sync,state:function(){let o={};for(let i=0;i<blocks.length;i++)o[blocks[i].key]=!wantOpen(blocks[i]);return o;},keys:function(){let a=[];for(let i=0;i<blocks.length;i++)a.push(blocks[i].key);return a;},register:register,remove:function(k){return remove(k);},clearPref:function(k){delete pref[k];persistFold();return true;},defaultClosed:function(keys){let arr=[].concat(keys||[]);let n=0;for(let i=0;i<arr.length;i++){let k=arr[i];if(!k||defClosed[k])continue;defClosed[k]=true;let b=byKey(k);if(b)applyOne(b);n++;}
return n;},_defClosed:function(){return defClosed;},_mm:function(o){if(o&&typeof o==='object')mmOpen=o;return mmOpen;},_pref:function(){return pref;},_dataReady:function(){return!!(appData&&appData.uiPrefs&&appData.uiPrefs.foldPrefs);}};}catch(e){if(window.__silent)window.__silent(e,'07:patchObserver');}})();
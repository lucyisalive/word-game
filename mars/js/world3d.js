"use strict";
/* 火星温室场景。分层素材保持单株独立生长，World 接口与原教学流程兼容。
   场景只读取学习状态，不写存档、不生成奖励。全部素材从本地加载。 */
const World = (function(){
  const ROOT = "assets/mars/";
  const STAGES = {empty:0, sown:1, sprout:2, seedling:2, grown:2, ripe:3};
  const NAMES = ["空地", "播种", "小苗", "成熟"];
  let container, grid, field, pet, ready=false, petVisible=false, focus=-1;
  let plots=[], words=[], currentView="normal";
  const loaded=new Set();
  function image(src, className, alt=""){
    const node=document.createElement("img");
    node.src=src;node.className=className;node.alt=alt;node.draggable=false;
    node.addEventListener("load",()=>loaded.add(src));
    return node;
  }
  function init(node){
    if(ready) return true;
    if(!node) return false;
    container=node;container.classList.add("marsWorld");
    const backdrop=image(ROOT+"habitat.png","habitatArt");
    field=document.createElement("div");field.className="farmField";
    grid=document.createElement("div");grid.className="farmGrid";
    field.appendChild(grid);
    pet=image("assets/dodo_happy.png","scenePet","多多来串门了，点击抱一抱");
    pet.hidden=true;
    container.append(backdrop,field,pet);
    ready=true;
    syncPlots([]);
    return true;
  }
  function makePlot(i){
    const node=document.createElement("div");node.className="farmPlot";
    const pad=document.createElement("div");pad.className="plotHalo";
    const base=image(ROOT+"planter.png","planterArt");
    const growth=document.createElement("div");growth.className="plantMount";
    const number=document.createElement("span");number.className="plotNumber";
    number.textContent=String(i+1).padStart(2,"0");
    node.append(pad,base,growth,number);
    node.setAttribute("role","img");grid.appendChild(node);
    return {node,growth,status:null,animation:0};
  }
  function stageArt(status){
    if(status==="sown"){
      const seed=document.createElement("span");seed.className="seedArt";return seed;
    }
    if((STAGES[status]||0)>=2) return image(ROOT+(status==="ripe"?"mature.png":"seedling.png"),"cropArt");
    return null;
  }
  function paint(i,status,animate=false){
    const plot=plots[i];if(!plot) return;
    if(!(status in STAGES)) status="empty";
    const old=plot.status;
    const level=STAGES[status];
    // 每次变更移除上一轮残留；旧动画计时器不能删掉新植株。
    const stamp=++plot.animation;
    const previous=plot.growth.lastElementChild;
    const fresh=stageArt(status);
    plot.growth.innerHTML="";
    if(animate && previous){previous.classList.add("cropLeaving");plot.growth.appendChild(previous);}
    if(fresh) plot.growth.appendChild(fresh);
    plot.node.dataset.stage=status;plot.status=status;
    plot.node.classList.remove("growing");
    if(animate){
      void plot.node.offsetWidth;plot.node.classList.add("growing");
      setTimeout(()=>{if(plot.animation!==stamp)return;plot.node.classList.remove("growing");if(previous && previous.parentNode===plot.growth)previous.remove();},1500);
    }
    const w=words[i];
    plot.node.setAttribute("aria-label",`种植床 ${i+1}${w?.meaning?"，"+w.meaning:""}，${NAMES[level]}`);
    if(old===status && !animate)plot.node.classList.remove("growing");
  }
  function setWords(list){
    words=Array.isArray(list)?list:[];
  }
  function syncPlots(statuses, options={}){
    if(!ready) return;
    const count=Math.max(15,statuses.length), rows=Math.ceil(count/5);
    while(plots.length<count) plots.push(makePlot(plots.length));
    while(plots.length>count)plots.pop().node.remove();
    grid.style.setProperty("--farmRows",rows);
    grid.classList.toggle("extended",rows>3);
    grid.style.height=rows>3?`${rows/3*100}%`:"100%";
    plots.forEach((p,i)=>{
      const status=statuses[i]||"empty";
      p.node.classList.toggle("unassigned",i>=statuses.length);
      if(options.animatedIndex!==i && (p.status!==status || !p.node.getAttribute("aria-label")))paint(i,status);
      const level=STAGES[status]||0;
      p.node.setAttribute("aria-label",`种植床 ${i+1}${words[i]?.meaning?"，"+words[i].meaning:""}，${NAMES[level]}`);
    });
  }
  function grow(i,stage="ripe"){if(ready)paint(i,stage,true);}
  function sprout(i){grow(i,"sprout");}
  function harvest(i){grow(i,"ripe");}
  function focusPlot(i){
    focus=i;
    plots.forEach((p,k)=>{
      p.node.classList.toggle("current",k===i);
      if(k===i)p.node.setAttribute("aria-current","true");else p.node.removeAttribute("aria-current");
    });
    if(currentView==="close" && plots[i])plots[i].node.scrollIntoView({behavior:"smooth",block:"nearest",inline:"nearest"});
  }
  function setView(key){
    if(!ready)return;
    currentView=key==="close"?"close":"normal";
    container.dataset.view=currentView;
    document.querySelectorAll("#viewBtns [data-view]").forEach(b=>{
      const active=b.dataset.view===currentView;b.classList.toggle("active",active);b.setAttribute("aria-pressed",String(active));
    });
    if(currentView==="close" && focus>=0)focusPlot(focus);
  }
  function timeOfDayPreset(){const h=new Date().getHours();return h<7?"dawn":h<16?"noon":h<19?"dusk":"night";}
  function setTime(k){if(container)container.dataset.time=k;}
  function setRain(on){if(container)container.classList.toggle("raining",!!on);}
  function setPetMood(mood){if(pet)pet.src=`assets/dodo_${mood==="grumpy"?"grumpy":mood==="happy"?"happy":"ok"}.png`;}
  function showPet(){if(!pet)return;petVisible=true;pet.hidden=false;}
  function hidePet(){if(!pet)return;petVisible=false;pet.hidden=true;}
  function petScreenPos(){
    if(!petVisible||!pet)return null;
    const r=pet.getBoundingClientRect(),c=container.getBoundingClientRect();
    return {x:r.left-c.left+r.width/2,y:r.top-c.top+8};
  }
  function hitPet(x,y){if(!petVisible||!pet)return false;const r=pet.getBoundingClientRect();return x>=r.left&&x<=r.right&&y>=r.top&&y<=r.bottom;}
  function focusScreenPos(){
    if(!plots[focus])return null;const r=plots[focus].node.getBoundingClientRect(),c=container.getBoundingClientRect();
    return {xPct:Math.round((r.left-c.left+r.width/2)/c.width*100),yPct:Math.round((r.top-c.top+r.height/2)/c.height*100)};
  }
  function syncTrash(n){if(container)container.dataset.trash=n;}
  function syncFacilityArt(){/* 已建设施仍由原经济模块运作，背景不暗示额外收益。 */}
  function resize(){} // CSS 网格随窗口尺寸自动布局。
  function forceRender(){} // DOM 场景不依赖显卡上下文，切回窗口也持续显示。
  return {init,isReady:()=>ready,setWords,syncPlots,grow,sprout,harvest,focusPlot,setView,setTime,setRain,timeOfDayPreset,
    setPetMood,showPet,hidePet,isPetOnScene:()=>petVisible,petScreenPos,hitPet,focusScreenPos,syncTrash,syncFacilityArt,
    resize,forceRender,artLoaded:()=>loaded.size>=3};
})();

const $=s=>document.querySelector(s);
const API="/api";
const MIRAE_LOGO="/mirae-logo.png";
let user=null;
let profile={name:"",email:"",bio:"",birth_date:null,avatar_url:""};
let settings={theme:"light",personality:"balanced",instructions:"",web_search:true,temperature:.7};
let chats=[],current=[],currentId=null,authMode="login",pendingSignup=null,resendTimer=null;
let settingsLoaded=false,profileLoaded=false,historyLoaded=false,settingsSaveTimer=null;
let currentTitle="새 대화";
let attachments=[];

function simpleHash(value){
  let h=2166136261;
  const s=String(value??"");
  for(let i=0;i<s.length;i++){
    h^=s.charCodeAt(i);
    h=Math.imul(h,16777619);
  }
  return (h>>>0).toString(16).padStart(8,"0");
}
function conversationTitle(text){
  let s=String(text||"").replace(/```[\\s\\S]*?```/g," ");
  s=s.replace(/^#\\s*/gm,"");
  s=s.replace(/\\s+/g," ").trim();
  s=s.replace(/(?:해줘|해주세요|해 주세요|알려줘|알려주세요|설명해줘|설명해주세요)[.!?]*$/,"").trim();
  return (s.slice(0,28).trim()+(s.length>28?"…":""))||"새 대화";
}

async function req(path,opt={}){
  const isForm=opt.body instanceof FormData;
  const r=await fetch(API+path,{credentials:"include",...opt,headers:{...(isForm?{}:{"Content-Type":"application/json"}),...(opt.headers||{})}});
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw Error(d.detail||"요청에 실패했습니다.");
  return d;
}
function applyTheme(){
  const t=settings.theme||"light";
  if(t==="dark"||(t==="system"&&matchMedia("(prefers-color-scheme:dark)").matches))document.documentElement.dataset.theme="dark";
  else document.documentElement.removeAttribute("data-theme");
  if($("#theme"))$("#theme").value=t;
}
function fillSettings(){
  if($("#web"))$("#web").value=String(!!settings.web_search);
  if($("#personality"))$("#personality").value=settings.personality||"balanced";
  if($("#instructions"))$("#instructions").value=settings.instructions||"";
  if($("#theme"))$("#theme").value=settings.theme||"light";
  applyTheme();
}
async function renderSharedConversation(code){
  try{
    const d=await req("/shared/"+code);
    document.body.innerHTML='<main class="shared-page"><div class="shared-head"><div><b>Mirae AI</b><span>공유된 대화</span></div><a href="/" class="shared-home">Mirae AI 열기</a></div><article class="shared-card"><h1></h1><div class="shared-messages"></div></article></main>';
    document.querySelector(".shared-card h1").textContent=d.conversation.title||"공유된 대화";
    const box=document.querySelector(".shared-messages");
    d.messages.forEach(m=>{const e=document.createElement("div");e.className="shared-message "+m.role;e.innerHTML="<div class='shared-role'>"+(m.role==="user"?"사용자":"Mirae AI")+"</div><div class='shared-content'></div>";e.querySelector(".shared-content").innerHTML=m.role==="assistant"?renderMarkdown(m.content):escapeHtml(m.content).replace(/\n/g,"<br>");box.appendChild(e)});
    document.title=(d.conversation.title||"공유된 대화")+" · Mirae AI";
  }catch(e){document.body.innerHTML='<main class="shared-page"><div class="shared-card"><h1>공유 대화를 찾을 수 없습니다.</h1><p>링크가 잘못되었거나 더 이상 존재하지 않습니다.</p><a href="/">Mirae AI로 이동</a></div></main>'}
}
async function boot(){
  const conversationSearch=$("#conversationSearch");
if(conversationSearch){
  conversationSearch.value="";
  conversationSearch.defaultValue="";
  conversationSearch.setAttribute("autocomplete","new-password");
  conversationSearch.setAttribute("name","mirae_conversation_query");
  conversationSearch.addEventListener("focus",()=>{conversationSearch.removeAttribute("readonly");},{once:true});
  conversationSearch.oninput=()=>{
    clearTimeout(historySearchTimer);
    historySearchTimer=setTimeout(renderHistory,80);
  };
}
  const shareMatch=location.pathname.match(/^\/share\/([A-Za-z]{8})\/?$/);
  if(shareMatch){await renderSharedConversation(shareMatch[1]);return}
  fillSettings();renderHistory();newChat(false);setupTools();
  try{
    const m=await req("/auth/me");user=m.user;setAccountLabel();
    Promise.all([loadSettings(),loadProfile(),loadHistory()]).then(()=>{fillSettings();setAccountLabel();renderHistory()});
  }catch{}
}
async function loadSettings(){if(settingsLoaded)return;try{settings=await req("/settings");settingsLoaded=true}catch{}}
async function loadProfile(){if(user&& !profileLoaded)try{applyProfile(await req("/profile"));profileLoaded=true}catch{}}
async function loadHistory(){
  if(!user||historyLoaded)return;
  try{
    const convs=await req("/conversations");
    restoreServer([],convs);
    await loadConversationFolders();
    historyLoaded=true;
    renderHistory();
  }catch{}
}
function setAccountLabel(){
  if($("#accountName"))$("#accountName").textContent=user?(profile.name||user.name):"계정";
  if($("#userInfo"))$("#userInfo").textContent=user?(profile.name||user.name)+" · "+user.email:"로그인하지 않음";
  const avatar=profile.avatar_url||"";
  if($("#accountAvatar"))setAvatar($("#accountAvatar"),profile.name||user?.name||"M",avatar);
  if($("#accountPageAvatar"))setAvatar($("#accountPageAvatar"),profile.name||user?.name||"M",avatar);
  syncAdminButton();
}
function syncAdminButton(){
  const b=$("#adminPanelButton");
  if(!b)return;
  const allowed=!!user&&String(user.email||"").toLowerCase()==="admin@koharu.live";
  b.classList.toggle("hidden",!allowed);
}
async function openAdminPanel(){
  if(!user||String(user.email||"").toLowerCase()!=="admin@koharu.live")return;
  $("#adminOverlay").classList.remove("hidden");
  await loadAdminOverview();
}
function closeAdminPanel(){$("#adminOverlay").classList.add("hidden")}
async function loadAdminOverview(){
  try{
    const [o,u,l,s]=await Promise.all([req("/admin/overview"),req("/admin/users"),req("/admin/logs?limit=120"),req("/admin/settings")]);
    $("#adminUsersCount").textContent=String(o.users??0);
    $("#adminSessionsCount").textContent=String(o.active_sessions??0);
    $("#adminAccessCount").textContent=String(o.access_24h??0);
    $("#adminRiskCount").textContent=String((o.risks||[]).reduce((a,x)=>a+Number(x.count||0),0));
    renderAdminUsers(u);renderAdminLogs(l);fillAdminSettings(s);
    await Promise.all([loadAdminSecurity(),loadAdminTraffic()]);
    if(window.lucide)lucide.createIcons();
  }catch(e){$("#adminStatus").textContent=e.message||"관리자 정보를 불러오지 못했습니다."}
}
async function loadAdminSecurity(){
  try{
    const d=await req("/admin/security");
    $("#adminSuspiciousIps").textContent=String(d.suspicious_ips||0);
    $("#adminBurstCount").textContent=String(d.bursts||0);
    $("#adminErrorRate").textContent=String(Number(d.error_rate||0).toFixed(1)+"%");
    $("#adminBlockedCount").textContent=String(d.rate_limited||0);
    $("#adminSecurityState").textContent=d.state==="alert"?"주의":"정상";
    $("#adminSecurityState").classList.toggle("alert",d.state==="alert");
    const box=$("#adminThreats");box.innerHTML="";
    (d.threats||[]).forEach(x=>{
      const row=document.createElement("div");row.className="threat-row";
      row.innerHTML="<div><b>"+escapeHtml(x.ip||"알 수 없음")+"</b><small>"+escapeHtml(x.reason||"비정상 요청 패턴")+"</small></div><strong>"+Number(x.requests||0)+" 요청</strong>";
      box.appendChild(row);
    });
    if(!box.children.length)box.innerHTML="<div class='empty-admin'>현재 탐지된 의심 트래픽이 없습니다.</div>";
  }catch(e){$("#adminStatus").textContent=e.message||"보안 정보를 불러오지 못했습니다."}
}
async function loadAdminTraffic(){
  try{
    const d=await req("/admin/traffic");
    const box=$("#adminTraffic");box.innerHTML="";
    [["요청 수",d.requests],["평균 응답",String(d.avg_latency||0)+" ms"],["성공률",String(Number(d.success_rate||0).toFixed(1))+"%"],["서버 오류",d.server_errors]].forEach(([a,b])=>{
      const x=document.createElement("div");x.className="traffic-card";x.innerHTML="<small>"+a+"</small><b>"+escapeHtml(String(b??0))+"</b>";box.appendChild(x);
    });
    const ep=$("#adminEndpoints");ep.innerHTML="";
    (d.endpoints||[]).forEach(x=>{const row=document.createElement("div");row.className="endpoint-row";row.innerHTML="<span>"+escapeHtml(x.path||"")+"</span><b>"+Number(x.count||0)+"</b>";ep.appendChild(row)});
    if(!ep.children.length)ep.innerHTML="<div class='empty-admin'>아직 요청 데이터가 없습니다.</div>";
  }catch(e){$("#adminStatus").textContent=e.message||"트래픽 정보를 불러오지 못했습니다."}
}
function renderAdminUsers(list){
  const box=$("#adminUsers");box.innerHTML="";
  (list||[]).forEach(x=>{
    const row=document.createElement("div");row.className="admin-table-row";
    row.innerHTML="<b>"+escapeHtml(x.name||"이름 없음")+"</b><span>"+escapeHtml(x.email||"")+"</span><span>"+new Date(x.created_at).toLocaleString("ko-KR")+"</span><span>"+(x.email_verified?"인증됨":"미인증")+"</span>";
    box.appendChild(row);
  });
  if(!box.children.length)box.innerHTML="<div class='muted'>사용자가 없습니다.</div>";
}
function renderAdminLogs(list){
  const box=$("#adminLogs");box.innerHTML="";
  (list||[]).forEach(x=>{
    const row=document.createElement("div");row.className="admin-log-row";
    row.innerHTML="<b>"+escapeHtml(x.risk_category||"normal")+"</b><span>"+escapeHtml(x.email||"비로그인")+"</span><span>"+escapeHtml(x.ip||"")+"</span><span>"+escapeHtml([x.country,x.region,x.city].filter(Boolean).join(" "))+"</span><span>"+escapeHtml(x.method||"")+" "+escapeHtml(x.path||"")+"</span><span>"+x.status+"</span><small>"+new Date(x.created_at).toLocaleString("ko-KR")+"</small>";
    box.appendChild(row);
  });
  if(!box.children.length)box.innerHTML="<div class='muted'>접속 로그가 없습니다.</div>";
}
function fillAdminSettings(s){
  $("#adminWebSearchMode").value=s.web_search_mode||"broad";
  $("#adminImageGeneration").checked=s.image_generation!==false;
  $("#adminMaintenance").checked=!!s.maintenance;
  $("#adminRetention").value=String(s.log_retention_days||90);
  $("#adminSecuritySensitivity").value=s.security_sensitivity||"normal";
  $("#adminAuditEnabled").checked=s.admin_audit_enabled!==false;
}
async function saveAdminSettings(){
  try{
    const d=await req("/admin/settings",{method:"PUT",body:JSON.stringify({
      web_search_mode:$("#adminWebSearchMode").value,
      image_generation:$("#adminImageGeneration").checked,
      maintenance:$("#adminMaintenance").checked,
      log_retention_days:Number($("#adminRetention").value||90),
      security_sensitivity:$("#adminSecuritySensitivity").value,
      admin_audit_enabled:$("#adminAuditEnabled").checked
    })});
    fillAdminSettings(d);$("#adminStatus").textContent="관리자 설정이 저장되었습니다.";
  }catch(e){$("#adminStatus").textContent=e.message||"설정을 저장하지 못했습니다."}
}
async function cleanupAdminLogs(){
  try{const d=await req("/admin/cleanup-logs",{method:"POST"});$("#adminStatus").textContent="오래된 로그 "+String(d.deleted||0)+"개를 정리했습니다.";await loadAdminOverview()}catch(e){$("#adminStatus").textContent=e.message||"로그 정리에 실패했습니다."}
}
function setAvatar(el,name,url){
  el.textContent="";
  if(url){const img=document.createElement("img");img.src=url;img.alt="";img.referrerPolicy="no-referrer";img.onerror=()=>el.textContent=(name||"M").slice(0,1).toUpperCase();el.appendChild(img)}
  else el.textContent=(name||"M").slice(0,1).toUpperCase();
}
function applyProfile(p){
  profile={...profile,...p};
  if($("#profileName"))$("#profileName").value=p.name||"";
  if($("#profileEmail"))$("#profileEmail").textContent=p.email||"";
  if($("#profileBio"))$("#profileBio").value=p.bio||"";
  if($("#profileBirth"))$("#profileBirth").value=p.birth_date||"";
  if($("#profileAvatar"))setAvatar($("#profileAvatar"),p.name||"M",p.avatar_url||"");
  if($("#accountAvatar"))setAvatar($("#accountAvatar"),p.name||"M",p.avatar_url||"");
  if($("#accountPageAvatar"))setAvatar($("#accountPageAvatar"),p.name||"M",p.avatar_url||"");
  if($("#profileAvatarFile"))$("#profileAvatarFile").value="";
  document.querySelectorAll(".msg.user .avatar").forEach(el=>setAvatar(el,p.name||user?.name||"M",p.avatar_url||""));
  setAccountLabel();
}
function renderEmpty(){
  $("#messages").innerHTML='<section class="hero"><h1>무엇을 도와드릴까요?</h1><p>질문, 학습, 창작, 분석, 번역까지 하나의 대화에서 이어가세요.</p><div class="cards">'+
  '<button class="card" data-q="최신 중요한 소식을 찾아서 정리해줘"><b>최신 정보</b><span>필요할 때만 웹 검색</span></button>'+
  '<button class="card" data-q="새로운 게임 아이디어를 하나 구체적으로 만들어줘"><b>아이디어</b><span>게임과 프로젝트 아이디어 발전</span></button>'+
  '<button class="card" data-q="어려운 개념을 중학생도 이해하게 설명해줘"><b>학습</b><span>복잡한 내용을 쉽게 이해</span></button>'+
  '<button class="card" data-q="자연스러운 한국어 글을 작성해줘"><b>글쓰기</b><span>문장과 콘텐츠를 함께 작성</span></button></div></section>';
  document.querySelectorAll("[data-q]").forEach(x=>x.onclick=()=>ask(x.dataset.q));
}
function normalizeMarkdown(text){
  return String(text||"").split(/(```[\\s\\S]*?```)/g).map((part,i)=>i%2?part:part.replace(/\\([*_#~\[\]])/g,"$1")).join("");
}

function chartNumbers(values){return (values||[]).map(Number).filter(Number.isFinite)}
function renderChart(data){
  try{
    const labels=(data.labels||[]).map(String);
    const sets=(data.datasets||[]).map(d=>({label:String(d.label||"값"),data:chartNumbers(d.data)})).filter(d=>d.data.length);
    if(!labels.length||!sets.length)return null;
    const w=760,h=360,left=62,right=24,top=48,bottom=62,cw=w-left-right,ch=h-top-bottom;
    const max=Math.max(1,...sets.flatMap(s=>s.data));
    const esc=v=>escapeHtml(v),title=esc(data.title||"차트"),type=String(data.type||"bar").toLowerCase();
    let svg="<svg class='chart-svg' viewBox='0 0 "+w+" "+h+"' role='img' aria-label='"+title+"'><text class='chart-svg-title' x='"+left+"' y='26'>"+title+"</text>";
    for(let j=0;j<=4;j++){const y=top+ch-j*ch/4;const v=(max*j/4).toLocaleString();svg+="<line class='chart-grid' x1='"+left+"' x2='"+(left+cw)+"' y1='"+y+"' y2='"+y+"'/><text class='chart-axis' x='"+(left-8)+"' y='"+(y+4)+"' text-anchor='end'>"+esc(v)+"</text>"}
    if(type==="line"){
      const step=labels.length>1?cw/(labels.length-1):cw;
      sets.forEach((s,si)=>{const pts=s.data.slice(0,labels.length).map((v,i)=>[left+i*step,top+ch-(v/max)*ch]);svg+="<polyline class='chart-line s"+(si%5)+"' points='"+pts.map(p=>p.join(",")).join(" ")+"'/>";pts.forEach(p=>svg+="<circle class='chart-point s"+(si%5)+"' cx='"+p[0]+"' cy='"+p[1]+"' r='4'/>")});
      labels.forEach((l,i)=>{svg+="<text class='chart-axis x-label' x='"+(left+(labels.length>1?i*cw/(labels.length-1):cw/2))+"' y='"+(top+ch+28)+"' text-anchor='middle'>"+esc(l.slice(0,12))+"</text>"})
    }else if(type==="doughnut"||type==="pie"){
      const vals=sets[0].data.slice(0,labels.length),total=Math.max(1,vals.reduce((a,b)=>a+b,0)),cx=left+cw*.45,cy=top+ch*.48,r=74,c=2*Math.PI*r;
      let offset=0;vals.forEach((v,i)=>{const dash=c*(Math.max(0,v)/total);svg+="<circle class='chart-donut s"+(i%5)+"' cx='"+cx+"' cy='"+cy+"' r='"+r+"' stroke-dasharray='"+dash+" "+(c-dash)+"' stroke-dashoffset='"+(-offset)+"'/>";offset+=dash});
      labels.forEach((l,i)=>{const y=top+12+i*22;svg+="<circle class='legend-dot s"+(i%5)+"' cx='"+(left+cw*.76)+"' cy='"+y+"' r='5'/><text class='legend-text' x='"+(left+cw*.76+11)+"' y='"+(y+4)+"'>"+esc(l)+" · "+esc(String(vals[i]??0))+"</text>"})
    }else{
      const group=cw/labels.length,barW=Math.max(10,Math.min(42,group/(sets.length+1)));
      labels.forEach((l,i)=>{sets.forEach((s,si)=>{const v=s.data[i]??0,x=left+i*group+group/2-(sets.length*barW)/2+si*barW,y=top+ch-(v/max)*ch,hh=top+ch-y;svg+="<rect class='chart-bar s"+(si%5)+"' x='"+x+"' y='"+y+"' width='"+Math.max(4,barW-4)+"' height='"+Math.max(0,hh)+"' rx='5'><title>"+esc(s.label)+": "+esc(String(v))+"</title></rect>"});svg+="<text class='chart-axis x-label' x='"+(left+i*group+group/2)+"' y='"+(top+ch+28)+"' text-anchor='middle'>"+esc(l.slice(0,12))+"</text>"})
    }
    svg+="</svg><div class='chart-legend'>"+sets.map((s,i)=>"<span><i class='legend-dot s"+(i%5)+"'></i>"+esc(s.label)+"</span>").join("")+"</div>";
    return svg;
  }catch{return null}
}
function mountCharts(el){
  el.querySelectorAll(".code-shell").forEach(shell=>{
    const lang=(shell.querySelector(".code-head span")?.textContent||"").trim().toLowerCase();
    if(lang!=="mirae-chart"&&lang!=="mirae-chart-data")return;
    const code=shell.querySelector("pre code")?.textContent||"";
    try{const html=renderChart(JSON.parse(code));if(html){const box=document.createElement("div");box.className="chart-card";box.innerHTML=html;shell.replaceWith(box)}}catch{}
  });
}
function renderAttachmentStrip(){
  const box=$("#attachmentStrip");if(!box)return;
  box.innerHTML="";box.classList.toggle("hidden",!attachments.length);
  attachments.forEach((x,i)=>{
    const el=document.createElement("div");el.className="attachment-chip";
    const icon=x.previewUrl?"image":"file";
    el.innerHTML="<i class='attachment-icon' data-lucide='"+icon+"'></i><span class='attachment-meta'><b>"+escapeHtml(x.name)+"</b><small>"+formatBytes(x.size)+(x.text?" · 텍스트 읽음":"")+"</small></span><button type='button' class='attachment-remove' data-i='"+i+"' aria-label='첨부 삭제'><i data-lucide='x'></i></button>";
    box.appendChild(el);
  });
  box.querySelectorAll(".attachment-remove").forEach(btn=>btn.onclick=()=>{
    const i=Number(btn.dataset.i),x=attachments[i];
    if(x?.previewUrl)URL.revokeObjectURL(x.previewUrl);
    attachments.splice(i,1);renderAttachmentStrip();
  });
  if(window.lucide)lucide.createIcons({root:box});
}

function formatBytes(n){if(n<1024)return n+" B";if(n<1024*1024)return (n/1024).toFixed(1)+" KB";return (n/1024/1024).toFixed(1)+" MB"}
async function addFiles(fileList){
  const files=[...fileList].slice(0,Math.max(0,5-attachments.length));
  if(!files.length)return;
  const supported=/\.(pdf|docx|xlsx|pptx|zip|txt|md|json|csv|py|js|ts|tsx|jsx|html|css|sql|yaml|yml|xml|log|ini)$/i;
  const binary=files.filter(x=>supported.test(x.name)&&!x.type.startsWith("image/"));
  const rejected=files.filter(x=>!supported.test(x.name)&&!x.type.startsWith("image/"));
  if(binary.length){
    const fd=new FormData();binary.forEach(x=>fd.append("files",x));
    try{
      $("#globalStatus").textContent="파일 분석 중";
      const d=await req("/files/extract",{method:"POST",body:fd});
      if(!Array.isArray(d.files))throw Error("파일 분석 서버가 올바른 응답을 반환하지 않았습니다.");
      d.files.forEach(x=>attachments.push({name:x.name,type:x.type,size:x.size,text:x.text||"",chunks:x.chunks||[],chunk_count:x.chunk_count||1,previewUrl:""}));
    }catch(e){
      $("#globalStatus").textContent="파일 분석 실패";
      alert(e.message||"파일을 분석하지 못했습니다.");
    }
  }
  for(const file of files.filter(x=>x.type.startsWith("image/"))){
    const item={name:file.name,type:file.type,size:file.size,text:"",previewUrl:URL.createObjectURL(file),image:true};
    attachments.push(item);
    runImageOcr(item,file).catch(()=>{});
  }
  if(rejected.length)$("#globalStatus").textContent="지원하지 않는 파일 형식이 있습니다";
  renderAttachmentStrip();
  if(attachments.length)$("#globalStatus").textContent=attachments.length+"개 파일 첨부됨";
}

async function runImageOcr(item,file){
  try{
    const fd=new FormData();fd.append("file",file);
    $("#globalStatus").textContent="이미지 이해 중…";
    const vision=await req("/vision",{method:"POST",body:fd});
    if(vision.text){
      item.text=String(vision.text).slice(0,18000);
      item.vision=true;
      renderAttachmentStrip();
      $("#globalStatus").textContent="이미지 이해 완료";
      return;
    }
  }catch{}
  try{
    if(!window.Tesseract){
      const s=document.createElement("script");s.src="https://cdn.jsdelivr.net/npm/tesseract.js@6/dist/tesseract.min.js";document.head.appendChild(s);
      await new Promise((res,rej)=>{s.onload=res;s.onerror=rej});
    }
    $("#globalStatus").textContent="이미지 OCR 분석 중…";
    const result=await Tesseract.recognize(file,"kor+eng");
    item.text=String(result.data.text||"").slice(0,18000);
    item.ocr=true;
    renderAttachmentStrip();
    $("#globalStatus").textContent="이미지 OCR 완료";
  }catch{
    item.text="";
    item.ocr=false;
    renderAttachmentStrip();
    $("#globalStatus").textContent="이미지 첨부 완료";
  }
}
function renderMessageAttachments(e,list){
  if(!list?.length)return;
  const box=document.createElement("div");box.className="message-attachments";
  list.forEach(a=>{const item=document.createElement("div");item.className="message-attachment";const media=a.previewUrl?"<img src='"+a.previewUrl+"' alt=''>":"<span class='attachment-icon'>"+(String(a.type||"").startsWith("image/")?"IMG":"FILE")+"</span>";item.innerHTML=media+"<span><b>"+escapeHtml(a.name)+"</b><small>"+formatBytes(a.size)+(a.text?" · 텍스트 포함":"")+"</small></span>";box.appendChild(item)});
  e.querySelector(".wrap").insertBefore(box,e.querySelector(".bubble"));
}

function openTool(id){$(id).classList.remove("hidden")}
function closeTool(id){$(id).classList.add("hidden")}
function setupTools(){
  const on=(id,event,fn)=>{const el=$(id);if(el)el.addEventListener(event,fn)};
  on("#canvasButton","click",()=>{openTool("#canvasOverlay");$("#canvasEditor").focus()});
  on("#closeCanvas","click",()=>closeTool("#canvasOverlay"));
  on("#markdownButton","click",()=>{openTool("#markdownOverlay");$("#markdownEditor").value="";$("#markdownPreview").innerHTML=""});
  on("#closeMarkdown","click",()=>closeTool("#markdownOverlay"));
  on("#markdownEditor","input",e=>$("#markdownPreview").innerHTML=renderMarkdown(e.target.value));
  on("#canvasImprove","click",()=>{const v=$("#canvasEditor").value.trim();if(v)ask("다음 문서를 전문적이고 자연스럽게 다듬어줘.\n\n"+v)});
  on("#canvasSummary","click",()=>{const v=$("#canvasEditor").value.trim();if(v)ask("다음 문서를 핵심만 요약해줘.\n\n"+v)});
  on("#canvasMarkdown","click",()=>copyText($("#canvasEditor").value,$("#canvasMarkdown")));
  on("#codeButton","click",()=>openTool("#codeOverlay"));
  on("#closeCode","click",()=>closeTool("#codeOverlay"));
  on("#runCode","click",runBrowserCode);
  on("#imageButton","click",()=>{const p=prompt("생성할 이미지 설명을 입력하세요.");if(p)ask("이미지를 생성해줘. 프롬프트: "+p)});
  on("#voiceButton","click",toggleVoiceInput);
}
async function runBrowserCode(){
  const lang=$("#codeLanguage").value,src=$("#codeEditor").value,out=$("#codeOutput");out.textContent="실행 중…";
  if(lang==="javascript"){
    const code="self.onmessage=function(e){var o=[];var log=function(){o.push(Array.from(arguments).map(String).join(' '))};try{console.log=log;var r=eval(e.data);if(r!==undefined)o.push(String(r));self.postMessage({ok:true,text:o.join('\\n')})}catch(x){self.postMessage({ok:false,text:String(x)})}}";
    const worker=new Worker(URL.createObjectURL(new Blob([code],{type:"text/javascript"})));
    worker.onmessage=e=>{out.textContent=e.data.text||"(출력 없음)";worker.terminate()};worker.postMessage(src);setTimeout(()=>{try{worker.terminate();if(out.textContent==="실행 중…")out.textContent="실행 시간이 제한을 초과했습니다."}catch{}},5000);return
  }
  out.textContent="Python 런타임을 준비하는 중…";
  try{
    if(!window.loadPyodide){const s=document.createElement("script");s.src="https://cdn.jsdelivr.net/pyodide.org/v0.28.2/full/pyodide.js";document.head.appendChild(s);await new Promise((res,rej)=>{s.onload=res;s.onerror=rej})}
    const py=await loadPyodide({stdout:t=>out.textContent+=(t+"\\n"),stderr:t=>out.textContent+=(t+"\\n")});
    await py.runPythonAsync(src);if(!out.textContent.trim())out.textContent="(출력 없음)";
  }catch(e){out.textContent="Python 실행 오류: "+e}
}
let recognition=null;
function toggleVoiceInput(){
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SR){alert("이 브라우저에서는 음성 입력을 지원하지 않습니다.");return}
  if(recognition){recognition.stop();recognition=null;$("#voiceButton").textContent="음성";return}
  recognition=new SR();recognition.lang="ko-KR";recognition.interimResults=true;recognition.continuous=false;
  recognition.onstart=()=>$("#voiceButton").textContent="듣는 중…";
  recognition.onresult=e=>{let s="";for(let i=e.resultIndex;i<e.results.length;i++)s+=e.results[i][0].transcript;$("#input").value=s;$("#input").dispatchEvent(new Event("input"))};
  recognition.onerror=()=>{recognition=null;$("#voiceButton").textContent="음성"};
  recognition.onend=()=>{recognition=null;$("#voiceButton").textContent="음성"};
  recognition.start();
}
function renderMarkdown(text){
  const src=normalizeMarkdown(text);const lines=src.split("\n"),out=[];let i=0;
  const esc=v=>escapeHtml(v);const inline=v=>{let s=esc(v),links=[];s=s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g,(_,label,url)=>{const i=links.push("<a href=\""+url+"\" target=\"_blank\" rel=\"noopener noreferrer nofollow\">"+label+"</a>")-1;return "\u0000L"+i+"\u0000"});s=s.replace(/(https?:\/\/[^\s<]+)/g,'<a href="$1" target="_blank" rel="noopener noreferrer nofollow">$1</a>');s=s.replace(/`([^`\n]+)`/g,"<code>$1</code>");s=s.replace(/(\*\*|__)(.+?)\1/g,"<strong>$2</strong>");s=s.replace(/~~(.+?)~~/g,"<del>$1</del>");s=s.replace(/(^|[^\\w])\*([^*\n]+)\*(?!\*)/g,"$1<em>$2</em>");s=s.replace(/\u0000L(\d+)\u0000/g,(_,i)=>links[Number(i)]);return s};
  while(i<lines.length){const line=lines[i];if(!line.trim()){i++;continue}
    if(/^```/.test(line.trim())){const lang=(line.trim().slice(3).trim()||"text").replace(/[^A-Za-z0-9_+#.-]/g,""),code=[];i++;while(i<lines.length&&!/^```/.test(lines[i].trim())){code.push(lines[i]);i++}if(i<lines.length)i++;out.push("<div class='code-shell'><div class='code-head'><span>"+esc(lang)+"</span><button type='button' class='code-copy'>복사</button></div><pre><code>"+esc(code.join("\n"))+"</code></pre></div>");continue}
    let m=line.match(/^(#{1,6})\s+(.+)$/);if(m){const n=m[1].length;out.push("<h"+n+">"+inline(m[2])+"</h"+n+">");i++;continue}
    if(/^[-*+]\s+/.test(line)){const b=[];while(i<lines.length&&/^[-*+]\s+/.test(lines[i])){b.push(lines[i].replace(/^[-*+]\s+/,""));i++}out.push("<ul>"+b.map(x=>"<li>"+inline(x)+"</li>").join("")+"</ul>");continue}
    if(/^\d+\.\s+/.test(line)){const b=[];while(i<lines.length&&/^\d+\.\s+/.test(lines[i])){b.push(lines[i].replace(/^\d+\.\s+/,""));i++}out.push("<ol>"+b.map(x=>"<li>"+inline(x)+"</li>").join("")+"</ol>");continue}
    if(/^>\s?/.test(line)){const b=[];while(i<lines.length&&/^>\s?/.test(lines[i])){b.push(lines[i].replace(/^>\s?/,""));i++}out.push("<blockquote>"+b.map(inline).join("<br>")+"</blockquote>");continue}
    if(i+1<lines.length&&line.includes("|")&&lines[i+1].includes("|")){const h=line.split("|").slice(1,-1),sep=lines[i+1].split("|").slice(1,-1);if(h.length&&h.length===sep.length&&sep.every(x=>/^\s*:?-{3,}:?\s*$/.test(x))){let html="<div class='md-table-wrap'><table><thead><tr>"+h.map(x=>"<th>"+inline(x.trim())+"</th>").join("")+"</tr></thead><tbody>";i+=2;while(i<lines.length&&lines[i].includes("|")&&lines[i].trim()){const c=lines[i].split("|").slice(1,-1);if(c.length!==h.length)break;html+="<tr>"+c.map(x=>"<td>"+inline(x.trim())+"</td>").join("")+"</tr>";i++}out.push(html+"</tbody></table></div>");continue}}
    const p=[line];i++;while(i<lines.length&&lines[i].trim()&&!/^(#{1,6})\s+/.test(lines[i])&&!/^```/.test(lines[i].trim())&&!/^[-*+]\s+/.test(lines[i])&&!/^\d+\.\s+/.test(lines[i])&&!/^>\s?/.test(lines[i])){p.push(lines[i]);i++}out.push("<p>"+p.map(inline).join("<br>")+"</p>");
  }return out.join("");
}
function addCodeCopy(pre){
  if(pre.querySelector(".code-copy"))return;
  pre.classList.add("code-block");
  const button=document.createElement("button");button.className="code-copy";button.type="button";button.textContent="복사";
  button.onclick=async()=>{try{await navigator.clipboard.writeText(pre.querySelector("code")?.textContent||"");button.textContent="복사됨";setTimeout(()=>button.textContent="복사",1200)}catch{button.textContent="복사 실패"}};
  pre.appendChild(button);
}
function renderBubble(el,text){
  el.innerHTML=renderMarkdown(text);
  mountCharts(el);
  el.querySelectorAll(".code-copy").forEach(button=>{button.onclick=async()=>{const code=button.closest(".code-shell")?.querySelector("pre code")?.textContent||button.closest("pre")?.querySelector("code")?.textContent||"";await copyText(code,button)}});
}
function add(role,text,sources=[],feedbackKey="",messageAttachments=[]){
  const e=document.createElement("article");e.className="msg "+role;
  const name=role==="user"?(profile.name||user?.name||"나"):"Mirae";
  e.innerHTML='<div class="msg-id"><div class="avatar"></div><b class="msg-name">'+escapeHtml(name)+'</b></div><div class="wrap"><div class="bubble"></div></div>';
  const avatar=e.querySelector(".avatar");
  if(role==="user")setAvatar(avatar,name,profile.avatar_url||"");else avatar.innerHTML="<img src=\""+MIRAE_LOGO+"\" alt=\"Mirae\" loading=\"lazy\">";
  if(role==="assistant")renderBubble(e.querySelector(".bubble"),text);else e.querySelector(".bubble").textContent=text;
  if(role==="assistant"&&sources.length)renderSources(e,sources);
  if(role==="user"&&messageAttachments.length)renderMessageAttachments(e,messageAttachments);
  if(role==="assistant"&&feedbackKey)addMessageActions(e,feedbackKey,text);
  $("#messages").appendChild(e);e.scrollIntoView({behavior:"auto",block:"end"});return e;
}
async function copyText(text,button){
  try{
    await navigator.clipboard.writeText(text);
    button.setAttribute("aria-label","복사됨");
    button.title="복사됨";
    setTimeout(()=>{button.setAttribute("aria-label","복사");button.title="복사"},1200);
  }catch{
    button.setAttribute("aria-label","복사 실패");
    button.title="복사 실패";
  }
}
function actionIcon(name){
  const icons={
    copy:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2"></rect><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"></path></svg>',
    like:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10v10H4V10h3Zm0 10h10.2a2 2 0 0 0 1.96-1.62l1.02-5.5A2 2 0 0 0 18.22 10H14l.65-3.25A2.2 2.2 0 0 0 12.5 4.1L7 10"></path></svg>',
    dislike:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 14V4H4v10h3Zm0-10h10.2a2 2 0 0 1 1.96 1.62l1.02 5.5A2 2 0 0 1 18.22 14H14l.65 3.25a2.2 2.2 0 0 1-2.15 2.65L7 14"></path></svg>',
    speak:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4Z"></path><path d="M16 9.5a4 4 0 0 1 0 5M18.5 7a7 7 0 0 1 0 10"></path></svg>'
  };
  return icons[name]||"";
}
function addMessageActions(e,key,text){
  const wrap=e.querySelector(".wrap");
  const actions=document.createElement("div");actions.className="message-actions";
  const copy=document.createElement("button");copy.className="message-action";copy.type="button";copy.innerHTML=actionIcon("copy");copy.setAttribute("aria-label","복사");copy.title="복사";copy.onclick=()=>copyText(text,copy);
  const like=document.createElement("button");like.className="message-action feedback";like.type="button";like.dataset.value="like";like.innerHTML=actionIcon("like");like.setAttribute("aria-label","좋아요");like.title="좋아요";
  const dislike=document.createElement("button");dislike.className="message-action feedback";dislike.type="button";dislike.dataset.value="dislike";dislike.innerHTML=actionIcon("dislike");dislike.setAttribute("aria-label","싫어요");dislike.title="싫어요";
  [like,dislike].forEach(btn=>btn.onclick=async()=>{actions.querySelectorAll(".feedback").forEach(x=>x.classList.remove("selected"));btn.classList.add("selected");if(user)try{await req("/feedback",{method:"PUT",body:JSON.stringify({feedback:btn.dataset.value,message_hash:key,conversation_id:currentId})})}catch{}});
  actions.append(copy,like,dislike);wrap.appendChild(actions);
}
function renderSources(e,sources){
  let box=e.querySelector(".sources");
  if(!box){box=document.createElement("div");box.className="sources";e.querySelector(".wrap").appendChild(box)}
  box.innerHTML="";
  sources.forEach((s,i)=>{const a=document.createElement("a");a.href=s.url;a.target="_blank";a.rel="noopener noreferrer nofollow";a.className="source-card";const host=(()=>{try{return new URL(s.url).hostname.replace(/^www\./,"")}catch{return "source"}})();a.innerHTML="<span class=\"source-index\">"+(i+1)+"</span><span class=\"source-copy\"><b>"+escapeHtml(s.title)+"</b><small>"+escapeHtml(host)+(s.published?" · "+escapeHtml(s.published):"")+"</small><em>"+escapeHtml(s.snippet||"관련 검색 결과")+"</em></span><span class=\"source-arrow\">↗</span>";box.appendChild(a)});
}
function createAssistant(){
  const e=document.createElement("article");e.className="msg assistant";
  e.innerHTML='<div class="msg-id"><div class="avatar">M</div><b class="msg-name">Mirae</b></div><div class="wrap"><div class="process"><button class="process-toggle" type="button"><span class="process-dot"></span><span class="process-label">처리 요약</span><span class="process-chevron">⌄</span></button><div class="process-details"></div></div><div class="bubble"></div></div>';
  const process=e.querySelector(".process"),toggle=e.querySelector(".process-toggle");
  toggle.onclick=()=>{process.classList.toggle("expanded");toggle.querySelector(".process-chevron").textContent=process.classList.contains("expanded")?"⌃":"⌄"};
  $("#messages").appendChild(e);e.scrollIntoView({behavior:"smooth",block:"end"});
  return {e:e,bubble:e.querySelector(".bubble"),process:process,label:e.querySelector(".process-label"),details:e.querySelector(".process-details"),logs:[],raw:""};
}
function addProcessLog(box,label){
  const now=new Date().toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit",second:"2-digit"});
  if(box.logs[box.logs.length-1]?.label===label)return;
  box.logs.push({label:label,time:now});
  box.details.innerHTML=box.logs.map(x=>`<div class="process-log"><span>${escapeHtml(x.label)}</span><time>${x.time}</time></div>`).join("");
}
function stage(box,label){box.label.textContent=label;box.process.classList.remove("done");addProcessLog(box,label)}
function finish(box){
  box.label.textContent="답변 완료";box.process.classList.add("done");addProcessLog(box,"답변 완료");
  if(!box.e.querySelector(".message-actions"))addMessageActions(box.e,simpleHash(box.raw||box.bubble.textContent),box.raw||box.bubble.textContent);
}
function restoreServer(rows,convs=[]){
  const by={},meta=Object.fromEntries(convs.map(x=>[x.id,x])),legacy=[];
  const isEmailTitle=v=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v||"").trim());
  for(const c of convs)by[c.id]={id:c.id,title:conversationTitle(c.title||"새 대화"),favorite:!!c.favorite,folder_id:c.folder_id||null,share_code:c.share_code||"",messages:[]};
  for(const x of rows){
    const id=String(x.conversation_id||"").trim();
    const message={role:x.role,content:x.content,sources:x.sources||[],attachments:x.attachments||[],feedback_key:x.role==="assistant"?simpleHash(x.content):""};
    if(id){
      if(!by[id])by[id]={id,title:conversationTitle(x.conversation_title||"새 대화"),favorite:false,folder_id:null,share_code:"",messages:[]};
      by[id].messages.push(message);
    }else legacy.push({...message,created_at:x.created_at});
  }

  const groups=[];let g=null;
  for(const m of legacy){
    if(m.role==="user"||!g){
      if(g?.messages?.length)groups.push(g);
      g={messages:[],created_at:m.created_at};
    }
    g.messages.push(m);
  }
  if(g?.messages?.length)groups.push(g);

  const empty=Object.values(by).filter(c=>!c.messages.length).sort((x,y)=>new Date(meta[x.id]?.created_at||0)-new Date(meta[y.id]?.created_at||0));
  groups.slice(0,empty.length).forEach((group,i)=>{empty[i].messages=group.messages});

  const assigned=Math.min(groups.length,empty.length);
  for(let i=assigned;i<groups.length;i++){
    const group=groups[i];
    const firstUser=group.messages.find(m=>m.role==="user");
    const title=conversationTitle(firstUser?.content||group.messages[0]?.content||"새 대화");
    const id="legacy-"+simpleHash(JSON.stringify(group.messages).slice(0,2000))+"-"+i;
    by[id]={id,title,favorite:false,folder_id:null,share_code:"",messages:group.messages,updated_at:group.created_at};
  }

  for(const c of Object.values(by)){
    if(isEmailTitle(c.title)){
      const firstUser=c.messages.find(m=>m.role==="user");
      c.title=conversationTitle(firstUser?.content||"새 대화");
    }
  }

  const localChats=(()=>{try{const raw=JSON.parse(localStorage.getItem("mirae-local")||"[]");return Array.isArray(raw)?raw:[]}catch{return[]} })();
  const merged=[...Object.values(by)];
  for(const old of localChats){
    if(old?.id&&!merged.some(c=>c.id===old.id)&&old.messages?.length)merged.push(old);
  }
  chats=merged.sort((x,y)=>new Date(meta[y.id]?.updated_at||y.updated_at||y.created_at||0)-new Date(meta[x.id]?.updated_at||x.updated_at||x.created_at||0)).slice(0,100);
  localStorage.setItem("mirae-local",JSON.stringify(chats));
}
function renderHistory(){
  const h=$("#history");h.innerHTML="";
  const search=$("#conversationSearch");
  const q=String(search?.value||"").trim().toLowerCase();
  let list=chats.filter(c=>!q||String(c.title||"").toLowerCase().includes(q)||c.messages.some(m=>String(m.content||"").toLowerCase().includes(q)));
  const favorites=list.filter(c=>c.favorite);
  const folders={};list.filter(c=>!c.favorite&&c.folder_id).forEach(c=>(folders[c.folder_id]??=[]).push(c));
  const loose=list.filter(c=>!c.favorite&&!c.folder_id);
  const draw=(items,parent)=>items.forEach(c=>{
    const row=document.createElement("div");row.className="history-row";
    const b=document.createElement("button");b.className="btn history-main";b.textContent=c.title||"새 대화";b.title=c.title||"새 대화";b.onclick=()=>loadChat(c.id);
    const menu=document.createElement("button");menu.className="history-menu";menu.type="button";menu.textContent="⋯";menu.title="대화 메뉴";menu.onclick=e=>{e.stopPropagation();openConversationMenu(row,c)};
    row.append(b,menu);parent.appendChild(row);
  });
  if(favorites.length){const box=document.createElement("div");box.className="history-folder";box.innerHTML="<div class='history-folder-head'>★ 즐겨찾기</div><div class='history-folder-items'></div>";draw(favorites,box.querySelector(".history-folder-items"));h.appendChild(box)}
  Object.entries(folders).forEach(([id,items])=>{const f=conversationFolders.find(x=>String(x.id)===String(id));if(!f)return;const box=document.createElement("div");box.className="history-folder";box.innerHTML="<div class='history-folder-head'>▾ "+escapeHtml(f.name)+"</div><div class='history-folder-items'></div>";draw(items,box.querySelector(".history-folder-items"));h.appendChild(box)});
  draw(loose,h);
}
function closeConversationMenus(){document.querySelectorAll(".conversation-menu").forEach(x=>x.remove())}
function openConversationMenu(row,c){
  closeConversationMenus();
  const menu=document.createElement("div");menu.className="conversation-menu";
  const fav=document.createElement("button");fav.textContent=c.favorite?"★ 즐겨찾기 해제":"☆ 즐겨찾기";fav.onclick=()=>toggleFavorite(c);
  const share=document.createElement("button");share.textContent="공유 링크";share.onclick=()=>shareConversation(c);
  const folder=document.createElement("button");folder.textContent="폴더 이동";folder.onclick=()=>moveConversation(c);
  const rename=document.createElement("button");rename.textContent="이름 변경";rename.onclick=()=>renameConversation(c);
  const del=document.createElement("button");del.textContent="삭제";del.className="delete-menu";del.onclick=()=>deleteConversation(c);
  menu.append(fav,share,folder,rename,del);row.appendChild(menu);
}
let conversationFolders=[];
async function loadConversationFolders(){if(!user)return;try{conversationFolders=await req("/conversation-folders")}catch{conversationFolders=[]}}
async function toggleFavorite(c){try{const d=await req("/conversations/"+encodeURIComponent(c.id)+"/favorite",{method:"PUT",body:JSON.stringify({favorite:!c.favorite})});c.favorite=!!d.favorite;renderHistory();closeConversationMenus()}catch(e){alert(e.message)}}
async function shareConversation(c){
  try{const d=await req("/conversations/"+encodeURIComponent(c.id)+"/share",{method:"POST"});c.share_code=d.code;await copyText(d.url,{textContent:"공유 링크"});alert("공유 링크가 생성되었습니다.\n"+d.url)}catch(e){alert(e.message)}
}
async function moveConversation(c){
  if(!conversationFolders.length){alert("먼저 대화 옆의 + 버튼으로 폴더를 만들어주세요.");return}
  const text=conversationFolders.map(f=>f.id+": "+f.name).join("\n")+"\n0: 폴더에서 빼기";
  const value=prompt("이동할 폴더 번호를 입력하세요.\n\n"+text,"0");if(value===null)return;
  const id=Number(value);if(!Number.isInteger(id))return;
  try{const d=await req("/conversations/"+encodeURIComponent(c.id)+"/folder",{method:"PUT",body:JSON.stringify({folder_id:id===0?null:id})});c.folder_id=d.folder_id;renderHistory();closeConversationMenus()}catch(e){alert(e.message)}
}
async function createConversationFolder(){
  if(!user){openAuth("login");return}
  const name=prompt("새 폴더 이름");if(name===null||!name.trim())return;
  try{await req("/conversation-folders",{method:"POST",body:JSON.stringify({name:name.trim()})});await loadConversationFolders();renderHistory()}catch(e){alert(e.message)}
}
async function renameConversation(c){
  const title=prompt("새 대화 이름",c.title||"새 대화");if(title===null)return;
  const value=title.trim();if(!value)return;
  try{
    if(user)await req("/conversations/"+encodeURIComponent(c.id),{method:"PUT",body:JSON.stringify({title:value})});
    c.title=value;currentTitle=value;renderHistory();saveLocal();if(c.id===currentId)$("#title").textContent=value;
  }catch(e){alert(e.message)}
}
async function deleteConversation(c){
  if(!confirm("이 대화를 삭제할까요? 삭제하면 대화 내용도 함께 삭제됩니다."))return;
  try{
    if(user)await req("/conversations/"+encodeURIComponent(c.id),{method:"DELETE"});
    chats=chats.filter(x=>x.id!==c.id);localStorage.setItem("mirae-local",JSON.stringify(chats));
    if(c.id===currentId)newChat(false);else renderHistory();
  }catch(e){alert(e.message)}
}
document.addEventListener("click",e=>{if(e.target.closest(".history-menu")||e.target.closest(".conversation-menu"))return;closeConversationMenus()});
async function loadChat(id){
  const c=chats.find(x=>x.id===id);if(!c)return;
  currentId=id;currentTitle=c.title||"새 대화";attachments=[];renderAttachmentStrip();
  $("#title").textContent=currentTitle;
  $("#messages").innerHTML="<div class='history-loading'>대화를 불러오는 중</div>";
  closeSidebar();
  try{
    if(!Array.isArray(c.messages)||!c.messages.length){
      const rows=await req("/conversations/"+encodeURIComponent(id)+"/messages");
      c.messages=rows.map(x=>({role:x.role,content:x.content,sources:x.sources||[],attachments:x.attachments||[],feedback_key:x.role==="assistant"?simpleHash(x.content):""}));
      localStorage.setItem("mirae-local",JSON.stringify(chats));
    }
    current=c.messages||[];
    $("#messages").innerHTML="";
    current.forEach(m=>add(m.role,m.content,m.sources||[],m.feedback_key||"",m.attachments||[]));
  }catch(e){
    $("#messages").innerHTML="";renderEmpty();
    $("#globalStatus").textContent=e.message||"대화를 불러오지 못했습니다.";
  }
}
function newChat(save=true){
  if(save&&current.length)saveLocal();
  attachments.forEach(a=>{if(a.previewUrl)URL.revokeObjectURL(a.previewUrl)});attachments=[];renderAttachmentStrip();
  current=[];currentId=crypto.randomUUID();currentTitle="새 대화";$("#messages").innerHTML="";renderEmpty();$("#title").textContent="새 대화";closeSidebar();
}
function saveLocal(){
  let c=chats.find(x=>x.id===currentId);
  if(!c){c={id:currentId,title:currentTitle||"새 대화",messages:[]};chats.push(c)}
  c.messages=current;c.title=currentTitle||c.title||"새 대화";
  chats=chats.slice(-100);localStorage.setItem("mirae-local",JSON.stringify(chats));renderHistory();
}
function parseSSEBlock(block,box,state){
  let ev="message",data="";
  block.replace(/\r/g,"").split("\n").forEach(line=>{if(line.startsWith("event:"))ev=line.slice(6).trim();if(line.startsWith("data:"))data+=(data?"\n":"")+line.slice(5).trim()});
  if(!data)return;let obj;try{obj=JSON.parse(data)}catch{return}
  if(ev==="stage"){
    const labels={analyze:"질문 분석",search:"관련 정보 확인",generate:"답변 생성",title:"대화 제목 정리",skill:"스킬 실행"};
    stage(box,labels[obj.id]||obj.label||"처리 중");
  }
  else if(ev==="sources"){state.sources=obj.sources||[];if(state.sources.length){addProcessLog(box,"웹 검색 완료 · "+state.sources.length+"개 결과");renderSources(box.e,state.sources)}}
  else if(ev==="conversation"){state.conversation_id=obj.id||"";state.title=conversationTitle(obj.title||"새 대화");currentTitle=state.title;const c=chats.find(x=>x.id===state.conversation_id);if(c)c.title=state.title;$("#title").textContent=state.title}
  else if(ev==="delta"){box.raw=(box.raw||"")+(obj.text||"");box.bubble.textContent=box.raw;box.e.scrollIntoView({behavior:"smooth",block:"end"})}
  else if(ev==="done"){state.done=true;if(obj.conversation_id)state.conversation_id=obj.conversation_id;renderBubble(box.bubble,box.raw||"");finish(box)}
  else if(ev==="error")throw Error(obj.message||"생성 중 오류가 발생했습니다.");
}
async function streamAsk(text,box){
  const body={message:text,history:current.slice(0,-1).slice(-12),personality:settings.personality,instructions:settings.instructions,web_search:settings.web_search,temperature:settings.temperature,max_tokens:1400,conversation_id:currentId,attachments:attachments.map(({name,type,size,text})=>({name,type,size,text}))};
  stage(box,"질문 분석");
  const r=await fetch(API+"/chat/stream",{method:"POST",credentials:"include",headers:{"Content-Type":"application/json","Accept":"text/event-stream"},body:JSON.stringify(body)});
  if(!r.ok)throw Error(await r.text().catch(()=>"AI API 요청에 실패했습니다."));
  if(!r.body)throw Error("스트리밍 응답을 받을 수 없습니다.");
  const reader=r.body.getReader(),decoder=new TextDecoder();let buffer="",state={done:false,sources:[],conversation_id:"",title:currentTitle};
  while(true){const {value,done}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});let parts=buffer.split(/\n\n/);buffer=parts.pop()||"";for(const part of parts)parseSSEBlock(part,box,state)}
  if(buffer.trim())parseSSEBlock(buffer,box,state);
  if(!state.done)finish(box);
  if(!box.raw)throw Error("AI 서버가 답변을 반환하지 않았습니다.");
  return {reply:box.raw,sources:state.sources||[],conversation_id:state.conversation_id||currentId,title:state.title||currentTitle};
}

async function generateImage(prompt){
  const clean=String(prompt||"").replace(/^(?:이미지|그림)\s*(?:생성|그려|만들어)?\s*[:：-]?\s*/i,"").trim();
  if(!clean)return;
  const box=createAssistant();
  stage(box,"이미지 생성 요청");
  try{
    const d=await req("/images/generate",{method:"POST",body:JSON.stringify({prompt:clean})});
    box.bubble.innerHTML="<div class='generated-image'><img src='"+escapeHtml(d.url)+"' alt='생성된 이미지' loading='lazy'><a href='"+escapeHtml(d.url)+"' target='_blank' rel='noopener noreferrer'>이미지 열기</a></div>";
    finish(box);
  }catch(e){
    box.bubble.textContent="이미지를 생성하지 못했습니다. "+e.message;
    finish(box);
  }
}
async function ask(text){
  text=text.trim();if(!text&&!attachments.length)return;

  if(!text&&attachments.length)text="첨부한 파일을 분석해줘.";
  const sentAttachments=attachments.map(a=>({...a}));
  attachments=[];renderAttachmentStrip();
  if(!current.length)$("#messages").innerHTML="";
  add("user",text,[],"",sentAttachments);current.push({role:"user",content:text,attachments:sentAttachments.map(({name,type,size,text})=>({name,type,size,text}))});if(current.length===1&&currentTitle==="새 대화"){currentTitle=conversationTitle(text);$("#title").textContent=currentTitle}else $("#title").textContent=currentTitle;$("#input").value="";$("#send").disabled=true;
  attachments=sentAttachments;
  const box=createAssistant();
  try{
    const d=await streamAsk(text,box);
    current.push({role:"assistant",content:d.reply,sources:d.sources||[],attachments:[]});
    if(d.conversation_id)currentId=d.conversation_id;
    const c=chats.find(x=>x.id===currentId);
    if(c){c.messages=current;c.title=d.title||currentTitle}
    saveLocal();
  }
  catch(e){box.bubble.textContent="오류가 발생했습니다. "+e.message;finish(box);current.pop()}
  finally{attachments=[];renderAttachmentStrip();$("#send").disabled=false;$("#input").focus()}
}
function openAuth(mode="login"){authMode=mode;pendingSignup=null;renderAuth();$("#authOverlay").classList.remove("hidden");$("#email").focus()}
function closeAuth(){$("#authOverlay").classList.add("hidden")}
function renderAuth(){
  const verify=authMode==="verify",signup=authMode==="signup";
  $("#authTitle").textContent=verify?"이메일 인증":signup?"Mirae 계정 만들기":"Mirae에 로그인";
  $("#authDesc").textContent=verify?"이메일로 받은 6자리 인증 코드를 입력하세요.":signup?"회원가입을 완료하려면 이메일 인증이 필요합니다.":"계정으로 대화 기록과 설정을 동기화하세요.";
  $("#nameField").classList.toggle("hidden",!signup);$("#passwordField").classList.toggle("hidden",verify);$("#codeField").classList.toggle("hidden",!verify);$("#verifyNote").classList.toggle("hidden",!verify);
  $("#authSubmit").textContent=verify?"인증하고 가입 완료":signup?"인증 코드 보내기":"로그인";
  $("#resendCode").classList.toggle("hidden",!verify);$("#authSwitch").classList.toggle("hidden",verify);
  $("#authSwitch").textContent=signup?"이미 계정이 있다면 로그인":"처음이라면 회원가입";$("#authMsg").textContent="";
}
async function finishLogin(d){
  user=d.user;if($("#conversationSearch"))$("#conversationSearch").value="";closeAuth();setAccountLabel();await Promise.all([loadSettings(),loadProfile(),loadHistory()]);fillSettings();newChat(false);
}
$("#authSubmit").onclick=async()=>{
  $("#authMsg").textContent="";
  try{
    if(authMode==="signup"){
      pendingSignup={name:$("#name").value.trim(),email:$("#email").value.trim(),password:$("#password").value};
      await req("/auth/signup/request",{method:"POST",body:JSON.stringify(pendingSignup)});
      authMode="verify";$("#email").value=pendingSignup.email;renderAuth();$("#code").focus();startResendTimer();
    }else if(authMode==="verify"){
      const d=await req("/auth/signup/verify",{method:"POST",body:JSON.stringify({email:pendingSignup.email,code:$("#code").value.trim()})});await finishLogin(d);
    }else{
      const d=await req("/auth/login",{method:"POST",body:JSON.stringify({email:$("#email").value.trim(),password:$("#password").value})});await finishLogin(d);
    }
  }catch(e){$("#authMsg").textContent=e.message}
};
$("#authSwitch").onclick=()=>{authMode=authMode==="login"?"signup":"login";pendingSignup=null;renderAuth()};
$("#closeAuth").onclick=closeAuth;
function startResendTimer(){
  clearInterval(resendTimer);let left=60;$("#resendCode").disabled=true;$("#resendCode").textContent="인증 코드 다시 보내기 ("+left+")";
  resendTimer=setInterval(()=>{left--;$("#resendCode").textContent=left?"인증 코드 다시 보내기 ("+left+")":"인증 코드 다시 보내기";if(!left){clearInterval(resendTimer);$("#resendCode").disabled=false}},1000);
}
$("#resendCode").onclick=async()=>{try{await req("/auth/signup/request",{method:"POST",body:JSON.stringify(pendingSignup)});$("#authMsg").textContent="새 인증 코드를 보냈습니다.";startResendTimer()}catch(e){$("#authMsg").textContent=e.message}};
function queueSettingsSave(){
  settings={theme:$("#theme").value,personality:$("#personality").value,instructions:$("#instructions").value,web_search:$("#web").value==="true",temperature:settings.temperature||.7};
  applyTheme();
  clearTimeout(settingsSaveTimer);
  if(!user)return;
  settingsSaveTimer=setTimeout(async()=>{try{await req("/settings",{method:"PUT",body:JSON.stringify(settings)})}catch(e){console.error(e)}},300);
}
["theme","personality","instructions","web"].forEach(id=>{const el=$("#"+id);if(el)el.onchange=queueSettingsSave});
if($("#instructions"))$("#instructions").oninput=queueSettingsSave;
async function openSettings(page="general"){
  if(!user){openAuth("login");return}
  await Promise.all([loadSettings(),loadProfile()]);fillSettings();setAccountLabel();$("#settingsOverlay").classList.remove("hidden");selectPage(page);
}
function selectPage(page){
  document.querySelectorAll(".nav-btn").forEach(b=>b.classList.toggle("active",b.dataset.page===page));
  document.querySelectorAll(".page").forEach(p=>p.classList.toggle("hidden",p.id!=="page-"+page));
  const b=document.querySelector('.nav-btn[data-page="'+page+'"]');$("#settingTitle").textContent=b?b.textContent:"설정";$("#settingEyebrow").textContent=(b?b.textContent:"설정").toUpperCase();
  if(page==="skills")loadSkills();if(page==="plugins")loadPlugins();if(page==="memory")loadMemories();if(page==="developer"){loadApiUsage();loadWebhooks();}
}
document.querySelectorAll(".nav-btn").forEach(b=>b.onclick=()=>selectPage(b.dataset.page));
$("#closeSettings").onclick=()=>$("#settingsOverlay").classList.add("hidden");
$("#settingsMenu").onclick=()=>openSettings("general");
$("#adminPanelButton").onclick=openAdminPanel;
$("#closeAdmin").onclick=closeAdminPanel;
document.querySelectorAll(".admin-tab").forEach(b=>b.onclick=()=>{
  document.querySelectorAll(".admin-tab").forEach(x=>x.classList.toggle("active",x===b));
  document.querySelectorAll(".admin-page").forEach(x=>x.classList.add("hidden"));
  const suffix=b.dataset.adminPage==="overview"?"":"-page";
  const p=$("#admin-"+b.dataset.adminPage+suffix);if(p)p.classList.remove("hidden");
  if(b.dataset.adminPage==="overview")openAdminPanel();
});
$("#saveAdminSettings").onclick=saveAdminSettings;
$("#cleanupAdminLogs").onclick=cleanupAdminLogs;
$("#refreshAdminSecurity").onclick=loadAdminSecurity;
$("#refreshAdminTraffic").onclick=loadAdminTraffic;
$("#refreshAdminAll").onclick=loadAdminOverview;

$("#developerApiKeys").onclick=()=>location.href="/api-keys";
$("#developerApiDocs").onclick=()=>location.href="/api-docs";

const paletteCommands=[
  ["새 대화","새 대화를 시작합니다.",()=>newChat()],
  ["대화 검색","왼쪽 대화 검색창으로 이동합니다.",()=>$("#conversationSearch").focus()],
  ["설정 열기","Mirae 설정을 엽니다.",()=>openSettings("general")],
  ["Canvas 열기","AI Canvas를 엽니다.",()=>{openTool("#canvasOverlay");$("#canvasEditor").focus()}],
  ["Markdown 편집기","Markdown 편집기를 엽니다.",()=>openTool("#markdownOverlay")],
  ["코드 실행","코드 실행 샌드박스를 엽니다.",()=>openTool("#codeOverlay")],
  ["파일 첨부","파일 선택 창을 엽니다.",()=>$("#fileInput").click()],
  ["음성 입력","브라우저 음성 입력을 시작합니다.",()=>toggleVoiceInput()],
  ["이미지 생성","Mirae 이미지 생성기를 엽니다.",()=>{const p=prompt("생성할 이미지를 설명하세요.");if(p)generateImage("이미지 생성: "+p)}],
  ["API 문서","Mirae API 문서를 엽니다.",()=>location.href="/api-docs"],
  ["개발자 설정","API/Webhook/플러그인 관리 화면을 엽니다.",()=>openSettings("developer")],
  ["플러그인 관리","Mirae 플러그인 화면을 엽니다.",()=>openSettings("plugins")]
];
let paletteIndex=0;
function renderCommandPalette(filter=""){
  const box=$("#commandList"),q=filter.trim().toLowerCase();
  const list=paletteCommands.filter(x=>(x[0]+" "+x[1]).toLowerCase().includes(q));
  paletteIndex=Math.min(paletteIndex,Math.max(0,list.length-1));box.innerHTML="";
  list.forEach((x,i)=>{const e=document.createElement("button");e.className="command-item"+(i===paletteIndex?" active":"");e.innerHTML="<b>"+escapeHtml(x[0])+"</b><small>"+escapeHtml(x[1])+"</small>";e.onclick=()=>{closeCommandPalette();x[2]()};box.appendChild(e)});
}
function openCommandPalette(){if($("#commandPalette").classList.contains("hidden")){$("#commandPalette").classList.remove("hidden");$("#commandSearch").value="";paletteIndex=0;renderCommandPalette();setTimeout(()=>$("#commandSearch").focus(),0)}else closeCommandPalette()}
function closeCommandPalette(){$("#commandPalette").classList.add("hidden")}
$("#closeCommandPalette").onclick=closeCommandPalette;
$("#commandPalette").onclick=e=>{if(e.target.id==="commandPalette")closeCommandPalette()};
$("#commandSearch").oninput=e=>{paletteIndex=0;renderCommandPalette(e.target.value)};
$("#commandSearch").onkeydown=e=>{const q=e.target.value.trim().toLowerCase();const list=paletteCommands.filter(x=>(x[0]+" "+x[1]).toLowerCase().includes(q));if(e.key==="ArrowDown"){e.preventDefault();paletteIndex=(paletteIndex+1)%Math.max(1,list.length);renderCommandPalette(e.target.value)}else if(e.key==="ArrowUp"){e.preventDefault();paletteIndex=(paletteIndex-1+Math.max(1,list.length))%Math.max(1,list.length);renderCommandPalette(e.target.value)}else if(e.key==="Enter"&&list[paletteIndex]){e.preventDefault();closeCommandPalette();list[paletteIndex][2]()}else if(e.key==="Escape"){e.preventDefault();closeCommandPalette()}};
document.addEventListener("keydown",e=>{
  const mod=e.ctrlKey||e.metaKey;
  if(mod&&e.key.toLowerCase()==="k"){e.preventDefault();openCommandPalette();return}
  if(mod&&e.key.toLowerCase()==="n"){e.preventDefault();newChat();return}
  if(mod&&e.key.toLowerCase()==="l"&&document.activeElement!==$("#input")){e.preventDefault();$("#input").focus();return}
  if(mod&&e.shiftKey&&e.key.toLowerCase()==="o"){e.preventDefault();$("#fileInput").click();return}
  if(e.key==="Escape"&&!$("#commandPalette").classList.contains("hidden"))closeCommandPalette();
});
$("#account").onclick=()=>user?openSettings("profile"):openAuth("login");
$("#saveProfile").onclick=async()=>{
  const btn=$("#saveProfile");btn.disabled=true;
  try{
    const file=$("#profileAvatarFile")?.files?.[0];
    let p=await req("/profile",{method:"PUT",body:JSON.stringify({name:$("#profileName").value,bio:$("#profileBio").value,birth_date:$("#profileBirth").value||null,avatar_url:file?"":(profile.avatar_url||"")})});
    if(file){
      if(file.size>5*1024*1024)throw new Error("프로필 이미지는 5MB 이하만 업로드할 수 있습니다.");
      const fd=new FormData();fd.append("file",file);
      p=await req("/profile/avatar",{method:"POST",body:fd});
    }
    user.name=p.name;applyProfile(p);setAccountLabel();$("#globalStatus").textContent="프로필이 저장되었습니다.";
  }catch(e){alert(e.message)}finally{btn.disabled=false}
};
$("#profileAvatarFile").onchange=()=>{
  const file=$("#profileAvatarFile")?.files?.[0];if(!file)return;
  if(file.size>5*1024*1024){alert("프로필 이미지는 5MB 이하만 업로드할 수 있습니다.");$("#profileAvatarFile").value="";return}
  const reader=new FileReader();
  reader.onload=()=>{profile.avatar_url=String(reader.result||"");setAvatar($("#profileAvatar"),profile.name||user?.name||"M",profile.avatar_url);};
  reader.readAsDataURL(file);
};
$("#logout").onclick=async()=>{try{await req("/auth/logout",{method:"POST"})}catch{}user=null;setAccountLabel();syncAdminButton();$("#settingsOverlay").classList.add("hidden");$("#adminOverlay")?.classList.add("hidden");newChat(false)};
$("#clearLocal").onclick=()=>{localStorage.removeItem("mirae-local");chats=[];newChat(false)};
async function loadMemories(){
  if(!user)return;
  const box=$("#memoryList");box.innerHTML="<div class='muted'>메모리 불러오는 중…</div>";
  try{
    const list=await req("/memories");box.innerHTML="";
    if(!list.length){box.innerHTML="<div class='muted'>저장된 메모리가 없습니다.</div>";return}
    list.forEach(m=>{
      const card=document.createElement("div");card.className="memory-card";
      card.innerHTML='<div class="memory-content">'+escapeHtml(m.content)+'</div><button class="danger memory-delete" type="button">삭제</button>';
      card.querySelector(".memory-delete").onclick=async()=>{
        const btn=card.querySelector(".memory-delete");btn.disabled=true;
        try{
          const d=await req("/memories/"+m.id,{method:"DELETE"});
          if(d.deleted)card.remove();
          if(!box.children.length)box.innerHTML="<div class='muted'>저장된 메모리가 없습니다.</div>";
        }catch(e){btn.disabled=false;alert(e.message)}
      };
      box.appendChild(card);
    });
  }catch(e){box.innerHTML='<div class="muted">'+escapeHtml(e.message)+'</div>'}
}
$("#registerSkillPrompt").onclick=async()=>{
  const prompt=$("#skillPrompt").value.trim();if(!prompt)return;
  const btn=$("#registerSkillPrompt");btn.disabled=true;btn.textContent="스킬 구성 중…";
  try{await req("/skills/from-prompt",{method:"POST",body:JSON.stringify({prompt:prompt})});$("#skillPrompt").value="";btn.textContent="등록 완료";setTimeout(()=>btn.textContent="프롬프트로 등록",1200);loadSkills()}catch(err){alert(err.message);btn.textContent="프롬프트로 등록"}finally{btn.disabled=false}
};
async function loadSkills(){
  if(!user)return;const box=$("#skillList");box.innerHTML="<div class='muted'>스킬 불러오는 중…</div>";
  try{
    const list=await req("/skills");box.innerHTML="";
    if(!list.length){box.innerHTML="<div class='muted'>등록된 스킬이 없습니다.</div>";return}
    list.forEach(s=>{
      const card=document.createElement("div");card.className="skill-card";
      card.innerHTML='<div class="row"><div class="name">'+escapeHtml(s.name)+'</div><span class="muted">'+escapeHtml(s.method)+'</span></div><div class="desc">'+escapeHtml(s.description||"설명 없음")+'</div><div class="url">'+escapeHtml(s.url)+'</div><div class="skill-actions"><button class="outline run">실행</button><button class="danger del">삭제</button></div>';
      card.querySelector(".run").onclick=async()=>{
        const raw=prompt("파라미터 JSON을 입력하세요. 예: {\"city\":\"천안\"}","{}");if(raw===null)return;
        try{const p=JSON.parse(raw);const r=await req("/skills/"+s.id+"/run",{method:"POST",body:JSON.stringify({params:p})});alert("HTTP "+r.result.status+"\n\n"+r.result.body.slice(0,4000))}catch(e){alert(e.message)}
      };
      card.querySelector(".del").onclick=async()=>{if(!confirm("'"+s.name+"' 스킬을 삭제할까요?"))return;try{await req("/skills/"+s.id,{method:"DELETE"});loadSkills()}catch(e){alert(e.message)}};
      box.appendChild(card);
    });
  }catch(e){box.innerHTML="<div class='muted'>"+escapeHtml(e.message)+"</div>"}
}
async function loadPlugins(){
  if(!user)return;const box=$("#pluginList");box.innerHTML="<div class='muted'>플러그인 불러오는 중…</div>";
  try{
    const list=await req("/plugins");box.innerHTML="";
    if(!list.length){box.innerHTML="<div class='muted'>등록된 플러그인이 없습니다.</div>";return}
    list.forEach(p=>{
      const card=document.createElement("div");card.className="plugin-card";
      card.innerHTML="<div class='row'><div><b>"+escapeHtml(p.name)+"</b><small>"+escapeHtml(p.description||"설명 없음")+"</small></div><span class='muted'>"+(p.active?"활성":"비활성")+"</span></div><div class='url'>"+escapeHtml(p.url)+"</div><div class='plugin-permissions'>"+(p.permissions||[]).map(x=>"<span>"+escapeHtml(x)+"</span>").join("")+"</div><div class='skill-actions'><button class='outline invoke'>테스트 호출</button><button class='outline toggle'>"+(p.active?"비활성화":"활성화")+"</button><button class='danger del'>삭제</button></div>";
      card.querySelector(".invoke").onclick=async()=>{const raw=prompt("플러그인 입력 JSON","{}");if(raw===null)return;try{const r=await req("/plugins/"+p.id+"/invoke",{method:"POST",body:JSON.stringify({input:JSON.parse(raw)})});alert(JSON.stringify(r,null,2).slice(0,6000))}catch(e){alert(e.message)}};
      card.querySelector(".toggle").onclick=async()=>{try{await req("/plugins/"+p.id,{method:"PUT",body:JSON.stringify({active:!p.active})});loadPlugins()}catch(e){alert(e.message)}};
      card.querySelector(".del").onclick=async()=>{if(confirm("이 플러그인을 삭제할까요?")){await req("/plugins/"+p.id,{method:"DELETE"});loadPlugins()}};
      box.appendChild(card);
    });
  }catch(e){box.innerHTML="<div class='muted'>"+escapeHtml(e.message)+"</div>"}
}
$("#pluginForm").onsubmit=async e=>{
  e.preventDefault();
  const permissions=[...document.querySelectorAll("input[name=pluginPermission]:checked")].map(x=>x.value);
  try{await req("/plugins",{method:"POST",body:JSON.stringify({name:$("#pluginName").value,description:$("#pluginDescription").value,url:$("#pluginUrl").value,method:$("#pluginMethod").value,permissions})});e.target.reset();$("#globalStatus").textContent="플러그인이 등록되었습니다. 선택한 권한만 허용됩니다.";loadPlugins()}catch(err){alert(err.message)}
};

async function loadApiUsage(){
  try{
    const d=await req("/api-usage"),s=d.summary||{};
    $("#apiUsageSummary").textContent="요청 "+(s.requests||0)+"회 · 평균 "+(s.avg_latency_ms||0)+"ms · 토큰 "+((s.prompt_tokens||0)+(s.completion_tokens||0));
    $("#apiUsageDaily").innerHTML=(d.daily||[]).slice(0,14).map(x=>"<div><span>"+new Date(x.day).toLocaleDateString("ko-KR",{month:"numeric",day:"numeric"})+"</span><b>"+x.requests+"회</b><small>"+x.tokens+" tokens</small></div>").join("")||"<small>최근 사용량이 없습니다.</small>";
    $("#apiLogList").innerHTML=(d.logs||[]).slice(0,30).map(x=>"<div class='api-log'><b>"+escapeHtml(x.path)+"</b><span>"+x.status+" · "+x.latency_ms+"ms</span><small>"+new Date(x.created_at).toLocaleString("ko-KR")+"</small></div>").join("")||"<small>호출 로그가 없습니다.</small>";
  }catch(e){if($("#apiUsageSummary"))$("#apiUsageSummary").textContent=e.message}
}
async function loadWebhooks(){
  try{
    const list=await req("/webhooks"),box=$("#webhookList");box.innerHTML="";
    if(!list.length){box.innerHTML="<small>등록된 Webhook이 없습니다.</small>";return}
    list.forEach(w=>{const el=document.createElement("div");el.className="webhook-row";el.innerHTML="<div><b>"+escapeHtml(w.name)+"</b><small>"+escapeHtml(w.url)+"</small></div><div class='row'><button class='outline toggle'>"+(w.active?"활성":"비활성")+"</button><button class='danger del'>삭제</button></div>";el.querySelector(".toggle").onclick=async()=>{await req("/webhooks/"+w.id,{method:"PUT",body:JSON.stringify({active:!w.active})});loadWebhooks()};el.querySelector(".del").onclick=async()=>{if(confirm("이 Webhook을 삭제할까요?")){await req("/webhooks/"+w.id,{method:"DELETE"});loadWebhooks()}};box.appendChild(el)})
  }catch(e){$("#webhookList").textContent=e.message}
}
$("#createWebhook").onclick=async()=>{
  const name=prompt("Webhook 이름");if(!name)return;
  const url=prompt("Webhook URL (https:// 또는 http://)");
  if(!url)return;
  try{await req("/webhooks",{method:"POST",body:JSON.stringify({name,url,events:["api.request"]})});loadWebhooks()}catch(e){alert(e.message)}
}
async function loadApiKeys(){
  if(!user)return;
  const box=$("#apiKeyList");if(!box)return;
  box.innerHTML="<div class='muted'>API 키 불러오는 중…</div>";
  try{
    const list=await req("/api-keys");box.innerHTML="";
    if(!list.length){box.innerHTML="<div class='muted'>발급된 API 키가 없습니다.</div>";return}
    list.forEach(k=>{
      const card=document.createElement("div");card.className="api-key-card";
      card.innerHTML="<div><b>"+escapeHtml(k.name)+"</b><small>"+escapeHtml(k.key_prefix)+"•••• · "+escapeHtml(k.state)+"</small></div><button class='danger api-key-revoke' type='button'>폐기</button>";
      card.querySelector(".api-key-revoke").onclick=async()=>{if(!confirm("이 API 키를 폐기할까요?"))return;try{await req("/api-keys/"+k.id,{method:"DELETE"});loadApiKeys()}catch(e){alert(e.message)}};
      box.appendChild(card);
    });
  }catch(e){box.innerHTML="<div class='muted'>"+escapeHtml(e.message)+"</div>"}
}
async function createApiKey(){
  const name=$("#apiKeyName").value.trim();if(!name)return;
  const btn=$("#createApiKey");btn.disabled=true;
  try{
    const d=await req("/api-keys",{method:"POST",body:JSON.stringify({name})});
    $("#apiKeyName").value="";$("#apiKeyReveal").textContent=d.key||"";$("#apiKeyRevealWrap").classList.remove("hidden");loadApiKeys();
  }catch(e){alert(e.message)}finally{btn.disabled=false}
}
function escapeHtml(v){return String(v).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]))}
$("#skillForm").onsubmit=async e=>{
  e.preventDefault();
  try{
    const names=$("#skillParams").value.split(",").map(x=>x.trim()).filter(Boolean);
    let body=$("#skillBody").value.trim();
    const method=$("#skillMethod").value;
    if(!body&&names.length&&["POST","PUT","PATCH"].includes(method))body=JSON.stringify(Object.fromEntries(names.map(n=>[n,"{{"+n+"}}"])),null,2);
    await req("/skills",{method:"POST",body:JSON.stringify({name:$("#skillName").value,description:$("#skillDescription").value,url:$("#skillUrl").value,method:method,headers:$("#skillHeaders").value,body:body})});
    e.target.reset();$("#skillMethod").value="GET";$("#globalStatus").textContent="스킬이 등록되었습니다. 채팅에서 /skill 이름 {…}으로 실행할 수 있습니다.";loadSkills();
  }catch(err){alert(err.message)}
};
$("#attachButton").onclick=()=>$("#fileInput").click();
$("#fileInput").onchange=e=>{addFiles(e.target.files);e.target.value=""};
if($("#chartButton"))$("#chartButton").onclick=()=>{const input=$("#input");if(!input.value.trim())input.value="아래 숫자 데이터를 적절한 차트/그래프로 시각화해줘.\n\n";input.focus();input.dispatchEvent(new Event("input"));};
$("#form").onsubmit=e=>{e.preventDefault();ask($("#input").value)};
$("#input").onkeydown=e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();ask(e.target.value)}};
$("#input").oninput=e=>{e.target.style.height="auto";e.target.style.height=Math.min(e.target.scrollHeight,160)+"px"};
$("#newChat").onclick=()=>newChat();$("#mobileNew").onclick=()=>newChat();$("#mobileMenu").onclick=()=>$("#sidebar").classList.toggle("open");
$("#newFolder").onclick=createConversationFolder;
let historySearchTimer=null;

function closeSidebar(){$("#sidebar").classList.remove("open")}
$("#chat").onclick=closeSidebar;
const mq=matchMedia("(prefers-color-scheme:dark)");if(mq.addEventListener)mq.addEventListener("change",()=>{if(settings.theme==="system")applyTheme()});
renderAuth();boot();if(window.lucide)lucide.createIcons();

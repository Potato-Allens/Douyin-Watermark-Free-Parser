const SITE_TITLE = "抖音视频解析";
const SITE_SUBTITLE = "复制抖音分享链接，自动识别、解析、预览并下载无水印视频";

export function renderHomePage(): string {
  return String.raw`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
  <meta name="theme-color" content="#050505" />
  <title>${SITE_TITLE}</title>
  <style>
    :root{color-scheme:dark;--bg:#050505;--card:#111114;--line:rgba(255,255,255,.1);--text:#fff;--muted:rgba(255,255,255,.62);--cyan:#25f4ee;--pink:#fe2c55;--green:#6cf3a1;--radius:24px;--shadow:0 24px 80px rgba(0,0,0,.55)}
    *{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at 18% 12%,rgba(37,244,238,.16),transparent 34%),radial-gradient(circle at 84% 16%,rgba(254,44,85,.16),transparent 32%),var(--bg);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;color:var(--text);overflow-x:hidden}body:before{content:"";position:fixed;inset:0;background:linear-gradient(90deg,rgba(255,255,255,.025) 1px,transparent 1px),linear-gradient(0deg,rgba(255,255,255,.02) 1px,transparent 1px);background-size:48px 48px;mask-image:linear-gradient(#000,transparent 80%);pointer-events:none}
    .page{width:min(1440px,100%);margin:0 auto;padding:28px 24px 44px}.topbar{display:flex;align-items:center;justify-content:space-between;gap:18px;margin-bottom:28px}.brand{display:flex;align-items:center;gap:14px}.logo{width:46px;height:46px;border-radius:16px;background:linear-gradient(135deg,var(--cyan),var(--pink));box-shadow:6px 0 0 rgba(254,44,85,.55),-6px 0 0 rgba(37,244,238,.45);display:grid;place-items:center;font-weight:900;font-size:25px}.title h1{font-size:28px;line-height:1.1;margin:0;letter-spacing:.04em}.title p{margin:6px 0 0;color:var(--muted);font-size:14px}.online{display:flex;align-items:center;gap:10px;background:rgba(255,255,255,.07);border:1px solid var(--line);padding:12px 16px;border-radius:999px;box-shadow:var(--shadow)}.dot{width:9px;height:9px;border-radius:99px;background:var(--green);box-shadow:0 0 18px var(--green)}
    .grid{display:grid;grid-template-columns:minmax(270px,350px) minmax(320px,480px) minmax(300px,370px);gap:22px;align-items:start}.panel{background:linear-gradient(180deg,rgba(255,255,255,.075),rgba(255,255,255,.035));border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);backdrop-filter:blur(18px)}.panel-pad{padding:20px}.section-title{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}.section-title h2{margin:0;font-size:17px}.tag{font-size:12px;color:#0b0b0d;background:linear-gradient(135deg,var(--cyan),#fff);border-radius:999px;padding:5px 10px;font-weight:800}.input{width:100%;min-height:142px;resize:vertical;border:1px solid rgba(255,255,255,.14);outline:0;border-radius:18px;background:#08080a;color:#fff;padding:16px;font-size:15px;line-height:1.55;box-shadow:inset 0 0 0 1px rgba(0,0,0,.5)}.input:focus{border-color:rgba(37,244,238,.75);box-shadow:0 0 0 4px rgba(37,244,238,.08)}.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.btn{border:0;border-radius:999px;padding:12px 16px;background:#fff;color:#08080a;font-weight:800;cursor:pointer;transition:.18s transform,.18s opacity;text-decoration:none;display:inline-flex;align-items:center;justify-content:center;gap:8px}.btn:hover{transform:translateY(-1px)}.btn:disabled{opacity:.45;cursor:not-allowed;transform:none}.btn-primary{background:linear-gradient(135deg,var(--cyan),var(--pink));color:#fff}.btn-ghost{background:rgba(255,255,255,.08);color:#fff;border:1px solid var(--line)}.btn-wide{width:100%;margin-top:12px}.toggle{display:flex;align-items:center;gap:8px;color:var(--muted);font-size:13px;margin-top:12px}.toggle input{accent-color:var(--pink)}.status{margin-top:14px;min-height:22px;color:var(--muted);font-size:13px}.status.ok{color:var(--green)}.status.err{color:var(--pink)}
    .phone{position:relative;aspect-ratio:9/16;background:#000;border-radius:34px;overflow:hidden;border:1px solid rgba(255,255,255,.15);box-shadow:0 0 0 10px rgba(255,255,255,.035),var(--shadow)}.phone video{width:100%;height:100%;object-fit:contain;background:#000}.empty{position:absolute;inset:0;display:grid;place-items:center;text-align:center;padding:36px;background:radial-gradient(circle at 50% 20%,rgba(254,44,85,.16),transparent 38%),#070708}.empty.hidden{display:none}.empty strong{display:block;font-size:28px;margin-bottom:10px;text-shadow:4px 0 0 rgba(254,44,85,.55),-4px 0 0 rgba(37,244,238,.45)}.empty span{color:var(--muted);line-height:1.7}.floatbar{position:absolute;left:16px;right:16px;bottom:16px;border:1px solid var(--line);border-radius:20px;background:rgba(0,0,0,.55);padding:14px;backdrop-filter:blur(12px)}.video-title{font-weight:800;line-height:1.45}.video-author{color:var(--muted);font-size:13px;margin-top:6px}.stats{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}.stat{background:#0a0a0d;border:1px solid var(--line);border-radius:18px;padding:14px}.stat b{display:block;font-size:20px}.stat span{display:block;color:var(--muted);font-size:12px;margin-top:4px}.meta{display:grid;gap:12px;margin-top:14px}.meta-item{border:1px solid var(--line);border-radius:18px;background:rgba(0,0,0,.26);padding:13px}.meta-item small{display:block;color:var(--muted);margin-bottom:6px}.cover{width:100%;max-height:180px;object-fit:cover;border-radius:16px;border:1px solid var(--line);background:#09090b}.mono{font-family:"SFMono-Regular",Consolas,monospace;font-size:12px;word-break:break-all;color:rgba(255,255,255,.72)}
    .batch{margin-top:22px;display:grid;grid-template-columns:minmax(300px,1fr) minmax(300px,1.2fr);gap:22px}.small-input{width:100%;height:46px;border:1px solid rgba(255,255,255,.14);outline:0;border-radius:999px;background:#08080a;color:#fff;padding:0 16px}.small-input:focus{border-color:rgba(254,44,85,.75)}.batch-list{display:grid;gap:10px;max-height:420px;overflow:auto;padding-right:4px}.batch-item{display:grid;grid-template-columns:54px 1fr auto;gap:12px;align-items:center;border:1px solid var(--line);border-radius:18px;background:#0a0a0d;padding:10px}.thumb{width:54px;height:72px;object-fit:cover;border-radius:12px;background:#111}.pill{font-size:12px;border-radius:999px;padding:5px 9px;background:rgba(255,255,255,.08);color:var(--muted)}.pill.success{color:#07120c;background:var(--green)}.pill.failed{color:#fff;background:var(--pink)}.pill.running{color:#090909;background:var(--cyan)}.vip-box{border:1px solid rgba(254,44,85,.35);background:linear-gradient(135deg,rgba(254,44,85,.12),rgba(37,244,238,.08));border-radius:20px;padding:14px;margin-top:14px}.hint{color:var(--muted);font-size:13px;line-height:1.6}.hidden{display:none!important}
    @media (max-width:1100px){.grid{grid-template-columns:1fr;max-width:560px;margin:0 auto}.batch{grid-template-columns:1fr;max-width:560px;margin-left:auto;margin-right:auto}.topbar{align-items:flex-start;flex-direction:column}.phone{max-height:78vh}}
  </style>
</head>
<body>
  <main class="page">
    <header class="topbar">
      <div class="brand"><div class="logo">♪</div><div class="title"><h1>${SITE_TITLE}</h1><p>${SITE_SUBTITLE}</p></div></div>
      <div class="online"><i class="dot"></i><span>当前在线 <b id="onlineCount">--</b> 人</span></div>
    </header>

    <section class="grid">
      <aside class="panel panel-pad">
        <div class="section-title"><h2>粘贴分享链接</h2><span class="tag">自动识别</span></div>
        <textarea id="linkInput" class="input" placeholder="把抖音分享文本或链接粘贴到这里，例如：https://v.douyin.com/xxxx/"></textarea>
        <button id="parseBtn" class="btn btn-primary btn-wide">立即解析</button>
        <div class="row" style="margin-top:12px"><button id="clipboardBtn" class="btn btn-ghost" type="button">启用剪贴板识别</button><button id="clearBtn" class="btn btn-ghost" type="button">清空</button></div>
        <label class="toggle"><input id="autoDownload" type="checkbox" checked /> 解析成功后自动下载视频</label>
        <div id="status" class="status">等待链接输入。</div>
        <div class="vip-box">
          <div class="section-title" style="margin-bottom:10px"><h2>会员激活</h2><span id="vipState" class="pill">未激活</span></div>
          <div class="row"><input id="vipCode" class="small-input" style="flex:1;min-width:160px" placeholder="输入激活码" /><button id="vipBtn" class="btn btn-primary" type="button">激活</button></div>
          <p class="hint">批量主页解析和批量下载需要会员激活；单条视频解析无需激活。</p>
        </div>
      </aside>

      <section class="phone">
        <video id="video" controls playsinline preload="metadata"></video>
        <div id="empty" class="empty"><div><strong>复制即解析</strong><span>识别到抖音视频链接后，会在这里自动生成预览和下载地址。</span></div></div>
        <div class="floatbar"><div id="videoTitle" class="video-title">还没有解析内容</div><div id="videoAuthor" class="video-author">标题、介绍、音乐和封面会自动展示</div></div>
      </section>

      <aside class="panel panel-pad">
        <div class="section-title"><h2>作品信息</h2><span id="mediaType" class="pill">待解析</span></div>
        <div class="stats">
          <div class="stat"><b id="digg">--</b><span>点赞</span></div><div class="stat"><b id="comment">--</b><span>评论</span></div>
          <div class="stat"><b id="share">--</b><span>转发</span></div><div class="stat"><b id="collect">--</b><span>收藏</span></div>
        </div>
        <div class="meta">
          <img id="cover" class="cover hidden" alt="视频封面" />
          <div class="meta-item"><small>标题 / 介绍</small><div id="desc">--</div></div>
          <div class="meta-item"><small>背景音乐</small><div id="music">--</div></div>
          <div class="meta-item"><small>下载地址</small><div id="downloadUrl" class="mono">--</div></div>
        </div>
        <a id="downloadBtn" class="btn btn-primary btn-wide" href="#" download>下载视频</a>
      </aside>
    </section>

    <section class="batch">
      <div class="panel panel-pad">
        <div class="section-title"><h2>会员批量解析</h2><span class="tag">主页作品</span></div>
        <input id="profileInput" class="small-input" placeholder="粘贴对方主页链接：https://www.douyin.com/user/..." />
        <div class="row" style="margin-top:12px"><button id="inspectBtn" class="btn btn-ghost" type="button">获取作品数量</button><input id="batchCount" class="small-input" style="width:110px" type="number" min="1" value="5" /><input id="batchConcurrency" class="small-input" style="width:110px" type="number" min="1" max="5" value="3" /></div>
        <button id="startBatchBtn" class="btn btn-primary btn-wide" type="button">开始并发解析下载</button>
        <div id="batchStatus" class="status">激活会员后可用。</div>
      </div>
      <div class="panel panel-pad">
        <div class="section-title"><h2>批量结果</h2><span id="batchSummary" class="pill">0/0</span></div>
        <div id="batchList" class="batch-list"><p class="hint">批量解析结果会显示在这里，每条成功结果都会生成下载链接。</p></div>
      </div>
    </section>
  </main>

  <script>
    const $ = (id) => document.getElementById(id);
    const state = { lastUrl: "", lastDownloaded: "", clipboardWatch: false, vipToken: localStorage.getItem("vip_token") || "", pollTimer: 0 };
    const els = { input:$("linkInput"), parseBtn:$("parseBtn"), clipboardBtn:$("clipboardBtn"), clearBtn:$("clearBtn"), autoDownload:$("autoDownload"), status:$("status"), video:$("video"), empty:$("empty"), videoTitle:$("videoTitle"), videoAuthor:$("videoAuthor"), mediaType:$("mediaType"), digg:$("digg"), comment:$("comment"), share:$("share"), collect:$("collect"), desc:$("desc"), music:$("music"), cover:$("cover"), downloadUrl:$("downloadUrl"), downloadBtn:$("downloadBtn"), onlineCount:$("onlineCount"), vipCode:$("vipCode"), vipBtn:$("vipBtn"), vipState:$("vipState"), profileInput:$("profileInput"), inspectBtn:$("inspectBtn"), batchCount:$("batchCount"), batchConcurrency:$("batchConcurrency"), startBatchBtn:$("startBatchBtn"), batchStatus:$("batchStatus"), batchList:$("batchList"), batchSummary:$("batchSummary") };
    function extractDouyinUrl(text){ const m=String(text||"").match(/https?:\/\/[^\s"'<>，。！？；、]+/i); if(!m)return""; try{const u=new URL(m[0]);const h=u.hostname.toLowerCase();return (h.endsWith("douyin.com")||h.endsWith("iesdouyin.com")||h.endsWith("amemv.com"))?u.toString():"";}catch{return"";} }
    function fmt(n){ return n===null||n===undefined?"--":Number(n).toLocaleString("zh-CN"); }
    function setStatus(el,msg,type){ el.textContent=msg; el.className="status"+(type?" "+type:""); }
    function debounce(fn,ms){ let t; return function(){ clearTimeout(t); const a=arguments; t=setTimeout(function(){ fn.apply(null,a); },ms); }; }
    async function api(path, options){ options=options||{}; const headers=new Headers(options.headers||{}); if(options.body&&!headers.has("content-type"))headers.set("content-type","application/json"); if(state.vipToken)headers.set("authorization","Bearer "+state.vipToken); const res=await fetch(path,Object.assign({},options,{headers})); const json=await res.json().catch(function(){return null;}); if(!res.ok||!json||json.ok===false)throw new Error((json&&json.error&&json.error.detail)|| (json&&json.message) || ("HTTP "+res.status)); return json.data; }
    async function parseLink(raw, source){ const url=extractDouyinUrl(raw); if(!url){setStatus(els.status,"没有识别到抖音链接。","err");return;} if(source!=="manual"&&url===state.lastUrl)return; state.lastUrl=url; els.input.value=raw; setStatus(els.status,"正在解析，请稍候..."); els.parseBtn.disabled=true; try{const data=await api("/api/v1/parse?url="+encodeURIComponent(url)); renderResult(data); setStatus(els.status,"解析成功，已生成预览和下载地址。","ok"); if(els.autoDownload.checked&&data.download&&data.download.download_url)triggerDownload(data.download.download_url,data.download.filename||"douyin-video.mp4");}catch(err){setStatus(els.status,err.message||String(err),"err");}finally{els.parseBtn.disabled=false;} }
    function renderResult(data){ const videoUrl=(data.download&&data.download.video_proxy_url)||(data.media&&data.media.video_url)||""; els.mediaType.textContent=data.media&&data.media.type==="video"?"视频":data.media&&data.media.type==="image"?"图文":"未知"; els.videoTitle.textContent=(data.content&&data.content.desc)||"未解析到标题"; els.videoAuthor.textContent=data.author&&data.author.nickname?"@"+data.author.nickname:"作者信息未解析"; els.desc.textContent=(data.content&&data.content.desc)||(data.author&&data.author.signature)||"--"; els.music.textContent=[data.music&&data.music.title,data.music&&data.music.author].filter(Boolean).join(" · ")||"--"; els.digg.textContent=fmt(data.stats&&data.stats.digg_count); els.comment.textContent=fmt(data.stats&&data.stats.comment_count); els.share.textContent=fmt(data.stats&&data.stats.share_count); els.collect.textContent=fmt(data.stats&&data.stats.collect_count); if(data.media&&data.media.cover_url){els.cover.src=data.media.cover_url;els.cover.classList.remove("hidden");els.video.poster=data.media.cover_url;}else{els.cover.classList.add("hidden");els.video.removeAttribute("poster");} if(videoUrl){els.video.src=videoUrl;els.video.load();els.video.play().catch(function(){});els.empty.classList.add("hidden");} const dl=(data.download&&data.download.download_url)||(data.media&&data.media.video_url)||""; els.downloadUrl.textContent=dl||"--"; els.downloadBtn.href=dl||"#"; els.downloadBtn.download=(data.download&&data.download.filename)||"douyin-video.mp4"; }
    function triggerDownload(url,filename){ if(!url||state.lastDownloaded===url)return; state.lastDownloaded=url; const a=document.createElement("a"); a.href=url; a.download=filename; a.style.display="none"; document.body.appendChild(a); a.click(); a.remove(); }
    els.parseBtn.addEventListener("click",function(){parseLink(els.input.value,"manual");}); els.clearBtn.addEventListener("click",function(){els.input.value="";state.lastUrl="";setStatus(els.status,"已清空，等待链接输入。");}); els.input.addEventListener("input",debounce(function(){ if(extractDouyinUrl(els.input.value))parseLink(els.input.value,"input"); },650)); document.addEventListener("paste",function(event){const text=(event.clipboardData&&event.clipboardData.getData("text"))||""; if(extractDouyinUrl(text)){els.input.value=text;setTimeout(function(){parseLink(text,"paste");},30);}}); els.clipboardBtn.addEventListener("click",async function(){state.clipboardWatch=true;els.clipboardBtn.textContent="剪贴板识别中";await scanClipboard();}); async function scanClipboard(){if(!state.clipboardWatch||!navigator.clipboard||!navigator.clipboard.readText)return;try{const text=await navigator.clipboard.readText();if(extractDouyinUrl(text)){els.input.value=text;await parseLink(text,"clipboard");}}catch{}} window.addEventListener("focus",scanClipboard); setInterval(scanClipboard,4500);
    async function pingOnline(){ const client_id=localStorage.getItem("online_client_id")||(crypto.randomUUID?crypto.randomUUID():String(Date.now())+Math.random()); localStorage.setItem("online_client_id",client_id); try{const data=await api("/api/v1/online/ping",{method:"POST",body:JSON.stringify({client_id})}); els.onlineCount.textContent=data.online_count;}catch{} } setInterval(pingOnline,15000); pingOnline();
    async function refreshVip(){try{const data=await api("/api/v1/vip/status"); els.vipState.textContent=data.activated?"已激活":"未激活"; els.vipState.className="pill"+(data.activated?" success":"");}catch{}} els.vipBtn.addEventListener("click",async function(){try{const data=await api("/api/v1/vip/activate",{method:"POST",body:JSON.stringify({code:els.vipCode.value})}); state.vipToken=data.token; localStorage.setItem("vip_token",data.token); els.vipState.textContent="已激活"; els.vipState.className="pill success"; setStatus(els.batchStatus,"会员已激活，可以批量解析。","ok");}catch(err){setStatus(els.batchStatus,err.message||String(err),"err");}}); refreshVip();
    els.inspectBtn.addEventListener("click",async function(){try{setStatus(els.batchStatus,"正在获取主页作品数量..."); const data=await api("/api/v1/batch/inspect",{method:"POST",body:JSON.stringify({url:els.profileInput.value})}); els.batchCount.max=data.available_count||data.total_count||999; setStatus(els.batchStatus,"检测到作品总数 "+(data.total_count??"未知")+"，当前可直接读取 "+data.available_count+" 个。","ok");}catch(err){setStatus(els.batchStatus,err.message||String(err),"err");}});
    els.startBatchBtn.addEventListener("click",async function(){try{setStatus(els.batchStatus,"正在创建批量任务..."); const task=await api("/api/v1/batch/start",{method:"POST",body:JSON.stringify({url:els.profileInput.value,count:Number(els.batchCount.value),concurrency:Number(els.batchConcurrency.value)})}); renderBatch(task); pollBatch(task.id);}catch(err){setStatus(els.batchStatus,err.message||String(err),"err");}});
    async function pollBatch(id){clearTimeout(state.pollTimer);try{const task=await api("/api/v1/batch/"+encodeURIComponent(id)); renderBatch(task); if(task.status==="queued"||task.status==="running")state.pollTimer=setTimeout(function(){pollBatch(id);},1500);}catch(err){setStatus(els.batchStatus,err.message||String(err),"err");}}
    function renderBatch(task){els.batchSummary.textContent=task.completed_count+"/"+task.requested_count; setStatus(els.batchStatus,"任务 "+task.status+"：成功 "+task.success_count+"，失败 "+task.failed_count+"。",task.status==="failed"?"err":"ok"); els.batchList.innerHTML=task.items.map(function(item){return '<div class="batch-item"><img class="thumb" src="'+esc(item.cover_url||"")+'" alt=""><div><b>'+esc(item.title||item.aweme_id)+'</b><div class="mono">'+esc(item.aweme_id)+'</div></div>'+(item.download_url?'<a class="pill success" href="'+esc(item.download_url)+'" download>下载</a>':'<span class="pill '+esc(item.status)+'">'+esc(item.status)+'</span>')+'</div>';}).join("")||'<p class="hint">暂无结果。</p>'; }
    function esc(v){return String(v||"").replace(/[&<>"']/g,function(m){return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[m];});}
  </script>
</body>
</html>`;
}

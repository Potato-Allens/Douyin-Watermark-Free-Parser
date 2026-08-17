export function renderAdminPage(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
  <meta name="theme-color" content="#050506" />
  <title>抖映灵感台 Admin</title>
  <link rel="icon" href="/favicon.svg" />
  <style>
    :root{color-scheme:dark;--bg:#050506;--panel:#111114;--soft:#19191e;--line:rgba(255,255,255,.10);--text:#f6f6f7;--muted:#9b9ba5;--cyan:#25f4ee;--pink:#fe2c55;--green:#56f39a;--yellow:#ffd166}
    *{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 12% 0,rgba(37,244,238,.12),transparent 28%),radial-gradient(circle at 90% 4%,rgba(254,44,85,.18),transparent 30%),#050506;color:var(--text);font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}.page{max-width:1200px;margin:0 auto;padding:28px 16px 48px}.header{display:flex;justify-content:space-between;gap:14px;align-items:center;margin-bottom:18px}.brand{display:flex;gap:12px;align-items:center}.logo{width:44px;height:44px;border-radius:14px;display:grid;place-items:center;background:linear-gradient(135deg,var(--cyan),var(--pink));font-weight:950;font-size:22px;box-shadow:4px 0 0 rgba(254,44,85,.42),-4px 0 0 rgba(37,244,238,.34)}h1{margin:0;font-size:26px}.sub{margin:4px 0 0;color:var(--muted);font-size:13px;line-height:1.5}.grid{display:grid;grid-template-columns:360px 1fr;gap:16px}.stack{display:grid;gap:16px}.card{background:linear-gradient(180deg,rgba(255,255,255,.075),rgba(255,255,255,.035));border:1px solid var(--line);border-radius:24px;padding:18px;box-shadow:0 20px 70px rgba(0,0,0,.35)}h2{margin:0 0 14px;font-size:18px}h3{margin:8px 0 10px;font-size:15px}.field{display:grid;gap:7px;margin:10px 0}.field span{font-size:12px;color:var(--muted)}input,select,textarea{width:100%;border:1px solid var(--line);border-radius:14px;background:#08080a;color:var(--text);padding:12px 13px;outline:none}textarea{min-height:92px;resize:vertical}.row{display:grid;grid-template-columns:1fr 1fr;gap:10px}.three{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.btn{border:0;border-radius:999px;background:#26262b;color:#fff;padding:12px 15px;font-weight:850;cursor:pointer}.primary{background:linear-gradient(90deg,var(--cyan),var(--pink));color:#fff}.ok{color:var(--green)}.err{color:var(--pink)}.muted{color:var(--muted)}.status{min-height:22px;font-size:13px;margin-top:10px;line-height:1.6}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.metric{background:#08080a;border:1px solid var(--line);border-radius:18px;padding:14px}.metric b{display:block;font-size:22px}.metric span{font-size:12px;color:var(--muted)}.table{display:grid;gap:8px;max-height:320px;overflow:auto}.item{display:grid;grid-template-columns:1fr auto;gap:10px;background:#08080a;border:1px solid var(--line);border-radius:16px;padding:12px;min-width:0}.item b{word-break:break-all}.pill{border-radius:999px;background:rgba(37,244,238,.12);color:var(--cyan);padding:5px 9px;font-size:12px;white-space:nowrap}.tools{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0 0}.small{font-size:12px;color:var(--muted);line-height:1.55}@media(max-width:900px){.grid{grid-template-columns:1fr}.metrics,.three{grid-template-columns:repeat(2,1fr)}.header{align-items:flex-start;flex-direction:column}.row{grid-template-columns:1fr}}@media(max-width:560px){.page{padding:18px 12px 34px}.metrics,.three{grid-template-columns:1fr}.card{border-radius:20px;padding:15px}}
  </style>
</head>
<body>
  <main class="page">
    <header class="header">
      <div class="brand"><div class="logo">♪</div><div><h1>抖映灵感台后台</h1><p class="sub">管理模型配置、会员套餐、激活码、接口限流、调用指标和安全审计。</p></div></div>
      <a class="btn" href="/">返回前台</a>
    </header>
    <section class="grid">
      <aside class="card">
        <h2>管理员登录</h2>
        <div class="field"><span>账号</span><input id="adminUser" autocomplete="username" value="admin" /></div>
        <div class="field"><span>密码</span><input id="adminPass" type="password" autocomplete="current-password" /></div>
        <div class="field"><span>Google Authenticator 六位码</span><input id="adminTotp" inputmode="numeric" maxlength="6" placeholder="启用后必填" /></div>
        <button id="loginBtn" class="btn primary">登录后台</button>
        <div id="loginStatus" class="status muted">登录后可管理配置和查看审计。</div>
        <div class="tools"><button id="reloadBtn" class="btn" type="button">刷新数据</button><button id="logoutBtn" class="btn" type="button">清除本地令牌</button></div>
        <p class="small">连续登录失败会触发锁定，并写入安全审计。</p>
      </aside>
      <section class="stack">
        <div class="card">
          <h2>接口调用与在线状态</h2>
          <div class="metrics"><div class="metric"><b id="mUsage">--</b><span>总调用</span></div><div class="metric"><b id="mAi">--</b><span>AI 调用</span></div><div class="metric"><b id="mBlocked">--</b><span>限流拦截</span></div><div class="metric"><b id="mOnline">--</b><span>当前在线</span></div></div>
        </div>
        <div class="card">
          <h2>接口限流</h2>
          <div class="three"><div class="field"><span>解析 / 分钟 / IP</span><input id="parseLimit" type="number" min="1" value="60" /></div><div class="field"><span>媒体代理 / 分钟 / IP</span><input id="mediaLimit" type="number" min="1" value="120" /></div><div class="field"><span>批量任务 / 小时 / 用户</span><input id="batchLimit" type="number" min="1" value="30" /></div></div>
          <div class="row"><div class="field"><span>AI 调用 / 天 / 用户</span><input id="aiLimit" type="number" min="1" value="1000" /></div><div class="field"><span>评论采集 / 天 / 用户</span><input id="commentsLimit" type="number" min="1" value="200" /></div></div>
          <button id="saveRateBtn" class="btn primary">保存限流配置</button>
          <div id="rateStatus" class="status muted">限流用于防止接口和大模型额度被刷。</div>
        </div>
        <div class="card">
          <h2>最近调用与安全审计</h2>
          <p class="muted">展示解析、AI、评论、限流拦截、后台登录、套餐和激活码操作。</p>
          <div class="row"><div><h3>接口调用</h3><div class="table" id="usageList"></div></div><div><h3>安全审计</h3><div class="table" id="auditList"></div></div></div>
        </div>
        <div class="card">
          <h2>小米大模型配置</h2>
          <div class="row"><div class="field"><span>Base URL</span><input id="llmBase" value="https://token-plan-cn.xiaomimimo.com/v1" /></div><div class="field"><span>模型名</span><input id="llmModel" placeholder="例如 xiaomi-xxx" /></div></div>
          <div class="row"><div class="field"><span>API Key</span><input id="llmKey" type="password" placeholder="留空表示不覆盖已保存 key" /></div><div class="field"><span>启用</span><select id="llmEnabled"><option value="true">启用</option><option value="false">停用</option></select></div></div>
          <div class="row"><button id="testLlmBtn" class="btn">测试连接</button><button id="saveLlmBtn" class="btn primary">保存配置</button></div>
          <div id="llmStatus" class="status muted">未读取配置。</div>
        </div>
        <div class="card">
          <h2>会员套餐权益</h2>
          <div class="table" id="plansList"></div>
          <div class="row"><div class="field"><span>套餐 ID</span><input id="planId" placeholder="standard" /></div><div class="field"><span>名称</span><input id="planName" placeholder="标准版" /></div></div>
          <div class="row"><div class="field"><span>批量解析上限</span><input id="planBatch" type="number" value="50" /></div><div class="field"><span>AI 日额度</span><input id="planAi" type="number" value="200" /></div></div>
          <div class="row"><div class="field"><span>并发</span><input id="planConcurrency" type="number" value="2" /></div><div class="field"><span>队列优先级</span><input id="planPriority" type="number" value="40" /></div></div>
          <button id="savePlanBtn" class="btn primary">保存套餐</button><div id="planStatus" class="status muted"></div>
        </div>
        <div class="card">
          <h2>激活码</h2>
          <div class="row"><div class="field"><span>激活码</span><input id="codeValue" placeholder="PRO-2026-001" /></div><div class="field"><span>绑定套餐 ID</span><input id="codePlan" value="standard" /></div></div>
          <div class="row"><div class="field"><span>可用次数</span><input id="codeUses" type="number" value="1" /></div><div class="field"><span>过期时间 ISO（可空）</span><input id="codeExpires" placeholder="2026-12-31T23:59:59+08:00" /></div></div>
          <button id="createCodeBtn" class="btn primary">生成 / 更新激活码</button><div id="codeStatus" class="status muted"></div><div class="table" id="codesList"></div>
        </div>
      </section>
    </section>
  </main>
  <script>
    const $=(id)=>document.getElementById(id);let token=localStorage.getItem('admin_token')||'';
    function set(el,msg,cls){el.textContent=msg;el.className='status '+(cls||'muted')}
    async function api(path,opt){opt=opt||{};const h=new Headers(opt.headers||{});if(opt.body&&!h.has('content-type'))h.set('content-type','application/json');if(token)h.set('authorization','Bearer '+token);const r=await fetch(path,Object.assign({},opt,{headers:h}));const j=await r.json().catch(()=>null);if(!r.ok||!j||j.ok===false)throw new Error((j&&j.error&&j.error.detail)||(j&&j.message)||('HTTP '+r.status));return j.data}
    async function login(){try{const data=await api('/api/admin/login',{method:'POST',body:JSON.stringify({username:$('adminUser').value,password:$('adminPass').value,totp:$('adminTotp').value})});token=data.token;localStorage.setItem('admin_token',token);set($('loginStatus'),'登录成功，已写入安全审计。','ok');loadAll()}catch(e){set($('loginStatus'),e.message,'err')}}
    async function loadAll(){await Promise.allSettled([loadMetrics(),loadRateLimits(),loadLogs(),loadLlm(),loadPlans(),loadCodes()])}
    async function loadMetrics(){const d=await api('/api/admin/metrics');$('mUsage').textContent=d.usage_total??0;$('mAi').textContent=d.ai_calls??0;$('mBlocked').textContent=d.blocked_calls??0;$('mOnline').textContent=d.online&&d.online.online_count!==undefined?d.online.online_count:'--'}
    async function loadRateLimits(){const d=await api('/api/admin/rate-limits');$('parseLimit').value=d.parse_per_minute;$('mediaLimit').value=d.media_per_minute;$('batchLimit').value=d.batch_per_hour;$('aiLimit').value=d.ai_per_day;$('commentsLimit').value=d.comments_per_day;set($('rateStatus'),'已读取限流配置'+(d.updated_at?'，更新时间 '+d.updated_at:'。'),'ok')}
    async function saveRateLimits(){try{const body={parse_per_minute:Number($('parseLimit').value),media_per_minute:Number($('mediaLimit').value),batch_per_hour:Number($('batchLimit').value),ai_per_day:Number($('aiLimit').value),comments_per_day:Number($('commentsLimit').value)};await api('/api/admin/rate-limits',{method:'POST',body:JSON.stringify(body)});set($('rateStatus'),'限流配置已保存。','ok');loadLogs()}catch(e){set($('rateStatus'),e.message,'err')}}
    async function loadLogs(){const usage=await api('/api/admin/usage?limit=12');const audit=await api('/api/admin/audit-logs?limit=12');$('usageList').innerHTML=usage.map(u=>'<div class="item"><div><b>'+esc(u.kind)+' · '+esc(u.status)+'</b><div class="muted">'+esc(u.path)+' · '+esc(u.user_key)+' · '+esc(u.created_at_iso)+'</div><div class="muted">'+esc(u.detail||'')+'</div></div></div>').join('')||'<p class="muted">暂无调用日志。</p>';$('auditList').innerHTML=audit.map(a=>'<div class="item"><div><b>'+esc(a.action)+'</b><div class="muted">'+esc(a.actor)+' · '+esc(a.ip)+' · '+esc(a.created_at_iso)+'</div><div class="muted">'+esc(a.detail||'')+'</div></div></div>').join('')||'<p class="muted">暂无审计日志。</p>'}
    async function loadLlm(){const d=await api('/api/admin/settings/llm');$('llmBase').value=d.base_url||'';$('llmModel').value=d.model||'';$('llmEnabled').value=String(!!d.enabled);set($('llmStatus'),'已读取配置，Key：'+(d.api_key_masked||'未保存'),'ok')}
    async function saveLlm(test){try{const body={base_url:$('llmBase').value,api_key:$('llmKey').value,model:$('llmModel').value,enabled:$('llmEnabled').value==='true'};const d=await api(test?'/api/admin/settings/llm/test':'/api/admin/settings/llm',{method:'POST',body:JSON.stringify(body)});set($('llmStatus'),test?('连接成功，延迟 '+d.latency_ms+'ms'):'配置已保存。','ok');if(!test)$('llmKey').value=''}catch(e){set($('llmStatus'),e.message,'err')}}
    async function loadPlans(){const list=await api('/api/admin/plans');$('plansList').innerHTML=list.map(p=>'<div class="item"><div><b>'+esc(p.name)+' / '+esc(p.id)+'</b><div class="muted">批量 '+p.batch_parse_limit+' · AI '+p.ai_daily_quota+'/日 · 并发 '+p.concurrency+' · 优先级 '+p.queue_priority+'</div></div><button class="pill" data-plan="'+esc(p.id)+'">编辑</button></div>').join('');document.querySelectorAll('[data-plan]').forEach(btn=>btn.onclick=()=>{const p=list.find(x=>x.id===btn.dataset.plan);if(!p)return;$('planId').value=p.id;$('planName').value=p.name;$('planBatch').value=p.batch_parse_limit;$('planAi').value=p.ai_daily_quota;$('planConcurrency').value=p.concurrency;$('planPriority').value=p.queue_priority})}
    async function savePlan(){try{await api('/api/admin/plans',{method:'POST',body:JSON.stringify({id:$('planId').value,name:$('planName').value,batch_parse_limit:Number($('planBatch').value),batch_ai_limit:Number($('planAi').value),ai_daily_quota:Number($('planAi').value),concurrency:Number($('planConcurrency').value),queue_priority:Number($('planPriority').value),comment_export:true,cover_batch_download:true})});set($('planStatus'),'套餐已保存。','ok');loadPlans()}catch(e){set($('planStatus'),e.message,'err')}}
    async function loadCodes(){const list=await api('/api/admin/codes?limit=60');$('codesList').innerHTML=list.map(c=>'<div class="item"><div><b>'+esc(c.code)+'</b><div class="muted">'+esc(c.plan_id)+' · '+esc(c.status)+' · '+c.used_count+'/'+c.max_uses+(c.expires_at?' · '+new Date(c.expires_at).toLocaleString():'')+'</div></div><span class="pill">激活码</span></div>').join('')||'<div class="muted">暂无激活码</div>'}
    async function createCode(){try{await api('/api/admin/codes',{method:'POST',body:JSON.stringify({code:$('codeValue').value,plan_id:$('codePlan').value,max_uses:Number($('codeUses').value),expires_at:$('codeExpires').value||null})});set($('codeStatus'),'激活码已保存。','ok');loadCodes()}catch(e){set($('codeStatus'),e.message,'err')}}
    function esc(v){return String(v||'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
    $('loginBtn').onclick=login;$('reloadBtn').onclick=loadAll;$('logoutBtn').onclick=()=>{token='';localStorage.removeItem('admin_token');set($('loginStatus'),'已清除本地令牌。')};$('testLlmBtn').onclick=()=>saveLlm(true);$('saveLlmBtn').onclick=()=>saveLlm(false);$('saveRateBtn').onclick=saveRateLimits;$('savePlanBtn').onclick=savePlan;$('createCodeBtn').onclick=createCode;if(token)loadAll();
  </script>
</body>
</html>`;
}

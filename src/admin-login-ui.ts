export function renderAdminLoginPage(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
  <meta name="theme-color" content="#050506" />
  <meta name="application-name" content="&#25238;&#26144;&#28789;&#24863;&#21488;" />
  <title>&#31649;&#29702;&#21592;&#30331;&#24405; - &#25238;&#26144;&#28789;&#24863;&#21488;</title>
  <link rel="icon" href="/favicon.svg" />
  <link rel="manifest" href="/site.webmanifest" />
  <link rel="apple-touch-icon" href="/apple-touch-icon.svg" />
  <style>
    :root{color-scheme:dark;--line:rgba(255,255,255,.11);--text:#f6f6f7;--muted:#9b9ba5;--cyan:#25f4ee;--pink:#fe2c55;--green:#56f39a}
    *{box-sizing:border-box}html,body{min-height:100%}body{margin:0;background:radial-gradient(circle at 14% 0,rgba(37,244,238,.13),transparent 30%),radial-gradient(circle at 88% 5%,rgba(254,44,85,.18),transparent 31%),#050506;color:var(--text);font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
    .page{min-height:100vh;display:grid;place-items:center;padding:28px 16px}.login-wrap{width:min(100%,520px)}.brand{display:flex;gap:12px;align-items:center;margin:0 0 18px}.logo{width:46px;height:46px;border-radius:14px;display:grid;place-items:center;background:linear-gradient(135deg,var(--cyan),var(--pink));font-weight:950;font-size:23px;box-shadow:4px 0 0 rgba(254,44,85,.35),-4px 0 0 rgba(37,244,238,.28)}h1{margin:0;font-size:25px}.sub{margin:4px 0 0;color:var(--muted);font-size:13px;line-height:1.55}
    .panel{border:1px solid var(--line);border-radius:22px;background:rgba(10,10,12,.88);box-shadow:0 30px 90px rgba(0,0,0,.48);overflow:hidden}.section{padding:24px}.section+.section{border-top:1px solid var(--line)}h2{margin:0 0 8px;font-size:20px}.hint{margin:0 0 18px;color:var(--muted);font-size:13px;line-height:1.65}.field{display:grid;gap:7px;margin:12px 0}.field span{font-size:12px;color:var(--muted)}input,textarea{width:100%;border:1px solid var(--line);border-radius:11px;background:#060608;color:var(--text);padding:13px 14px;outline:none;font:inherit}input:focus,textarea:focus{border-color:rgba(37,244,238,.62);box-shadow:0 0 0 3px rgba(37,244,238,.08)}textarea{min-height:86px;resize:vertical}.btn{width:100%;border:0;border-radius:11px;background:#28282d;color:#fff;padding:13px 16px;font:inherit;font-weight:850;cursor:pointer}.btn:disabled{cursor:wait;opacity:.58}.primary{background:linear-gradient(90deg,var(--cyan),var(--pink))}.status{min-height:22px;margin:11px 0 0;font-size:13px;line-height:1.55}.ok{color:var(--green)}.err{color:var(--pink)}.muted{color:var(--muted)}details summary{cursor:pointer;font-weight:800;list-style:none}details summary::-webkit-details-marker{display:none}details summary:after{content:"+";float:right;color:var(--cyan)}details[open] summary:after{content:"−"}.qr-box{min-height:252px;display:grid;place-items:center;margin-top:12px;border-radius:16px;background:#fff;color:#8a8a92;padding:12px;text-align:center;font-size:13px}.qr-box svg{display:block;width:228px;height:228px}.row{display:grid;grid-template-columns:1fr 1fr;gap:10px}.back{display:block;margin-top:14px;color:var(--muted);text-align:center;text-decoration:none;font-size:13px}.back:hover{color:#fff}
    @media(max-width:560px){.page{align-items:start;padding:18px 12px 30px}.section{padding:20px 16px}.row{grid-template-columns:1fr}.panel{border-radius:18px}.qr-box{min-height:232px}.brand{padding:0 4px}}
  </style>
</head>
<body>
  <main class="page">
    <div class="login-wrap">
      <header class="brand"><div class="logo">&#9834;</div><div><h1>&#31649;&#29702;&#21592;&#30331;&#24405;</h1><p class="sub">&#30331;&#24405;&#25104;&#21151;&#21518;&#25165;&#20250;&#36827;&#20837;&#21518;&#21488;&#24037;&#20316;&#21306;</p></div></header>
      <section class="panel" aria-label="&#31649;&#29702;&#21592;&#30331;&#24405;">
        <form id="loginForm" class="section">
          <h2>&#23433;&#20840;&#30331;&#24405;</h2>
          <p class="hint">&#36755;&#20837;&#31649;&#29702;&#21592;&#36134;&#21495;&#12289;&#23494;&#30721;&#21644; 6 &#20301;&#21160;&#24577;&#30721;&#12290;&#26410;&#21551;&#29992;&#21160;&#24577;&#30721;&#26102;&#21487;&#30041;&#31354;&#12290;</p>
          <label class="field"><span>&#36134;&#21495;</span><input id="adminUser" name="username" autocomplete="username" value="admin" required maxlength="80" /></label>
          <label class="field"><span>&#23494;&#30721;</span><input id="adminPass" name="password" type="password" autocomplete="current-password" required maxlength="256" /></label>
          <label class="field"><span>6 &#20301;&#21160;&#24577;&#30721;</span><input id="adminTotp" name="totp" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" placeholder="&#26410;&#21551;&#29992;&#21487;&#30041;&#31354;" /></label>
          <button id="loginBtn" class="btn primary" type="submit">&#30331;&#24405;&#21518;&#21488;</button>
          <div id="loginStatus" class="status muted" role="status">&#36830;&#32493;&#36755;&#38169;&#20250;&#35302;&#21457;&#20020;&#26102;&#38145;&#23450;&#12290;</div>
        </form>
        <details class="section" id="setupPanel">
          <summary>&#39318;&#27425;&#32465;&#23450;&#21160;&#24577;&#30721;</summary>
          <p class="hint">&#21482;&#22312;&#39318;&#27425;&#24320;&#21551;&#26102;&#20351;&#29992;&#65306;&#20808;&#22635;&#19978;&#26041;&#36134;&#21495;&#21644;&#23494;&#30721;&#65292;&#29983;&#25104;&#20108;&#32500;&#30721;&#21518;&#29992;&#35895;&#27468;&#36523;&#20221;&#39564;&#35777;&#22120;&#25195;&#25551;&#12290;</p>
          <div class="row"><button id="setupTotpBtn" class="btn" type="button">&#29983;&#25104;&#20108;&#32500;&#30721;</button><button id="enableTotpBtn" class="btn primary" type="button">&#39564;&#35777;&#24182;&#30331;&#24405;</button></div>
          <div id="totpQr" class="qr-box"><span>&#29983;&#25104;&#21518;&#65292;&#20108;&#32500;&#30721;&#20250;&#26174;&#31034;&#22312;&#36825;&#37324;</span></div>
          <label class="field"><span>&#23494;&#38053;&#22791;&#20221;</span><input id="totpSecret" readonly /></label>
          <label class="field"><span>&#32465;&#23450;&#38142;&#25509;&#22791;&#20221;</span><textarea id="totpUri" readonly></textarea></label>
          <div id="totpStatus" class="status muted" role="status">&#29983;&#25104;&#20108;&#32500;&#30721;&#21518;&#65292;&#25226;&#39564;&#35777;&#22120;&#26174;&#31034;&#30340; 6 &#20301;&#25968;&#23383;&#22635;&#20837;&#19978;&#26041;&#21160;&#24577;&#30721;&#26694;&#12290;</div>
        </details>
      </section>
      <a class="back" href="/">&#36820;&#22238;&#21069;&#21488;</a>
    </div>
  </main>
  <script>
    const $=(id)=>document.getElementById(id);let pendingSecret='';const DEFAULT_ISSUER='\u6296\u6620\u7075\u611f\u53f0';
    function set(el,message,type){el.textContent=message;el.className='status '+(type||'muted')}
    function friendly(message){const text=String(message||'\u8bf7\u6c42\u5931\u8d25');const rules=[[/admin credentials are invalid/i,'\u7ba1\u7406\u5458\u8d26\u53f7\u6216\u5bc6\u7801\u9519\u8bef'],[/admin password is not configured/i,'\u670d\u52a1\u5668\u672a\u914d\u7f6e\u7ba1\u7406\u5458\u5bc6\u7801'],[/admin totp code is invalid|totp code is invalid/i,'\u52a8\u6001\u7801\u9519\u8bef\uff0c\u8bf7\u8f93\u5165\u5f53\u524d 6 \u4f4d\u25968\u5b57'],[/totp is already bound/i,'\u52a8\u6001\u7801\u5df2\u7ed1\u5b9a\uff0c\u8bf7\u76f4\u63a5\u8f93\u5165 6 \u4f4d\u52a8\u6001\u7801\u767b\u5f55'],[/totp code is required/i,'\u52a8\u6001\u7801\u5df2\u542f\u7528\uff0c\u8bf7\u8f93\u5165\u5f53\u524d 6 \u4f4d\u52a8\u6001\u7801'],[/temporarily locked/i,'\u767b\u5f55\u5931\u8d25\u6b21\u6570\u8fc7\u591a\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5'],[/request body is too large/i,'\u8bf7\u6c42\u5185\u5bb9\u8fc7\u5927'],[/content-type/i,'\u8bf7\u6c42\u683c\u5f0f\u9519\u8bef']];for(const rule of rules){if(rule[0].test(text))return rule[1]}return /[\u4e00-\u9fff]/.test(text)?text:'\u8bf7\u6c42\u5904\u7406\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5'}
    async function api(path,body){const response=await fetch(path,{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const json=await response.json().catch(()=>({ok:false,message:'HTTP '+response.status}));if(!response.ok||json.ok===false)throw new Error(friendly((json.error&&json.error.detail)||json.message||json.code));return json.data}
    function credentials(){return{username:$('adminUser').value.trim(),password:$('adminPass').value,totp:$('adminTotp').value.trim()}}
    function busy(value){$('loginBtn').disabled=value;$('setupTotpBtn').disabled=value;$('enableTotpBtn').disabled=value}
    async function loadSetupState(){try{const response=await fetch('/api/admin/totp/bootstrap/status',{credentials:'same-origin'});const json=await response.json();if(response.ok&&json.data&&json.data.setup_available===false)$('setupPanel').hidden=true}catch{}}
    async function login(event){event.preventDefault();busy(true);try{await api('/api/admin/login',credentials());set($('loginStatus'),'\u767b\u5f55\u6210\u529f\uff0c\u6b63\u5728\u8fdb\u5165\u540e\u53f0\u2026','ok');window.location.replace('/admin')}catch(error){set($('loginStatus'),error.message,'err')}finally{busy(false)}}
    async function setupTotp(){busy(true);try{const auth=credentials();const data=await api('/api/admin/totp/bootstrap',{...auth,issuer:DEFAULT_ISSUER,account:auth.username||'admin'});pendingSecret=data.secret||'';$('totpSecret').value=data.secret||'';$('totpUri').value=data.otpauth_uri||'';$('totpQr').innerHTML=data.qr_svg||'<span>\u4e8c\u7ef4\u7801\u751f\u6210\u5931\u8d25</span>';set($('totpStatus'),'\u4e8c\u7ef4\u7801\u5df2\u751f\u6210\uff0c\u626b\u7801\u540e\u8f93\u5165 6 \u4f4d\u52a8\u6001\u7801\u3002','ok')}catch(error){set($('totpStatus'),error.message,'err')}finally{busy(false)}}
    async function enableTotp(){busy(true);try{const auth=credentials();await api('/api/admin/totp/bootstrap/verify',{...auth,secret:pendingSecret||$('totpSecret').value,code:auth.totp,issuer:DEFAULT_ISSUER,account:auth.username||'admin'});$('setupPanel').hidden=true;set($('loginStatus'),'\u52a8\u6001\u7801\u5df2\u7ed1\u5b9a\uff0c\u6b63\u5728\u8fdb\u5165\u540e\u53f0\u2026','ok');window.location.replace('/admin')}catch(error){set($('totpStatus'),error.message,'err')}finally{busy(false)}}
    $('loginForm').addEventListener('submit',login);$('setupTotpBtn').addEventListener('click',setupTotp);$('enableTotpBtn').addEventListener('click',enableTotp);loadSetupState();
  </script>
</body>
</html>`;
}

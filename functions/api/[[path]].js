const JSONBIN_ROOT = 'https://api.jsonbin.io/v3/b';

function cors(request){
  const origin = request.headers.get('Origin') || '*';
  return {'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials':'true','Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Allow-Methods':'GET,POST,PUT,DELETE,OPTIONS','Vary':'Origin'};
}
function json(data,status=200,request){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8',...cors(request)}})}
function b64u(bytes){let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}
function ub64(s){s=s.replace(/-/g,'+').replace(/_/g,'/');while(s.length%4)s+='=';return Uint8Array.from(atob(s),c=>c.charCodeAt(0))}
async function key(env){return crypto.subtle.importKey('raw',new TextEncoder().encode(env.SESSION_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign','verify'])}
async function signToken(payload,env){const body=b64u(new TextEncoder().encode(JSON.stringify(payload)));const sig=await crypto.subtle.sign('HMAC',await key(env),new TextEncoder().encode(body));return body+'.'+b64u(new Uint8Array(sig))}
async function verifyToken(token,env){try{const [body,sig]=token.split('.');if(!body||!sig)return null;const ok=await crypto.subtle.verify('HMAC',await key(env),ub64(sig),new TextEncoder().encode(body));if(!ok)return null;const p=JSON.parse(new TextDecoder().decode(ub64(body)));if(!p.exp||p.exp<Date.now())return null;return p}catch{return null}}
async function auth(request,env,roles=[]){const h=request.headers.get('Authorization')||'';const token=h.startsWith('Bearer ')?h.slice(7):'';const p=await verifyToken(token,env);if(!p|| (roles.length&&!roles.includes(p.role)))return null;return p}
async function binFetch(env,id,method='GET',body){
  if(!id||id==='COLOQUE_SEU_BIN_ID')throw new Error('Configure os BIN_IDs no Worker.');
  const r=await fetch(`${JSONBIN_ROOT}/${id}${method==='GET'?'/latest':''}`,{method,headers:{'Content-Type':'application/json','X-Master-Key':env.JSONBIN_MASTER_KEY,'X-Bin-Versioning':'false'},body:body?JSON.stringify(body):undefined});
  const text=await r.text();let data;try{data=JSON.parse(text)}catch{data={message:text}};if(!r.ok)throw new Error(data.message||`JSONBin ${r.status}`);return data.record??data;
}
async function getWines(env){
  const r=await binFetch(env,env.WINES_BIN_ID);
  return {
    version:1,
    wines:Array.isArray(r?.wines)?r.wines:[],
    categories:Array.isArray(r?.categories)?r.categories:[]
  };
}
async function putWines(env,record){
  return await binFetch(env,env.WINES_BIN_ID,'PUT',{
    version:1,
    wines:Array.isArray(record.wines)?record.wines:[],
    categories:Array.isArray(record.categories)?record.categories:[],
    updatedAt:new Date().toISOString()
  });
}
async function getUsers(env){const r=await binFetch(env,env.USERS_BIN_ID);return r&&typeof r==='object'?r:{favorites:{}}}
async function putUsers(env,record){return await binFetch(env,env.USERS_BIN_ID,'PUT',{...record,updatedAt:new Date().toISOString()})}

export async function onRequest(context){
  const {request,env,params}=context;
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors(request)});
  const path='/'+(params.path||[]).join('/');
  try{
    if(path==='/login'&&request.method==='POST'){
      const {username,password,role}=await request.json();
      const expectedUser=role==='admin'?env.ADMIN_USER:env.COLAB_USER;
      const expectedPass=role==='admin'?env.ADMIN_PASSWORD:env.COLAB_PASSWORD;
      if(!expectedUser||!expectedPass)return json({error:'Credenciais ainda não configuradas no Cloudflare.'},500,request);
      if(username!==expectedUser||password!==expectedPass)return json({error:'Usuário ou senha inválidos.'},401,request);
      const token=await signToken({sub:username,username,role,exp:Date.now()+1000*60*60*12},env);
      return json({token,username,role},200,request);
    }
    if(path==='/session'&&request.method==='GET'){
      const p=await auth(request,env);if(!p)return json({error:'Sessão inválida ou expirada.'},401,request);return json({username:p.username,role:p.role},200,request);
    }
    if(path==='/wines'&&request.method==='GET'){
      const r=await getWines(env);return json({wines:r.wines||[],categories:r.categories||[]},200,request);
    }
    if(path==='/wines'&&request.method==='PUT'){
      const p=await auth(request,env,['admin']);if(!p)return json({error:'Acesso restrito ao administrador.'},403,request);
      const body=await request.json();if(!Array.isArray(body.wines))return json({error:'Lista de vinhos inválida.'},400,request);
      const current=await getWines(env);
      const categories=Array.isArray(body.categories)?body.categories:current.categories||[];
      const r=await putWines(env,{wines:body.wines,categories});return json({wines:r.wines||body.wines,categories:r.categories||categories},200,request);
    }
    if(path==='/wines'&&request.method==='POST'){
      const p=await auth(request,env,['admin']);if(!p)return json({error:'Acesso restrito ao administrador.'},403,request);
      const body=await request.json();if(!body.wine?.name)return json({error:'Vinho inválido.'},400,request);
      const r=await getWines(env);let wines=Array.isArray(r.wines)?r.wines:[];const idx=wines.findIndex(x=>String(x.id)===String(body.wine.id));if(idx>=0)wines[idx]=body.wine;else wines.push(body.wine);
      const saved=await putWines(env,{wines,categories:r.categories||[]});return json({wines:saved.wines||wines,categories:saved.categories||r.categories||[]},200,request);
    }
    const wm=path.match(/^\/wines\/(.+)$/);
    if(wm&&request.method==='DELETE'){
      const p=await auth(request,env,['admin']);if(!p)return json({error:'Acesso restrito ao administrador.'},403,request);
      const id=decodeURIComponent(wm[1]);const r=await getWines(env);const wines=(r.wines||[]).filter(x=>String(x.id)!==String(id));const saved=await putWines(env,{wines,categories:r.categories||[]});return json({wines:saved.wines||wines,categories:saved.categories||r.categories||[]},200,request);
    }
    if(path==='/favorites'&&request.method==='GET'){
      const p=await auth(request,env);if(!p)return json({error:'Faça login para usar favoritos.'},401,request);const r=await getUsers(env);return json({favorites:Array.isArray(r.favorites?.[p.username])?r.favorites[p.username]:[]},200,request);
    }
    if(path==='/favorites'&&request.method==='PUT'){
      const p=await auth(request,env);if(!p)return json({error:'Faça login para usar favoritos.'},401,request);const body=await request.json();if(!Array.isArray(body.favorites))return json({error:'Favoritos inválidos.'},400,request);const r=await getUsers(env);const favorites={...(r.favorites||{}),[p.username]:body.favorites.map(Number)};await putUsers(env,{...r,favorites});return json({favorites:favorites[p.username]},200,request);
    }
    return json({error:'Rota não encontrada.'},404,request);
  }catch(e){console.error(e);return json({error:e.message||'Erro interno.'},500,request)}
}

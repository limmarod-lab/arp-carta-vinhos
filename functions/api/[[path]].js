const JSONBIN_ROOT='https://api.jsonbin.io/v3/b';
function cors(request,env){
  const origin=request.headers.get('Origin')||'';
  const allowed=env.ALLOWED_ORIGIN||origin||'*';
  return {'Access-Control-Allow-Origin':allowed,'Access-Control-Allow-Credentials':'true','Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Allow-Methods':'GET,POST,PUT,DELETE,OPTIONS','Vary':'Origin'};
}
function json(data,status=200,request,env){
  return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8',...cors(request,env)}});
}
function b64u(bytes){let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}
function ub64(s){s=s.replace(/-/g,'+').replace(/_/g,'/');while(s.length%4)s+='=';return Uint8Array.from(atob(s),c=>c.charCodeAt(0))}
async function key(env){return crypto.subtle.importKey('raw',new TextEncoder().encode(env.SESSION_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign','verify'])}
async function signToken(payload,env){
  const body=b64u(new TextEncoder().encode(JSON.stringify(payload)));
  const sig=await crypto.subtle.sign('HMAC',await key(env),new TextEncoder().encode(body));
  return body+'.'+b64u(new Uint8Array(sig));
}
async function verifyToken(token,env){
  try{
    const [body,sig]=token.split('.');
    if(!body||!sig)return null;
    const ok=await crypto.subtle.verify('HMAC',await key(env),ub64(sig),new TextEncoder().encode(body));
    if(!ok)return null;
    const p=JSON.parse(new TextDecoder().decode(ub64(body)));
    return p.exp&&p.exp>Date.now()?p:null;
  }catch{return null}
}
async function auth(request,env,roles=[]){
  const h=request.headers.get('Authorization')||'';
  const p=await verifyToken(h.startsWith('Bearer ')?h.slice(7):'',env);
  return p&&(!roles.length||roles.includes(p.role))?p:null;
}
async function binFetch(env,id,method='GET',body){
  if(!env.JSONBIN_MASTER_KEY)throw Error('Configure o secret JSONBIN_MASTER_KEY no Cloudflare.');
  if(!id)throw Error('Configure WINES_BIN_ID e USERS_BIN_ID no Cloudflare.');
  const r=await fetch(`${JSONBIN_ROOT}/${id}${method==='GET'?'/latest':''}`,{
    method,
    headers:{'Content-Type':'application/json','X-Master-Key':env.JSONBIN_MASTER_KEY,'X-Bin-Meta':'false','X-Bin-Versioning':'false'},
    body:body?JSON.stringify(body):undefined
  });
  const text=await r.text();
  let data;try{data=JSON.parse(text)}catch{data={message:text}}
  if(!r.ok)throw Error(data.message||data.error||`JSONBin ${r.status}`);
  return data.record??data;
}
function normalizeWines(r){
  if(Array.isArray(r))return{wines:r,categories:[],catMeta:{}};
  if(r&&Array.isArray(r.wines))return{wines:r.wines,categories:Array.isArray(r.categories)?r.categories:[],catMeta:r.catMeta&&typeof r.catMeta==='object'?r.catMeta:{}};
  if(r&&r.data&&Array.isArray(r.data.wines))return normalizeWines(r.data);
  return{wines:[],categories:[],catMeta:{}};
}
async function getWines(env){return normalizeWines(await binFetch(env,env.WINES_BIN_ID))}
async function putWines(env,record){
  const payload={
    version:6,
    wines:Array.isArray(record.wines)?record.wines:[],
    categories:Array.isArray(record.categories)?record.categories:[],
    catMeta:record.catMeta&&typeof record.catMeta==='object'?record.catMeta:{},
    updatedAt:new Date().toISOString()
  };
  const saved=await binFetch(env,env.WINES_BIN_ID,'PUT',payload);
  const norm=normalizeWines(saved);
  if(!norm.wines.length&&payload.wines.length)return payload;
  return{
    ...payload,
    wines:norm.wines.length?norm.wines:payload.wines,
    categories:norm.categories.length?norm.categories:payload.categories,
    catMeta:Object.keys(norm.catMeta||{}).length?norm.catMeta:payload.catMeta
  };
}
async function getUsers(env){
  const r=await binFetch(env,env.USERS_BIN_ID);
  return r&&typeof r==='object'?r:{favorites:{}};
}
async function putUsers(env,record){return binFetch(env,env.USERS_BIN_ID,'PUT',{...record,updatedAt:new Date().toISOString()})}
export async function onRequest(context){
  const {request,env,params}=context;
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors(request,env)});
  const path='/'+(params.path||[]).join('/');
  try{
    if(path==='/login'&&request.method==='POST'){
      const {username,password,role}=await request.json();
      if(role!=='admin'&&role!=='colab')return json({error:'Perfil inválido.'},400,request,env);
      if(!env.SESSION_SECRET)return json({error:'Configure o secret SESSION_SECRET no Cloudflare.'},500,request,env);
      const eu=role==='admin'?env.ADMIN_USER:env.COLAB_USER;
      const ep=role==='admin'?env.ADMIN_PASSWORD:env.COLAB_PASSWORD;
      if(!eu||!ep)return json({error:'Credenciais ainda não configuradas no Cloudflare.'},500,request,env);
      if(username!==eu||password!==ep)return json({error:'Usuário ou senha inválidos.'},401,request,env);
      const token=await signToken({sub:username,username,role,exp:Date.now()+43200000},env);
      return json({token,username,role},200,request,env);
    }
    if(path==='/session'&&request.method==='GET'){
      const p=await auth(request,env);
      if(!p)return json({error:'Sessão inválida ou expirada.'},401,request,env);
      return json({username:p.username,role:p.role},200,request,env);
    }
    if(path==='/wines'&&request.method==='GET'){
      return json(await getWines(env),200,request,env);
    }
    if(path==='/wines'&&(request.method==='PUT'||request.method==='POST')){
      const p=await auth(request,env,['admin']);
      if(!p)return json({error:'Acesso restrito ao administrador.'},403,request,env);
      const current=await getWines(env);
      let wines=current.wines||[],categories=current.categories||[],catMeta=current.catMeta||{};
      if(request.method==='PUT'){
        const body=await request.json();
        if(!Array.isArray(body.wines))return json({error:'Lista de vinhos inválida.'},400,request,env);
        wines=body.wines;
        categories=Array.isArray(body.categories)?body.categories:categories;
        if(body.catMeta&&typeof body.catMeta==='object')catMeta=body.catMeta;
      }else{
        const body=await request.json();
        if(!body.wine?.name)return json({error:'Vinho inválido.'},400,request,env);
        const i=wines.findIndex(x=>String(x.id)===String(body.wine.id));
        if(i>=0)wines[i]=body.wine;else wines.push(body.wine);
      }
      const saved=await putWines(env,{wines,categories,catMeta});
      return json({wines:saved.wines||wines,categories:saved.categories||categories,catMeta:saved.catMeta||catMeta},200,request,env);
    }
    const wm=path.match(/^\/wines\/(.+)$/);
    if(wm&&request.method==='DELETE'){
      const p=await auth(request,env,['admin']);
      if(!p)return json({error:'Acesso restrito ao administrador.'},403,request,env);
      const id=decodeURIComponent(wm[1]);
      const r=await getWines(env);
      const wines=(r.wines||[]).filter(x=>String(x.id)!==String(id));
      const saved=await putWines(env,{wines,categories:r.categories||[],catMeta:r.catMeta||{}});
      return json({wines:saved.wines||wines,categories:saved.categories||r.categories||[]},200,request,env);
    }
    if(path==='/favorites'&&request.method==='GET'){
      const p=await auth(request,env);
      if(!p)return json({error:'Faça login para usar favoritos.'},401,request,env);
      const r=await getUsers(env);
      return json({favorites:Array.isArray(r.favorites?.[p.username])?r.favorites[p.username]:[]},200,request,env);
    }
    if(path==='/favorites'&&request.method==='PUT'){
      const p=await auth(request,env);
      if(!p)return json({error:'Faça login para usar favoritos.'},401,request,env);
      const body=await request.json();
      if(!Array.isArray(body.favorites))return json({error:'Favoritos inválidos.'},400,request,env);
      const r=await getUsers(env);
      const favorites={...(r.favorites||{}),[p.username]:body.favorites.map(Number)};
      await putUsers(env,{...r,favorites});
      return json({favorites:favorites[p.username]},200,request,env);
    }
    return json({error:'Rota não encontrada.'},404,request,env);
  }catch(e){
    console.error(e);
    return json({error:e.message||'Erro interno.'},500,request,env);
  }
}

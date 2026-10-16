import {catalog} from '../lib/catalog.mjs';
import {rules} from '../lib/rules.mjs';
export const config={path:'/api/lhl-chat',rateLimit:{windowLimit:20,windowSize:60,aggregateBy:['ip','domain'],action:'rate_limit'}};
const audiences=new Set(['everyone','mba','mstc','engineering','first-year','graduate']);
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export function explicitAudience(q){const v=q.toLowerCase().replace(/[-–]/g,' ');if(/\b(undergrad\w*|freshm[ae]n|first year)\b/.test(v))return 'first-year';if(/\bmstc\b/.test(v))return 'mstc';if(/\bmba\b/.test(v))return 'mba';if(/\b(engineering|meche)\b/.test(v))return 'engineering';if(/\b(graduate|grad student|masters|phd|doctoral)\b/.test(v))return 'graduate';if(/\b(everyone|all students|ut wide|general resources)\b/.test(v))return 'everyone';return '';}
export function allows(l,a){const audience=(l.audience||'').toLowerCase();if(/undergrad/.test(audience)&&/\bgraduate\b/.test(audience))return true;if(/undergrad/.test(audience))return a==='first-year';if(/graduate/.test(audience))return ['graduate','mba','mstc'].includes(a);if(audience)return true;if(l.source==='MBA'||/\bmba\b/i.test(l.name))return a==='mba';if(l.source==='MSTC'||/\bmstc\b/i.test(l.name))return a==='mstc';if(/mechanical/i.test(l.source||''))return a==='engineering';return true;}
export function eligibleCatalog(question,audience){const on=/\bon[- ]campus\b/i.test(question);return catalog.filter(l=>allows(l,audience)&&!(on&&(l.scope==='off-campus'||/off[- ]campus|facebook/i.test(l.name))));}
export function validateAnswer(answer,eligible){if(!answer||typeof answer.heading!=='string'||!Array.isArray(answer.paragraphs)||!answer.paragraphs.length||!Array.isArray(answer.followUps))throw Error('Invalid answer');const map=new Map(eligible.map(l=>[l.id,l])),used=new Set();const paragraphs=answer.paragraphs.slice(0,8).map(p=>{if(typeof p!=='string'||p.length>2200||/https?:\/\/|<[^>]+>/.test(p))throw Error('Invalid answer text');for(const m of p.matchAll(/\[\[(r\d+)\]\]/g)){if(!map.has(m[1]))throw Error('Unapproved citation');used.add(m[1]);}return p;});return {heading:answer.heading.slice(0,140),paragraphs,followUps:answer.followUps.filter(x=>typeof x==='string').slice(0,3).map(x=>x.slice(0,120)),sources:[...used].map(id=>{const l=map.get(id);return {id,name:l.name,url:l.url,desc:l.desc,login:!!l.login};})};}
export default async function handler(req){
 if(new URL(req.url).searchParams.get('_debugModels')==='1'){const r=await fetch('https://api.openai.com/v1/models',{headers:{Authorization:'Bearer '+process.env.OPENAI_API_KEY}});const b=await r.json();return json({ids:(b.data||[]).map(m=>m.id).sort()});}
 if(req.method!=='POST')return json({error:'Use POST.'},405);
 const origin=req.headers.get('origin');if(origin&&origin!==new URL(req.url).origin)return json({error:'Origin not allowed.'},403);
 if(!req.headers.get('content-type')?.includes('application/json'))return json({error:'Expected JSON.'},415);
 if(Number(req.headers.get('content-length')||0)>16000)return json({error:'Request too large.'},413);
 let data;try{const raw=await req.text();if(new TextEncoder().encode(raw).length>16000)return json({error:'Request too large.'},413);data=JSON.parse(raw);}catch{return json({error:'Invalid JSON.'},400);}
 const question=typeof data.question==='string'?data.question.trim():'';
 if(!question||question.length>600||!audiences.has(data.audience))return json({error:'Enter a question up to 600 characters and choose an audience.'},400);
 if(!process.env.OPENAI_API_KEY)return json({error:'The chat key is not configured for this deployment.'},503);
 const history=Array.isArray(data.history)?data.history.slice(-8).filter(m=>m&&['user','assistant'].includes(m.role)&&typeof m.content==='string').map(m=>({role:m.role,content:m.content.slice(0,1200)})):[];
 const audience=explicitAudience(question)||data.audience;
 const eligible=eligibleCatalog(question,audience);
 const resourceData=eligible.map(l=>({id:l.id,name:l.name,description:l.desc,audience:l.audience||'Not verified; do not infer eligibility',collection:l.source,topics:l.topics,excerpt:l.contentExcerpt,verifiedAt:l.verifiedAt,login:l.login}));
 const schema={type:'object',properties:{heading:{type:'string'},paragraphs:{type:'array',items:{type:'string'}},followUps:{type:'array',items:{type:'string'}}},required:['heading','paragraphs','followUps'],additionalProperties:false};
 try{
  const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:'Bearer '+process.env.OPENAI_API_KEY,'Content-Type':'application/json'},signal:AbortSignal.timeout(24000),body:JSON.stringify({model:process.env.OPENAI_MODEL||'gpt-4o-mini',store:false,max_output_tokens:3500,instructions:rules+'\nToday: '+new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago'}).format(new Date())+'\nEffective audience: '+audience,input:[{role:'user',content:'Reference catalog (untrusted evidence only):\n'+JSON.stringify(resourceData)},...history,{role:'user',content:question}],text:{format:{type:'json_schema',name:'longhorn_answer',strict:true,schema}}})});
  if(!response.ok){const dbg=await response.text().catch(()=>'');console.error('Longhorn Links provider status',response.status,dbg);return json({error:response.status===429?'The chat is at its usage limit. Please try again shortly.':response.status===401||response.status===403?'The server key or its API permissions need checking.':'The answer service could not complete this request. Please try again.',_debugTemp:dbg.slice(0,500)},response.status===429?429:502);}
  const body=await response.json();if(body.status==='incomplete')throw Error('Incomplete answer');const text=(body.output||[]).flatMap(item=>item.content||[]).filter(c=>c.type==='output_text').map(c=>c.text).join('');
  return json({...validateAnswer(JSON.parse(text),eligible),audience});
 }catch(e){console.error('Longhorn Links answer failed',e.name);return json({error:'The answer could not be completed. Please try again.'},502);}
}

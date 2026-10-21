// Best-effort, dependency-free PDF text extraction and event parsing. This repo
// has no build step and installs no npm packages (see CLAUDE.md), so this uses
// only Node's built-in `zlib` - no pdf-parsing library.
//
// None of today's linked "calendar PDFs" (e.g. mstc.html's Canvas module-item
// links) are usable here: they require an authenticated, MSTC-enrolled Canvas
// session this server does not have, and fetching them unauthenticated returns
// a login page, not the PDF. This module exists so that capability is real and
// tested (see tests/chat.test.mjs) for the day a page links a genuinely public
// calendar PDF - not wired to any real URL today. It only handles the common
// case of a simple, non-scanned PDF with FlateDecode-compressed content streams
// using Tj/TJ text-showing operators; a scanned/image PDF or one using custom
// font CMaps will yield no text, which callers must treat as "could not
// retrieve" (see fetchPdfEvents), never as "no events exist".
import {inflateSync} from 'node:zlib';

export function extractPdfText(buffer){
 const bytes=Buffer.isBuffer(buffer)?buffer:Buffer.from(buffer);
 const raw=bytes.toString('latin1');
 let out='';
 const streamRe=/stream\r?\n([\s\S]*?)\r?\nendstream/g;
 let m;
 while((m=streamRe.exec(raw))){
  const dictStart=raw.lastIndexOf('obj',m.index);
  const dict=dictStart>=0?raw.slice(dictStart,m.index):'';
  const isFlate=/\/Filter\s*\/FlateDecode/.test(dict)||/\/Filter\s*\[[^\]]*\/FlateDecode/.test(dict);
  let data=Buffer.from(m[1],'latin1');
  if(isFlate){
   try{data=inflateSync(data);}catch{continue;}
  }
  const content=data.toString('latin1');
  if(!/\bT[jJ]\b/.test(content))continue;
  out+=extractShowTextOperators(content)+'\n';
 }
 return out.trim();
}
function extractShowTextOperators(content){
 let text='';
 const tjRe=/\(((?:[^()\\]|\\.)*)\)\s*Tj/g;
 let m;
 while((m=tjRe.exec(content)))text+=unescapePdfString(m[1])+' ';
 const tjArrayRe=/\[((?:[^[\]]|\\.)*)\]\s*TJ/g;
 while((m=tjArrayRe.exec(content))){
  const partRe=/\(((?:[^()\\]|\\.)*)\)/g;
  let p;
  while((p=partRe.exec(m[1])))text+=unescapePdfString(p[1]);
  text+=' ';
 }
 return text;
}
function unescapePdfString(s){
 return s.replace(/\\(n|r|t|b|f|\(|\)|\\)/g,(_,c)=>({n:'\n',r:'\r',t:'\t',b:'\b',f:'\f','(':'(',')':')','\\':'\\'}[c])).replace(/\\\r?\n/g,'');
}

const MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];
const DATE_RE=new RegExp('\\b('+MONTHS.join('|')+')\\s+(\\d{1,2}),?\\s+(\\d{4})\\b','g');
// Heuristic only: treats the text between one recognized "Month D, YYYY" date
// and the next as that date's event title/description. Works for a calendar
// PDF laid out as one dated line per event; will not correctly segment a denser
// or differently-structured document.
export function parseEventsFromPdfText(text,{program,sourceUrl,pdfUrl,verifiedAt}){
 const matches=[...text.matchAll(DATE_RE)];
 const out=[];
 for(let i=0;i<matches.length;i++){
  const m=matches[i];
  const month=MONTHS.indexOf(m[1])+1,day=Number(m[2]),year=Number(m[3]);
  const date=`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  const afterStart=m.index+m[0].length;
  const afterEnd=i+1<matches.length?matches[i+1].index:text.length;
  let title=text.slice(afterStart,afterEnd).replace(/^[\s:,.\-–—]+/,'').trim();
  if(!title)continue;
  if(title.length>160)title=title.slice(0,160);
  out.push({id:program+'-pdf-'+date+'-'+out.length,program,title,date,endDate:null,dateLabel:m[0],year,time:'',where:'',desc:'',url:null,kind:'Event',cost:'',source:'pdf',sourceUrl,pdfUrl,verifiedAt});
 }
 return out;
}

export async function fetchPdfEvents(url,{program,verifiedAt}={}){
 try{
  const res=await fetch(url,{signal:AbortSignal.timeout(6000)});
  if(!res.ok)return {ok:false,reason:'fetch-failed',status:res.status};
  const ct=res.headers.get('content-type')||'';
  if(ct.includes('text/html'))return {ok:false,reason:'login-wall-or-html'};
  const buf=Buffer.from(await res.arrayBuffer());
  const text=extractPdfText(buf);
  if(!text)return {ok:false,reason:'no-extractable-text'};
  const events=parseEventsFromPdfText(text,{program,sourceUrl:url,pdfUrl:url,verifiedAt:verifiedAt||new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago'}).format(new Date())});
  return {ok:true,events};
 }catch(e){
  return {ok:false,reason:e.name==='AbortError'?'timeout':'error'};
 }
}

function normTitle(t){return t.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();}
// Page-sourced events are hand-verified when events.mjs is synced; a PDF-extracted
// duplicate of the same date+title adds nothing, so the page copy wins.
export function mergeEvents(...lists){
 const flat=lists.flat();
 const seen=new Map();
 const out=[];
 for(const e of flat){
  const key=e.date+'|'+normTitle(e.title);
  if(seen.has(key)){
   const existing=seen.get(key);
   if(existing.source==='pdf'&&e.source==='page'){out[out.indexOf(existing)]=e;seen.set(key,e);}
   continue;
  }
  seen.set(key,e);
  out.push(e);
 }
 return out.sort((a,b)=>a.date.localeCompare(b.date));
}

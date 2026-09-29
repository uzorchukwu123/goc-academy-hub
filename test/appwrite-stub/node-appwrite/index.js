/* In-memory stand-in for node-appwrite, used only to exercise the server's
   resource/video routes without a live Appwrite project. */
const fs=require('fs'), path=require('path');
const files=new Map();          // "bucket/id" -> Buffer
const cols=new Map();           // "db/col" -> Map(id -> doc)
const calls={get:{}};
const names=new Map();
function col(db,c){ const k=db+'/'+c; if(!cols.has(k)) cols.set(k,new Map()); return cols.get(k); }
const Query={ equal:(a,v)=>({m:'equal',a,v}), limit:n=>({m:'limit',n}), orderAsc:a=>({m:'o'}), orderDesc:a=>({m:'o'}),
  notEqual:(a,v)=>({m:'ne',a,v}), search:()=>({m:'o'}), select:()=>({m:'o'}), offset:()=>({m:'o'}), greaterThan:()=>({m:'o'}), lessThan:()=>({m:'o'}),
  greaterThanEqual:(a,v)=>({m:'gte',a,v}), lessThanEqual:(a,v)=>({m:'lte',a,v}), cursorAfter:id=>({m:'after',id}) };
/* Fault injection for tests. If STUB_FAULT_FILE names a JSON file, it is read on
   every call, so a test can switch faults on and off while the server runs:
   { failDeleteIds:[attempt ids], failStudentUpdate:true, delayDeleteMs:400 } */
function fault(){ try{ return JSON.parse(fs.readFileSync(process.env.STUB_FAULT_FILE,'utf8')); }catch(_){ return {}; } }
class Client{ setEndpoint(){return this;} setProject(){return this;} setKey(){return this;} }
class Storage{
  constructor(){}
  async createFile(b,id,input){ if(process.env.STUB_FAULT_FILE && fault().failBlobUpload) throw new Error('injected: upload failed');  names.set(b+'/'+id,input.name); files.set(b+'/'+id, fs.readFileSync(input.path)); return {$id:id}; }
  async getFileView(b,id){ const k=b+'/'+id; calls.get[id]=(calls.get[id]||0)+1; if(!files.has(k)) throw new Error('File not found'); const bf=files.get(k); return bf.buffer.slice(bf.byteOffset,bf.byteOffset+bf.byteLength); /* the real SDK returns an ArrayBuffer */ }
  async getFile(b,id){ const k=b+'/'+id; if(!files.has(k)) throw new Error('File not found'); return {$id:id,name:names.get(k)||id,sizeOriginal:files.get(k).length,mimeType:'application/octet-stream'}; }
  async getFileDownload(b,id){ return this.getFileView(b,id); }
  async deleteFile(b,id){ if(!files.delete(b+'/'+id)) throw new Error('File not found'); }
}
class Databases{
  async createDocument(db,c,id,data){ const d=Object.assign({$id:id,$createdAt:new Date().toISOString(),$updatedAt:new Date().toISOString()},data); col(db,c).set(id,d); return d; }
  async getDocument(db,c,id){ const d=col(db,c).get(id); if(!d) throw new Error('Document not found'); return d; }
  async updateDocument(db,c,id,data){ if(process.env.STUB_FAULT_FILE && c==='students' && fault().failStudentUpdate) throw new Error('injected: student update failed'); const d=await this.getDocument(db,c,id); Object.assign(d,data,{$updatedAt:new Date().toISOString()}); return d; }
  async upsertDocument(db,c,id,data){ const m=col(db,c); const d=Object.assign(m.get(id)||{$id:id,$createdAt:new Date().toISOString()},data,{$updatedAt:new Date().toISOString()}); m.set(id,d); return d; }
  async deleteDocument(db,c,id){
    if(process.env.STUB_FAULT_FILE && c==='attempts'){ const f=fault();
      if(f.delayDeleteMs) await new Promise(r=>setTimeout(r,f.delayDeleteMs));
      if((f.failDeleteIds||[]).includes(String(id))) throw new Error('injected: delete failed'); }
    col(db,c).delete(id); return {}; }
  async listDocuments(db,c,qs=[]){ let docs=[...col(db,c).values()];
    qs.forEach(q=>{ if(q&&q.m==='equal') docs=docs.filter(d=>Array.isArray(q.v)?q.v.includes(d[q.a]):d[q.a]===q.v); });
    if(process.env.STUB_NO_SUBMITTED_INDEX && qs.some(q=>q&&(q.m==='gte'||q.m==='lte'))) throw new Error('Index not found: submittedAt');
    qs.forEach(q=>{ if(q&&q.m==='gte') docs=docs.filter(d=>d[q.a]>=q.v); if(q&&q.m==='lte') docs=docs.filter(d=>d[q.a]<=q.v); });
    const after=qs.find(q=>q&&q.m==='after'); if(after){ const i=docs.findIndex(d=>d.$id===after.id); docs=i>-1?docs.slice(i+1):[]; }
    const lim=(qs.find(q=>q&&q.m==='limit')||{}).n; if(lim) docs=docs.slice(0,lim);
    return {total:docs.length,documents:docs}; }
}
class Users{ async create(id,email){ return {$id:Math.random().toString(16).slice(2),email}; } async delete(){} async updatePassword(){} }
class Account{ constructor(){} async createEmailPasswordSession(){ return {$id:'sess'}; } }
const ID={unique:()=>Math.random().toString(16).slice(2)};
/* seed for the harness */
if(process.env.STUB_SEED){
  const seed=JSON.parse(fs.readFileSync(process.env.STUB_SEED,'utf8'));
  seed.files.forEach(f=>{ files.set('goc-data/'+f.id, fs.readFileSync(f.path)); names.set('goc-data/'+f.id, path.basename(f.path)); });
  seed.docs.forEach(d=>col('goc_academy',d.col).set(d.data.$id,Object.assign({$createdAt:new Date().toISOString(),$updatedAt:new Date().toISOString()},d.data)));
}
/* introspection endpoint for the harness */
global.__stubCalls=calls;
module.exports={Client,Storage,Databases,Users,Account,Query,ID,__calls:calls};

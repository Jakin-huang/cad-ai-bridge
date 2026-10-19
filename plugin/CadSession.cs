using System;
using System.IO;
using System.IO.Pipes;
using System.Text;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using System.Collections.Generic;
using System.Collections.Concurrent;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Diagnostics;
using Autodesk.AutoCAD.Runtime;
using Autodesk.AutoCAD.DatabaseServices;
using Autodesk.AutoCAD.ApplicationServices;
using App=Autodesk.AutoCAD.ApplicationServices.Core.Application;

namespace CadAgent {
 public sealed class SessionEnvelope {
  public string action,token,sessionId,documentId,requestId,expiresAt;
  public long expectedRevision;
  public EntityFilter filter;
  public int limit;
  public Operation[] operations;
  public bool saveCopy;
 }
 public static partial class Commands {
  sealed class SessionDocument { public string id=Guid.NewGuid().ToString();public long revision; }
  sealed class SessionWork { public SessionEnvelope request;public object response;public DateTime expires;public ManualResetEvent ready=new ManualResetEvent(false),dispatch=new ManualResetEvent(false);public bool cancelled; }
  static readonly ConcurrentQueue<SessionWork> SessionQueue=new ConcurrentQueue<SessionWork>();
  static readonly Dictionary<Document,SessionDocument> SessionDocuments=new Dictionary<Document,SessionDocument>();
  static string SessionId,SessionToken,SessionPipe,SessionRoot;
  static volatile bool SessionRunning,SessionBusy;
  static NamedPipeServerStream SessionListener;
  static SessionWork SessionPendingCommand;
  static readonly HashSet<string> SessionEditTypes=new HashSet<string>{"move","copy","rotate","scale","mirror","array","erase","set_text","set_attributes","set_layer","upsert_layer","add_geometry","insert_block","offset","trim","extend_line","add_dimension"};
  static string SessionCanonical(object value){
   if(value==null)return "null";
   var map=value as IDictionary<string,object>;if(map!=null)return "{"+String.Join(",",map.Keys.OrderBy(key=>key,StringComparer.Ordinal).Select(key=>Json.Serialize(key)+":"+SessionCanonical(map[key])))+"}";
   if(!(value is string)&&value is System.Collections.IEnumerable)return "["+String.Join(",",((System.Collections.IEnumerable)value).Cast<object>().Select(SessionCanonical))+"]";
   return Json.Serialize(value);
  }
  static bool SessionCancelled(SessionEnvelope request){Guid id;return Guid.TryParse(request.requestId,out id)&&File.Exists(Path.Combine(SessionRoot,"cancel",SessionId,id.ToString("D")+".json"));}
  [CommandMethod("CADBRIDGESESSIONSTART",CommandFlags.Session)]
  public static void StartSession(){
   Require(Process.GetCurrentProcess().ProcessName.Equals("acad",StringComparison.OrdinalIgnoreCase),"SESSION_HOST_REQUIRED","Session bridge requires full interactive AutoCAD.");
   if(SessionRunning)return;
   SessionRoot=Environment.GetEnvironmentVariable("CADBRIDGE_SESSION_HOME")??Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"CADBridge","sessions");Directory.CreateDirectory(SessionRoot);
   SessionId=Guid.NewGuid().ToString();SessionToken=Guid.NewGuid().ToString("N")+Guid.NewGuid().ToString("N");SessionPipe="cadbridge-"+Process.GetCurrentProcess().Id+"-"+Guid.NewGuid().ToString("N");SessionRunning=true;
   foreach(Document document in App.DocumentManager)TrackSessionDocument(document);
   App.DocumentManager.DocumentCreated+=(s,e)=>TrackSessionDocument(e.Document);
   App.DocumentManager.DocumentToBeDestroyed+=(s,e)=>SessionDocuments.Remove(e.Document);
   App.Idle+=DrainSession;
   var descriptor=new{schemaVersion=1,pid=Process.GetCurrentProcess().Id,startedAt=Process.GetCurrentProcess().StartTime.ToUniversalTime().ToString("o"),sessionId=SessionId,pipe=SessionPipe,token=SessionToken,pluginPath=typeof(Commands).Assembly.Location,host="AutoCAD 2022",scope="current-user local named pipe; explicit document identity required"};
   File.WriteAllText(Path.Combine(SessionRoot,SessionId+".json"),Json.Serialize(descriptor),new UTF8Encoding(false));
   var thread=new Thread(SessionAccept){IsBackground=true,Name="CAD AI Bridge local session"};thread.Start();
   App.DocumentManager.MdiActiveDocument.Editor.WriteMessage("\nCADBRIDGE_SESSION_READY\n");
  }
  [CommandMethod("CADBRIDGESESSIONSTOP",CommandFlags.Session)]
  public static void StopSession(){SessionRunning=false;App.Idle-=DrainSession;try{if(SessionListener!=null)SessionListener.Dispose();}catch{}if(SessionRoot!=null&&SessionId!=null)try{File.Delete(Path.Combine(SessionRoot,SessionId+".json"));}catch{} }
  static SessionDocument TrackSessionDocument(Document document){
   SessionDocument state;if(SessionDocuments.TryGetValue(document,out state))return state;
   state=new SessionDocument();SessionDocuments.Add(document,state);
   document.Database.ObjectModified+=(s,e)=>Interlocked.Increment(ref state.revision);
   document.Database.ObjectAppended+=(s,e)=>Interlocked.Increment(ref state.revision);
   document.Database.ObjectErased+=(s,e)=>Interlocked.Increment(ref state.revision);
   return state;
  }
  static string SessionRead(Stream pipe){
   var bytes=new MemoryStream();int value;while((value=pipe.ReadByte())!=-1&&value!=10){Require(bytes.Length<1048576,"REQUEST_TOO_LARGE","Session request exceeds 1 MiB.");bytes.WriteByte((byte)value);}return Encoding.UTF8.GetString(bytes.ToArray());
  }
  static void SessionAccept(){
   while(SessionRunning)try{
    var security=new PipeSecurity();security.SetAccessRuleProtection(true,false);security.AddAccessRule(new PipeAccessRule(WindowsIdentity.GetCurrent().User,PipeAccessRights.FullControl,AccessControlType.Allow));
    using(var pipe=new NamedPipeServerStream(SessionPipe,PipeDirection.InOut,1,PipeTransmissionMode.Byte,PipeOptions.Asynchronous,65536,65536,security)){
     SessionListener=pipe;pipe.WaitForConnection();object response;SessionWork completedWork=null;
     try{
      // A silent client cannot occupy the only listener indefinitely.
      var reading=Task.Factory.StartNew(()=>SessionRead(pipe));if(!reading.Wait(5000))throw new Fault("SESSION_INPUT_TIMEOUT","Request did not arrive within five seconds.");
      var request=Json.Deserialize<SessionEnvelope>(reading.Result);Require(request!=null&&request.token==SessionToken&&request.sessionId==SessionId,"SESSION_UNAUTHORIZED","Invalid session authentication.");
      DateTime expires;Require(DateTime.TryParse(request.expiresAt,null,System.Globalization.DateTimeStyles.RoundtripKind,out expires)&&expires.ToUniversalTime()>DateTime.UtcNow&&expires.ToUniversalTime()<DateTime.UtcNow.AddSeconds(60),"SESSION_REQUEST_EXPIRED","Request has expired or an invalid deadline.");
      var work=new SessionWork{request=request,expires=expires.ToUniversalTime()};completedWork=work;SessionQueue.Enqueue(work);
      int phase=WaitHandle.WaitAny(new WaitHandle[]{work.ready,work.dispatch},50000);
      if(phase==1){using(var acknowledgement=new StreamWriter(pipe,new UTF8Encoding(false),65536,true)){acknowledgement.WriteLine(Json.Serialize(new{eventType="dispatch",command="CADBRIDGESESSIONEXEC",pid=Process.GetCurrentProcess().Id,requestId=request.requestId}));acknowledgement.Flush();}if(!work.ready.WaitOne(45000))phase=WaitHandle.WaitTimeout;}
      if(phase==WaitHandle.WaitTimeout){work.cancelled=true;throw new Fault("SESSION_STATE_UNKNOWN","No result was received. Inspect the session job; do not repeat a write.");}response=work.response;
     }catch(System.Exception ex){var fault=ex as Fault;response=new{ok=false,error=new{code=fault==null?"SESSION_ERROR":fault.Code,message=ex.Message},safeToRetry=false};}
     using(var writer=new StreamWriter(pipe,new UTF8Encoding(false),65536,true)){writer.WriteLine(Json.Serialize(response));writer.Flush();}
     if(completedWork!=null&&completedWork.ready.WaitOne(0)){completedWork.ready.Dispose();completedWork.dispatch.Dispose();}
    }
   }catch{if(!SessionRunning)break;}
  }
  static void DrainSession(object sender,EventArgs args){
   var pending=SessionPendingCommand;
   if(pending!=null&&(pending.cancelled||DateTime.UtcNow>=pending.expires)){
    SessionPendingCommand=null;SessionBusy=false;
    pending.response=new{ok=false,error=new{code="SESSION_REQUEST_EXPIRED",message="Command dispatch expired before execution; no edit was applied."},mutationCommitted=false,safeToRetry=false};pending.ready.Set();
   }
   if(SessionBusy||!SessionRunning)return;var active=App.DocumentManager.MdiActiveDocument;if(active==null)return;
   SessionWork work;if(!SessionQueue.TryDequeue(out work))return;
   if(work.cancelled||DateTime.UtcNow>=work.expires){work.response=new{ok=false,error=new{code="SESSION_REQUEST_EXPIRED",message="Request expired before execution."},mutationCommitted=false,safeToRetry=false};work.ready.Set();return;}
   if(work.request.action=="context"||work.request.action=="query"){
    try{work.response=SessionDispatch(work.request);}catch(System.Exception ex){var fault=ex as Fault;work.response=new{ok=false,error=new{code=fault==null?"SESSION_ERROR":fault.Code,message=ex.Message},safeToRetry=false};}finally{work.ready.Set();}return;
   }
   if(!String.IsNullOrEmpty(active.CommandInProgress)){work.response=new{ok=false,error=new{code="SESSION_BUSY",message="An interactive command is in progress; finish it before editing."},mutationCommitted=false,safeToRetry=false};work.ready.Set();return;}
   SessionBusy=true;
   if(work.request.action=="edit"){
    SessionPendingCommand=work;
    // A protocol acknowledgement asks the external bridge to enter only this
    // fixed registered command via the verified process's COM interface.
    // No command is invoked recursively from this Idle event.
    work.dispatch.Set();return;
   }
   try{work.response=SessionDispatch(work.request);}catch(System.Exception ex){var fault=ex as Fault;work.response=new{ok=false,error=new{code=fault==null?"SESSION_ERROR":fault.Code,message=ex.Message},safeToRetry=false};}finally{SessionBusy=false;work.ready.Set();}
  }
  [CommandMethod("CADBRIDGESESSIONEXEC",CommandFlags.Modal|CommandFlags.UsePickSet|CommandFlags.Redraw)]
  public static void ExecuteSessionCommand(){
   var work=SessionPendingCommand;if(work==null)return;
   try{
    var input=App.DocumentManager.MdiActiveDocument.Editor.GetString(new Autodesk.AutoCAD.EditorInput.PromptStringOptions("\nBridge request UUID: "){AllowSpaces=false});Guid requested;
    Require(input.Status==Autodesk.AutoCAD.EditorInput.PromptStatus.OK&&Guid.TryParse(input.StringResult,out requested)&&requested.ToString("D").Equals(work.request.requestId,StringComparison.OrdinalIgnoreCase),"SESSION_COMMAND_CANCELLED","Command was cancelled or the request identity did not match; no edit was applied.");
    if(work.cancelled)throw new Fault("SESSION_REQUEST_EXPIRED","Request was cancelled before the command ran.");work.response=SessionDispatch(work.request);
   }catch(System.Exception ex){var fault=ex as Fault;work.response=new{ok=false,error=new{code=fault==null?"SESSION_ERROR":fault.Code,message=ex.Message},mutationCommitted=false,safeToRetry=false};}finally{SessionPendingCommand=null;SessionBusy=false;work.ready.Set();}
  }
  static object SessionContext(Document document,SessionDocument state){
   var selection=document.Editor.SelectImplied();var selected=selection.Status==Autodesk.AutoCAD.EditorInput.PromptStatus.OK?selection.Value.GetObjectIds().Where(id=>!id.IsErased).Select(id=>id.Handle.ToString()).ToArray():new string[0];
   using(var process=Process.GetCurrentProcess())using(var view=document.Editor.GetCurrentView())return new{documentId=state.id,revision=Interlocked.Read(ref state.revision),name=document.Name,units=document.Database.Insunits.ToString(),modified=Convert.ToInt32(App.GetSystemVariable("DBMOD"))!=0,commandInProgress=document.CommandInProgress,selectedHandles=selected,resources=new{handleCount=process.HandleCount,privateBytes=process.PrivateMemorySize64},view=new{center=new[]{view.CenterPoint.X,view.CenterPoint.Y,0},width=view.Width,height=view.Height,twist=view.ViewTwist},savePolicy="In-memory edits never overwrite the original file. saveCopy writes a separate new DWG; normal CAD undo remains available."};
  }
  static object SessionDispatch(SessionEnvelope request){
   Require(DateTime.Parse(request.expiresAt).ToUniversalTime()>DateTime.UtcNow,"SESSION_REQUEST_EXPIRED","Request expired before entering the document command context.");
   var doc=App.DocumentManager.MdiActiveDocument;Require(doc!=null,"SESSION_DOCUMENT_CLOSED","No active document.");var state=TrackSessionDocument(doc);var db=doc.Database;
   if(request.action=="context")return new{ok=true,sessionId=SessionId,context=SessionContext(doc,state),documents=App.DocumentManager.Cast<Document>().Select(d=>new{documentId=TrackSessionDocument(d).id,name=d.Name,active=d==doc}).ToArray()};
   Require(request.documentId==state.id,"SESSION_DOCUMENT_MISMATCH","The active document changed. Read current context before continuing.");
   if(request.action=="query"){
    Require(request.expectedRevision==Interlocked.Read(ref state.revision),"STALE_SESSION_REVISION","The document changed since its context was read.");
    var query=QueryEntities(db,new Request{filter=request.filter,limit=Math.Max(1,Math.Min(5000,request.limit))});return new{ok=true,sessionId=SessionId,query=query,context=SessionContext(doc,state)};
   }
   Require(request.action=="edit"||request.action=="snapshot","SESSION_ACTION_UNSUPPORTED","Unsupported session action.");
   Guid uuid;Require(Guid.TryParse(request.requestId,out uuid),"INVALID_REQUEST_ID","Session output request requires UUID.");
   var job=Path.Combine(SessionRoot,"jobs",SessionId,uuid.ToString("D"));Directory.CreateDirectory(job);
   string resultFile=Path.Combine(job,"result.json"),pending=Path.Combine(job,"pending.json");
   string fingerprintPayload=SessionCanonical(Json.DeserializeObject(Json.Serialize(new{request.action,request.documentId,request.operations,request.saveCopy}))),fingerprint=Hash(fingerprintPayload);
   if(File.Exists(resultFile)){
    var stored=Json.Deserialize<Dictionary<string,object>>(File.ReadAllText(resultFile,Encoding.UTF8));Require(Convert.ToString(stored["fingerprint"])==fingerprint,"REQUEST_ID_CONFLICT","UUID belongs to different session operations (expected "+Convert.ToString(stored["fingerprint"])+", received "+fingerprint+").");stored["replayed"]=true;stored["context"]=SessionContext(doc,state);stored["historicalResult"]=true;return stored;
   }
   Require(!File.Exists(pending),"SESSION_STATE_UNKNOWN","A previous attempt has no final journal. Inspect the document and retained copy before any new write.");
   Require(request.expectedRevision==Interlocked.Read(ref state.revision),"STALE_SESSION_REVISION","Manual or other changes occurred after the last context read.");
   Require(request.action!="edit"||(db.Insunits==UnitsValue.Millimeters&&request.operations!=null&&request.operations.Length>0&&request.operations.Length<=100),"SESSION_EDIT_UNSUPPORTED","Expected declared millimeters and 1..100 ordinary operations.");
   File.WriteAllText(pending,Json.Serialize(new{fingerprint=fingerprint,documentId=state.id,revision=state.revision,action=request.action}),new UTF8Encoding(false));File.WriteAllText(Path.Combine(job,"fingerprint.json"),fingerprintPayload,new UTF8Encoding(false));
   bool committed=false,saved=false;string output=null;var changes=new List<object>();
   try{
    Require(!SessionCancelled(request),"CANCELLED","Request cancelled before editing.");
    using(doc.LockDocument()){
     if(request.action=="edit")Require((Convert.ToInt32(App.GetSystemVariable("UNDOCTL"))&1)!=0&&(Convert.ToInt32(App.GetSystemVariable("UNDOCTL"))&8)==0,"SESSION_UNDO_UNAVAILABLE","Enable undo and finish any user-owned undo group before session editing.");
     if(request.action=="edit")using(var tr=db.TransactionManager.StartTransaction()){
      var index=Index(db,tr);
      foreach(var op in request.operations){Require(!SessionCancelled(request),"CANCELLED","Request cancelled during the transaction.");Require(op!=null&&SessionEditTypes.Contains(op.type)&&op.ids==null&&op.id==null,"SESSION_EDIT_UNSUPPORTED","Only ordinary structured edits are available in sessions.");foreach(var handle in (op.handles??new string[0]).Concat(op.handle==null?new string[0]:new[]{op.handle}))SafeEntity(db,tr,ByHandle(db,tr,handle),false);changes.Add(Edit(db,tr,op,index,"generic"));}
      Require(!SessionCancelled(request),"CANCELLED","Request cancelled before transaction commit.");
      tr.Commit();committed=true;
     }
     if(request.action=="snapshot"||request.saveCopy){output=Path.Combine(job,"output.dwg");Require(!File.Exists(output),"OUTPUT_EXISTS","Session output already exists.");using(var copy=db.Wblock())copy.SaveAs(output,DwgVersion.AC1032);saved=true;}
    }
    var result=new{ok=true,fingerprint=fingerprint,sessionId=SessionId,context=SessionContext(doc,state),mutationCommitted=committed,drawingSaved=saved,drawing=output,changes=changes,replayed=false,safeToRetry=false,outcome=saved?"saved":committed?"modified_not_saved":"read_only"};File.WriteAllText(resultFile,Json.Serialize(result),new UTF8Encoding(false));return result;
   }catch(System.Exception ex){
    var fault=ex as Fault;var result=new{ok=false,fingerprint=fingerprint,sessionId=SessionId,error=new{code=fault==null?"SESSION_ERROR":fault.Code,message=ex.Message},context=SessionContext(doc,state),mutationCommitted=committed,drawingSaved=saved,drawing=output,safeToRetry=false,outcome=saved?"saved":committed?"modified_not_saved":"not_applied"};File.WriteAllText(resultFile,Json.Serialize(result),new UTF8Encoding(false));return result;
   }
  }
 }
}

using System;
using System.IO;
using System.Linq;
using System.Globalization;
using System.Reflection;
using System.Collections.Generic;
using Autodesk.AutoCAD.DatabaseServices;
using Autodesk.AutoCAD.ApplicationServices;
using Autodesk.AutoCAD.Runtime;
using Autodesk.AutoCAD.Geometry;
using App=Autodesk.AutoCAD.ApplicationServices.Core.Application;

namespace CadAgent {
 public static partial class Commands {
  static Document NativeDocument;
  static string NativeRequest;
  static DateTime NativeActivityAt;
  static System.Windows.Forms.Timer NativeTimer;
  // Native commands run in document context after opening the owned snapshot.
  [CommandMethod("CADBRIDGENATIVEOPEN",CommandFlags.Session)]
  public static void NativeOpen(){
   try{NativeOpenImpl();}catch(System.Exception ex){NativeEntryFailure(ex);NativeSignal();}
  }
  static void NativeOpenImpl(){
   var boot=App.DocumentManager.MdiActiveDocument;
   var p=boot.Editor.GetString(new Autodesk.AutoCAD.EditorInput.PromptStringOptions("\nRequest JSON file: "){AllowSpaces=true});
   if(p.Status!=Autodesk.AutoCAD.EditorInput.PromptStatus.OK)return;
   string file=Path.GetFullPath(p.StringResult),job=Path.GetDirectoryName(file);
   Require(Path.GetFileName(file)=="request.json"&&Path.GetFileName(job).StartsWith("CadBridgeGUI-",StringComparison.Ordinal)&&String.Equals(Path.GetFullPath(boot.Name),Path.Combine(job,"startup.dwg"),StringComparison.OrdinalIgnoreCase),"INVALID_HOST","Native commands require an owned GUI host.");
   NativeRequest=file;NativeDocument=DocumentCollectionExtension.Open(App.DocumentManager,Path.Combine(job,"input.dwg"),false);
   App.DocumentManager.MdiActiveDocument=NativeDocument;
   // Tangent posts startup commands after document activation. Let those finish
   // before sending point input, otherwise TSHOWBAR can cancel the native jig.
   NativeActivityAt=DateTime.UtcNow;NativeDocument.CommandWillStart+=NativeActivity;NativeDocument.CommandEnded+=NativeActivity;NativeDocument.CommandCancelled+=NativeActivity;NativeDocument.CommandFailed+=NativeActivity;
   NativeTimer=new System.Windows.Forms.Timer{Interval=250};NativeTimer.Tick+=NativeReady;NativeTimer.Start();
  }
  static void NativeActivity(object sender,CommandEventArgs e){NativeActivityAt=DateTime.UtcNow;}
  static Request NativePlan;
  static Fault NativeFault;
  static bool NativeReplay,NativeUndo,NativeSettings;
  static int NativeStepIndex;
  static string NativeFingerprint,NativeTaskKey;
  static Dictionary<string,string> NativeBefore,NativeStepBefore;
  static HashSet<string> NativeRootsBefore,NativeStepRoots;
  static List<object> NativeChanges;
  static object NativeOsnap,NativeEcho;
  static Matrix3d NativeUcs;
  static string NativePick;
  // Explicit field order avoids JavaScriptSerializer/TypeDescriptor cache order
  // changing the UUID fingerprint between preparation and final commit.
  static string NativeDigest(Request r){return Hash("native1\n"+r.documentId+"\n"+r.units+"\n"+String.Join("\n",r.operations.Select(op=>op.type+"|"+(op.type=="create_native_tray"?Coordinate(op.fromPoint)+"|"+Coordinate(op.toPoint):op.handle.ToUpperInvariant())+"|"+(op.type=="add_native_tray_label"?Coordinate(op.position)+"|"+Coordinate(op.landingPoint):op.width.ToString("R",CultureInfo.InvariantCulture)+"|"+op.height.ToString("R",CultureInfo.InvariantCulture)+"|"+op.nativeModel))));}
  static void NativeReady(object sender,EventArgs e){try{
   if(NativeDocument==null||App.DocumentManager.MdiActiveDocument!=NativeDocument||(DateTime.UtcNow-NativeActivityAt).TotalSeconds<5||Convert.ToInt32(App.GetSystemVariable("CMDACTIVE"))!=0)return;
   NativeTimer.Stop();NativeTimer.Dispose();NativeTimer=null;
   NativeDocument.CommandWillStart-=NativeActivity;NativeDocument.CommandEnded-=NativeActivity;NativeDocument.CommandCancelled-=NativeActivity;NativeDocument.CommandFailed-=NativeActivity;
   string raw=File.ReadAllText(NativeRequest);Require(System.Text.Encoding.UTF8.GetByteCount(raw)<=1048576,"REQUEST_TOO_LARGE","Request exceeds 1 MiB.");NativePlan=Json.Deserialize<Request>(raw);
   Require(NativePlan!=null&&NativePlan.action=="edit"&&NativePlan.operations!=null&&NativePlan.operations.Length>0&&NativePlan.operations.Length<=100&&NativePlan.operations.All(op=>op!=null&&IsNativeOperation(op.type)),"INVALID_OPERATION","Invalid native plan.");
   var queue=new System.Text.StringBuilder("CADBRIDGENATIVEBEGIN\n");
   foreach(var op in NativePlan.operations){
    queue.Append("CADBRIDGENATIVEPREPARE\n");
    if(op.type=="create_native_tray")queue.Append("(if (CADBRIDGE_NATIVE_CONTINUE) (progn (command \"telcableadd\" \"").Append(Coordinate(op.fromPoint)).Append("\" \"").Append(Coordinate(op.toPoint)).Append("\" \"\") (command)))\n");
    if(op.type=="add_native_tray_label")queue.Append("(if (CADBRIDGE_NATIVE_CONTINUE) (progn (command \"tel_lable\" (CADBRIDGE_NATIVE_PICK) \"").Append(Coordinate(op.position)).Append("\" \"").Append(Coordinate(op.landingPoint)).Append("\") (command)))\n");
    queue.Append("CADBRIDGENATIVESTEP\n");
   }
   queue.Append("(if (CADBRIDGE_NATIVE_GROUP) (progn (command \"_.UNDO\" \"_End\") (if (CADBRIDGE_NATIVE_FAILED) (command \"_.U\"))))\nCADBRIDGENATIVEEND\n");
   NativeDocument.SendStringToExecute(queue.ToString(),true,false,false);
  }catch(System.Exception ex){if(NativeTimer!=null){NativeTimer.Stop();NativeTimer.Dispose();NativeTimer=null;}NativeEntryFailure(ex);NativeSignal();}}
  static void NativeRecordError(System.Exception ex){NativeFault=ex as Fault??new Fault("NATIVE_OPERATION_FAILED",ex.Message);}
  [LispFunction("CADBRIDGE_NATIVE_CONTINUE")] public static object NativeContinue(ResultBuffer unused){return NativeFault==null&&!NativeReplay?(object)1:null;}
  [LispFunction("CADBRIDGE_NATIVE_GROUP")] public static object NativeGroup(ResultBuffer unused){return NativeUndo?(object)1:null;}
  [LispFunction("CADBRIDGE_NATIVE_FAILED")] public static object NativeFailed(ResultBuffer unused){return NativeFault!=null?(object)1:null;}
  [LispFunction("CADBRIDGE_NATIVE_PICK")] public static object NativeLabelPick(ResultBuffer unused){return NativePick;}
  [CommandMethod("CADBRIDGENATIVEPREPARE",CommandFlags.Modal)] public static void NativePrepare(){if(NativeFault!=null||NativeReplay)return;try{
   var op=NativePlan.operations[NativeStepIndex];
   if(op.type=="create_native_tray"){Require(Point(op.fromPoint).DistanceTo(Point(op.toPoint))>1e-6,"INVALID_ARGUMENT","Distinct WCS points required.");using(var line=new Line(Point(op.fromPoint),Point(op.toPoint)))NativeSeparation(NativeDocument.Database,line,op.width,null);return;}
   if(op.type!="add_native_tray_label")return;
   NativeTrayCom(NativeDocument.Database,op.handle);
   using(var tr=NativeDocument.Database.TransactionManager.StartOpenCloseTransaction()){
    var layers=(LayerTable)tr.GetObject(NativeDocument.Database.LayerTableId,OpenMode.ForRead);if(layers.Has("CABLETRAY_DIM")){var layer=(LayerTableRecord)tr.GetObject(layers["CABLETRAY_DIM"],OpenMode.ForRead);Require(!layer.IsLocked&&!layer.IsDependent,"LAYER_LOCKED","CABLETRAY_DIM");}
    var c=ByHandle(NativeDocument.Database,tr,op.handle) as Curve;Require(c!=null,"NATIVE_TYPE_UNSUPPORTED","Expected a native tray curve.");
    var pick=c.StartPoint+(c.EndPoint-c.StartPoint)*0.5;var corner=Point(op.position);var landing=Point(op.landingPoint);
    var direction=(c.EndPoint-c.StartPoint).GetNormal();double offset=(corner-pick).CrossProduct(direction).Length;
    Require(offset>Convert.ToDouble(ComGet(c.AcadObject,"Width"),CultureInfo.InvariantCulture)/2+1,"NATIVE_LABEL_POSITION_INVALID","Label corner must lie outside the selected tray width.");
    NativePick=Coordinate(XY(pick));
    double minX=Math.Min(pick.X,Math.Min(corner.X,landing.X)),maxX=Math.Max(pick.X,Math.Max(corner.X,landing.X)),minY=Math.Min(pick.Y,Math.Min(corner.Y,landing.Y)),maxY=Math.Max(pick.Y,Math.Max(corner.Y,landing.Y));
    NativeDocument.Editor.Command("_.PLAN","_World");NativeDocument.Editor.Command("_.ZOOM","_C",new Point3d((minX+maxX)/2,(minY+maxY)/2,0),Math.Max(5000,Math.Max(maxX-minX,maxY-minY)*3));NativeDocument.Editor.Regen();
   }
  }catch(System.Exception ex){NativeRecordError(ex);}}
  [CommandMethod("CADBRIDGENATIVEBEGIN",CommandFlags.Modal)] public static void NativeBegin(){try{
   Require(App.DocumentManager.MdiActiveDocument==NativeDocument&&NativePlan!=null,"INVALID_HOST","No owned native plan.");
   var db=NativeDocument.Database;Require(NativePlan.units=="mm"&&db.Insunits==UnitsValue.Millimeters,"UNITS_UNKNOWN","Native edits require declared millimeters.");
   var module=System.Diagnostics.Process.GetCurrentProcess().Modules.Cast<System.Diagnostics.ProcessModule>().FirstOrDefault(m=>String.Equals(m.ModuleName,"tch_pipebase.arx",StringComparison.OrdinalIgnoreCase));
   string expected=Path.Combine(Environment.GetEnvironmentVariable("TArchFolder")??"","sys24x64","tch_PipeBase.arx");
   Require(module!=null&&String.Equals(Path.GetFullPath(module.FileName),Path.GetFullPath(expected),StringComparison.OrdinalIgnoreCase),"NATIVE_MODULE_MISMATCH","The full selected Tangent pipe module must be loaded; object enablers do not support this workflow.");
   File.WriteAllText(Path.Combine(Path.GetDirectoryName(NativeRequest),"native-runtime.json"),Json.Serialize(new{module=module.ModuleName,path=module.FileName}),new System.Text.UTF8Encoding(false));
   NativeChanges=new List<object>();NativeStepIndex=0;NativeFingerprint=NativeDigest(NativePlan);Guid guid;Require(Guid.TryParse(NativePlan.requestId,out guid),"INVALID_REQUEST_ID","Expected UUID.");NativeTaskKey="CADAGENT_TASK_"+guid.ToString("N");
   using(var tr=db.TransactionManager.StartOpenCloseTransaction()){
    var nod=(DBDictionary)tr.GetObject(db.NamedObjectsDictionaryId,OpenMode.ForRead);var state=(State)Read(nod,StateKey,tr,typeof(State));Require(state!=null&&state.documentId==NativePlan.documentId,"DOCUMENT_MISMATCH","Document identity differs.");
    var task=(TaskRecord)Read(nod,NativeTaskKey,tr,typeof(TaskRecord));if(task!=null){Require(task.fingerprint==NativeFingerprint,"REQUEST_ID_CONFLICT","UUID reused with different native operations.");NativeReplay=true;return;}
    Require(state.revision==NativePlan.expectedRevision,"STALE_REVISION","Expected revision differs from DWG state.");
   }
   NativeBefore=NativeSignatures(db);NativeStepBefore=NativeBefore;NativeRootsBefore=ModelRoots(db);NativeStepRoots=NativeRootsBefore;Require((Convert.ToInt32(App.GetSystemVariable("UNDOCTL"))&1)!=0,"NATIVE_UNDO_UNAVAILABLE","Undo recording is required.");
   NativeOsnap=App.GetSystemVariable("OSMODE");NativeEcho=App.GetSystemVariable("CMDECHO");NativeUcs=NativeDocument.Editor.CurrentUserCoordinateSystem;NativeSettings=true;App.SetSystemVariable("OSMODE",0);App.SetSystemVariable("CMDECHO",1);NativeDocument.Editor.CurrentUserCoordinateSystem=Matrix3d.Identity;
   NativeDocument.Editor.Command("_.UNDO","_Begin");NativeUndo=true;
  }catch(System.Exception ex){NativeRecordError(ex);}}
  [CommandMethod("CADBRIDGENATIVESTEP",CommandFlags.Modal)] public static void NativeStep(){if(NativeFault!=null||NativeReplay)return;try{
   Require(App.DocumentManager.MdiActiveDocument==NativeDocument&&NativeStepIndex<NativePlan.operations.Length,"INVALID_HOST","Unexpected native step.");var db=NativeDocument.Database;var op=NativePlan.operations[NativeStepIndex];
   if(op.type=="create_native_tray"){
    var p=Point(op.fromPoint);var q=Point(op.toPoint);Require(p.DistanceTo(q)>1e-6,"INVALID_ARGUMENT","Distinct WCS points required.");var after=NativeSignatures(db);var added=after.Keys.Except(NativeStepBefore.Keys).ToArray();Require(added.Length==1&&NativeStepBefore.All(pair=>after.ContainsKey(pair.Key)&&after[pair.Key]==pair.Value),"NATIVE_POSTCONDITION_FAILED","Expected exactly one independent tray without modifying existing trays.");
    string handle=added[0];var roots=ModelRoots(db);Require(roots.SetEquals(NativeStepRoots.Concat(new[]{handle})),"NATIVE_ASSEMBLY_UNSUPPORTED","Native command added or removed other model objects; connected fittings are not supported in this batch.");SizeTray(db,handle,op.width,op.height,op.nativeModel);var obj=NativeTrayCom(db,handle);ComPut(obj,"StartEl",0);ComPut(obj,"EndEl",0);
    using(var tr=db.TransactionManager.StartOpenCloseTransaction()){var c=(Curve)ByHandle(db,tr,handle);Require(c.StartPoint.DistanceTo(p)<1e-5&&c.EndPoint.DistanceTo(q)<1e-5,"NATIVE_POSTCONDITION_FAILED","Native endpoints differ from requested millimeters.");}
    NativeChanges.Add(new{type=op.type,handle=handle,nativeClass="TDbECabletry",widthMm=op.width,heightMm=op.height});
   }else if(op.type=="add_native_tray_label"){
    var roots=ModelRoots(db);var added=roots.Except(NativeStepRoots).ToArray();Require(added.Length==1&&NativeStepRoots.All(roots.Contains),"NATIVE_POSTCONDITION_FAILED","Expected exactly one native label without removing model objects.");
    using(var tr=db.TransactionManager.StartOpenCloseTransaction()){var label=ByHandle(db,tr,added[0]);Require(label.GetRXClass().DxfName=="TCH_CABLEDIM"&&label.GetRXClass().Name=="TDbCableDim"&&label.GetPersistentReactorIds().Cast<ObjectId>().Any(id=>String.Equals(id.Handle.ToString(),op.handle,StringComparison.OrdinalIgnoreCase)),"NATIVE_ASSOCIATION_FAILED","Native label is not associated with the selected tray.");}
    NativeChanges.Add(new{type=op.type,handle=added[0],trayHandle=op.handle,nativeClass="TDbCableDim"});
   }else{SizeTray(db,op.handle,op.width,op.height,op.nativeModel);NativeChanges.Add(new{type=op.type,handle=op.handle,widthMm=op.width,heightMm=op.height});}
   NativeStepBefore=NativeSignatures(db);NativeStepRoots=ModelRoots(db);NativeStepIndex++;
  }catch(System.Exception ex){NativeRecordError(ex);}}
  [CommandMethod("CADBRIDGENATIVEEND",CommandFlags.Modal)] public static void NativeEnd(){try{
   string job=Path.GetDirectoryName(NativeRequest);Execute(NativeRequest,Path.Combine(job,"response.json"),Path.Combine(job,"output.dwg"),Path.Combine(job,"output.dxf"));
  }catch(System.Exception ex){NativeEntryFailure(ex);}finally{try{if(NativeSettings){App.SetSystemVariable("OSMODE",NativeOsnap);App.SetSystemVariable("CMDECHO",NativeEcho);NativeDocument.Editor.CurrentUserCoordinateSystem=NativeUcs;NativeSettings=false;}}catch(System.Exception ex){NativeEntryFailure(ex);}NativeSignal();}}
  static void NativeSignal(){try{
   if(NativeRequest==null)return;string job=Path.GetDirectoryName(NativeRequest),response=Path.Combine(job,"response.json");if(!File.Exists(response))return;
   var request=NativePlan??Json.Deserialize<Request>(File.ReadAllText(NativeRequest));string sha;using(var algorithm=System.Security.Cryptography.SHA256.Create())using(var stream=File.OpenRead(response))sha=BitConverter.ToString(algorithm.ComputeHash(stream)).Replace("-","").ToLowerInvariant();
   string marker=Path.Combine(job,"native-complete.json"),pending=Path.Combine(job,"native-complete.pending");
   File.WriteAllText(pending,Json.Serialize(new{requestId=request.requestId,responseSHA256=sha}),new System.Text.UTF8Encoding(false));File.Move(pending,marker);
  }catch{}}
  static void NativeEntryFailure(System.Exception ex){
   var doc=App.DocumentManager.MdiActiveDocument;doc.Editor.WriteMessage("\nCADBRIDGE_NATIVE_ENTRY_ERROR: "+ex+"\n");
   if(NativeRequest!=null)try{string job=Path.GetDirectoryName(NativeRequest),response=Path.Combine(job,"response.json");if(!File.Exists(response))File.WriteAllText(response,Json.Serialize(new{ok=false,error=new{code="NATIVE_HOST_START_FAILED",message=ex.Message},drawingSaved=false}),System.Text.Encoding.UTF8);else File.WriteAllText(Path.Combine(job,"native-entry-error.log"),ex.ToString());}catch{}
  }
  static bool IsNativeOperation(string type){return type=="create_native_tray"||type=="set_native_tray_size"||type=="add_native_tray_label";}
  static object ComGet(object obj,string name){return obj.GetType().InvokeMember(name,BindingFlags.GetProperty,null,obj,null,CultureInfo.InvariantCulture);}
  static void ComPut(object obj,string name,object value){obj.GetType().InvokeMember(name,BindingFlags.SetProperty,null,obj,new object[]{value},CultureInfo.InvariantCulture);}
  static object NativeTrayProperties(Entity e){
   try{var obj=e.AcadObject;return new{available=true,widthMm=Convert.ToDouble(ComGet(obj,"Width"),CultureInfo.InvariantCulture),heightMm=Convert.ToDouble(ComGet(obj,"Height"),CultureInfo.InvariantCulture),style=Convert.ToString(ComGet(obj,"Style"),CultureInfo.InvariantCulture),model=Convert.ToString(ComGet(obj,"Type"),CultureInfo.InvariantCulture),source="Tangent V8 IDispatch properties; native host required"};}
   catch(System.Exception ex){return new{available=false,reason=ex.Message};}
  }
  static string Coordinate(double[] p){var v=Point(p);return v.X.ToString("R",CultureInfo.InvariantCulture)+","+v.Y.ToString("R",CultureInfo.InvariantCulture)+",0";}
  static object NativeLabelProperties(Entity e){
   double? height=null;try{height=Convert.ToDouble(ComGet(e.AcadObject,"TextHeight"),CultureInfo.InvariantCulture);}catch{}
   return new{nativeClass=e.GetRXClass().Name,targetHandles=e.GetPersistentReactorIds().Cast<ObjectId>().Select(id=>id.Handle.ToString()).OrderBy(s=>s).ToArray(),textHeight=height,textInspection="Use actual cad_export PDF/PNG; this native class does not expose rendered text through Explode or its COM interface."};
  }
  static Dictionary<string,string> NativeSignatures(Database db){
   using(var tr=db.TransactionManager.StartOpenCloseTransaction()){
    return Entities(db,tr).Where(e=>e.GetRXClass().DxfName=="TCH_CABLETRY"||e.GetRXClass().DxfName=="TCH_CABLEDIM").ToDictionary(e=>e.Handle.ToString(),e=>e.GetRXClass().DxfName=="TCH_CABLEDIM"?Json.Serialize(NativeLabelProperties(e)):Json.Serialize(new{properties=NativeTrayProperties(e),start=XY(((Curve)e).StartPoint),end=XY(((Curve)e).EndPoint),reactors=e.GetPersistentReactorIds().Cast<ObjectId>().Select(id=>id.Handle.ToString()).ToArray()}));
   }
  }
  static HashSet<string> ModelRoots(Database db){using(var tr=db.TransactionManager.StartOpenCloseTransaction())return new HashSet<string>(Entities(db,tr).Select(e=>e.Handle.ToString()));}
  static bool StraightNative(Curve c){try{return c!=null&&c.StartPoint.DistanceTo(c.EndPoint)>1e-6&&Math.Abs(c.StartPoint.Z)<1e-8&&Math.Abs(c.EndPoint.Z)<1e-8&&Math.Abs(c.GetDistanceAtParameter(c.EndParam)-c.GetDistanceAtParameter(c.StartParam)-c.StartPoint.DistanceTo(c.EndPoint))<1e-5;}catch{return false;}}
  static double SegmentDistance(Point3d p,Point3d a,Point3d b){var v=b-a;double t=Math.Max(0,Math.Min(1,(p-a).DotProduct(v)/v.DotProduct(v)));return p.DistanceTo(a+v*t);}
  static double SegmentGap(Point3d a,Point3d b,Point3d c,Point3d d){
   double ab1=(b-a).CrossProduct(c-a).Z,ab2=(b-a).CrossProduct(d-a).Z,cd1=(d-c).CrossProduct(a-c).Z,cd2=(d-c).CrossProduct(b-c).Z;
   if(ab1*ab2<=0&&cd1*cd2<=0&&Math.Max(Math.Min(a.X,b.X),Math.Min(c.X,d.X))<=Math.Min(Math.Max(a.X,b.X),Math.Max(c.X,d.X))&&Math.Max(Math.Min(a.Y,b.Y),Math.Min(c.Y,d.Y))<=Math.Min(Math.Max(a.Y,b.Y),Math.Max(c.Y,d.Y)))return 0;
   return Math.Min(Math.Min(SegmentDistance(a,c,d),SegmentDistance(b,c,d)),Math.Min(SegmentDistance(c,a,b),SegmentDistance(d,a,b)));
  }
  static void NativeSeparation(Database db,Curve target,double width,string skip){
   using(var tr=db.TransactionManager.StartOpenCloseTransaction())foreach(var e in Entities(db,tr)){
    string kind=e.GetRXClass().DxfName;if((kind!="TCH_CABLETRY"&&kind!="TCH_EFITTING")||String.Equals(e.Handle.ToString(),skip,StringComparison.OrdinalIgnoreCase))continue;
    var c=e as Curve;
    if(kind=="TCH_CABLETRY"&&StraightNative(c)){
     double gap=SegmentGap(target.StartPoint,target.EndPoint,c.StartPoint,c.EndPoint);
     Require(gap>(width+Convert.ToDouble(ComGet(e.AcadObject,"Width"),CultureInfo.InvariantCulture))/2+1,"NATIVE_ASSEMBLY_UNSUPPORTED","Connected, intersecting or touching native trays require a separate fitting workflow.");
    }else{
     var a=target.GeometricExtents;var b=e.GeometricExtents;double margin=width/2+1;
     Require(a.MaxPoint.X+margin<b.MinPoint.X||a.MinPoint.X-margin>b.MaxPoint.X||a.MaxPoint.Y+margin<b.MinPoint.Y||a.MinPoint.Y-margin>b.MaxPoint.Y,"NATIVE_ASSEMBLY_UNSUPPORTED","Unsupported native fittings or curved trays overlap the requested operation.");
    }
   }
  }
  static object NativeTrayCom(Database db,string handle){using(var tr=db.TransactionManager.StartOpenCloseTransaction()){
   var e=ByHandle(db,tr,handle);Require(!(e is ProxyEntity)&&e.GetRXClass().DxfName=="TCH_CABLETRY"&&e.GetRXClass().Name=="TDbECabletry","NATIVE_TYPE_UNSUPPORTED","Expected a loaded Tangent V8 cable tray.");
   Require(StraightNative(e as Curve),"NATIVE_TYPE_UNSUPPORTED","Only straight planar native trays are supported.");
   var layer=(LayerTableRecord)tr.GetObject(e.LayerId,OpenMode.ForRead);Require(!layer.IsLocked&&!layer.IsDependent,"LAYER_LOCKED",e.Layer);
   var obj=e.AcadObject;Require(Convert.ToString(ComGet(obj,"Style"),CultureInfo.InvariantCulture)=="槽式桥架","NATIVE_STYLE_UNSUPPORTED","Only the installed channel tray family is supported.");NativeSeparation(db,(Curve)e,Convert.ToDouble(ComGet(obj,"Width"),CultureInfo.InvariantCulture),handle);return obj;
  }}
  static void SizeTray(Database db,string handle,double width,double height,string model){
   Require(!Double.IsNaN(width)&&!Double.IsNaN(height)&&width>0&&height>0&&width<=10000&&height<=10000,"INVALID_ARGUMENT","Tray width and height must be 0..10000 mm.");
   var obj=NativeTrayCom(db,handle);using(var tr=db.TransactionManager.StartOpenCloseTransaction())NativeSeparation(db,(Curve)ByHandle(db,tr,handle),width,handle);Require(model!=null&&System.Text.RegularExpressions.Regex.IsMatch(model,@"\AC-01-[0-9.-]{1,32}\z"),"NATIVE_CATALOG_INVALID","Verified native catalog model required.");ComPut(obj,"Type",model);ComPut(obj,"Width",width);ComPut(obj,"Height",height);
   Require(Convert.ToString(ComGet(obj,"Type"),CultureInfo.InvariantCulture)==model&&Math.Abs(Convert.ToDouble(ComGet(obj,"Width"),CultureInfo.InvariantCulture)-width)<1e-6&&Math.Abs(Convert.ToDouble(ComGet(obj,"Height"),CultureInfo.InvariantCulture)-height)<1e-6,"NATIVE_POSTCONDITION_FAILED","Native tray dimensions did not match the request.");
  }
  static bool NativeEdit(Document doc,Request request,List<object> changes){
   Require(doc==NativeDocument&&NativePlan!=null,"NATIVE_HOST_REQUIRED","Use the owned native command host.");
   if(NativeFault!=null){if(NativeUndo&&NativeBefore!=null){var after=NativeSignatures(doc.Database);Require(NativeRootsBefore.SetEquals(ModelRoots(doc.Database))&&NativeBefore.Count==after.Count&&NativeBefore.All(pair=>after.ContainsKey(pair.Key)&&after[pair.Key]==pair.Value),"NATIVE_ROLLBACK_FAILED","Native undo did not restore the model snapshot; no output will be published.");}throw NativeFault;}
   Require(NativeDigest(request)==NativeFingerprint,"REQUEST_ID_CONFLICT","Native plan changed before commit.");if(NativeReplay)return true;
   Require(NativeStepIndex==request.operations.Length,"NATIVE_BATCH_INCOMPLETE","Native batch did not finish.");
   using(var tr=doc.Database.TransactionManager.StartTransaction()){
    var nod=(DBDictionary)tr.GetObject(doc.Database.NamedObjectsDictionaryId,OpenMode.ForRead);var state=(State)Read(nod,StateKey,tr,typeof(State));Require(state.documentId==request.documentId&&state.revision==request.expectedRevision,"STALE_REVISION","Document changed during native batch.");state.revision++;Write(nod,StateKey,state,tr);Write(nod,NativeTaskKey,new TaskRecord{fingerprint=NativeFingerprint,revision=state.revision},tr);tr.Commit();
   }
   changes.AddRange(NativeChanges);return false;
  }
 }
}

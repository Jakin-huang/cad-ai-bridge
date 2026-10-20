using System;
using System.IO;
using System.Linq;
using System.Text;
using System.Security.Cryptography;
using System.Collections.Generic;
using System.Web.Script.Serialization;
using Autodesk.AutoCAD.DatabaseServices;
using Autodesk.AutoCAD.Geometry;
using Autodesk.AutoCAD.Runtime;
using Autodesk.AutoCAD.ApplicationServices;
using App = Autodesk.AutoCAD.ApplicationServices.Core.Application;

[assembly: CommandClass(typeof(CadAgent.Commands))]
namespace CadAgent
{
    public sealed class Request
    {
        public string action, requestId, documentId, units, adapter;
        public int expectedRevision;
        public Operation[] operations;
        public Scene scene;
        public EntityFilter filter;
        public QueryScope scope;
        public int limit;
        public bool exportDxf;
        public PlotContract plot;
        public string format,layout;
        public QueryRegion region;
    }
    public sealed class Operation
    {
        public string type, blockName, id, circuitId, prefix, templateHandle, layer;
        public Instance[] instances;
        public string[] ids;
        public double[][] vertices;
        public Endpoint from, to;
        public int start;
        public WireSpec wireSpec;
        public string[] handles;
        public string handle,name,text,kind,endpoint,nativeModel;
        public double[] delta,center,axisStart,axisEnd,fromPoint,toPoint,position,landingPoint;
        public double angleRadians,factor,distance,rotationRadians,height,rowSpacing,columnSpacing;
        public int rows,columns,color;
        public double width;
        public bool copy;
        public bool? locked,off;
        public Dictionary<string,string> attributes;
        public Primitive[] entities;
    }
    public sealed class WireSpec { public string wireType, conductorSpec, method, installation, conduitDiameter; }
    public sealed class Endpoint { public string id, port; }
    public sealed class Instance
    {
        public string id, layer;
        public double[] position;
        public double[] portOffset;
        public double rotationRadians;
        public Dictionary<string,string> attributes;
    }
    public sealed class State { public string documentId, adapter; public int revision; }
    public sealed class Meta { public string kind, id, circuitId, from, to, templateHandle; public double[] portOffset; }
    public sealed class TaskRecord { public string fingerprint; public int revision; }
    // Preserve the serialized v0.2 operation shape for UUIDs already stored in DWGs.
    public sealed class LegacyOperation {
        public string type,blockName,id,circuitId,prefix,templateHandle,layer;
        public Instance[] instances; public string[] ids; public double[][] vertices;
        public Endpoint from,to; public int start,width; public WireSpec wireSpec;
    }
    public sealed class LegacyRequest { public string documentId,units; public LegacyOperation[] operations; }
    // Keep preview.4 ordinary-edit fingerprints stable as native DTO fields grow.
    public sealed class EditingOperationV4 {
        public string type,blockName,id,circuitId,prefix,templateHandle,layer;
        public Instance[] instances; public string[] ids; public double[][] vertices;
        public Endpoint from,to; public int start; public WireSpec wireSpec;
        public string[] handles; public string handle,name,text,kind,endpoint;
        public double[] delta,center,axisStart,axisEnd,fromPoint,toPoint,position;
        public double angleRadians,factor,distance,rotationRadians,height,rowSpacing,columnSpacing;
        public int rows,columns,color; public double width; public bool copy;
        public bool? locked,off; public Dictionary<string,string> attributes; public Primitive[] entities;
    }
    public sealed class EditingRequestV4 { public string documentId,units; public EditingOperationV4[] operations; }
    public sealed class Fault : System.Exception
    {
        public readonly string Code;
        public Fault(string code,string message):base(message){Code=code;}
    }
    public static partial class Commands
    {
        static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength=16777216, RecursionLimit=50 };
        const string StateKey="CADAGENT_STATE", MetaKey="CADAGENT_ENTITY";
        static void Require(bool ok,string code,string message){if(!ok)throw new Fault(code,message);}
        static string Hash(string text){using(var h=SHA256.Create())return BitConverter.ToString(h.ComputeHash(Encoding.UTF8.GetBytes(text))).Replace("-","").ToLowerInvariant();}
        static void Id(string id){Require(id!=null && System.Text.RegularExpressions.Regex.IsMatch(id,@"\A[A-Za-z0-9_-]{1,64}\z"),"INVALID_ID","IDs must be 1..64 ASCII letters, digits, '_' or '-'.");}
        static Point3d Point(double[] a)
        {
            Require(a!=null && a.Length==3 && a.All(v=>!Double.IsNaN(v)&&!Double.IsInfinity(v)&&Math.Abs(v)<=1e9) && Math.Abs(a[2])<1e-8,"INVALID_POINT","Expected finite WCS [x,y,0] in mm.");
            return new Point3d(a[0],a[1],a[2]);
        }
        static object Read(DBDictionary dict,string key,Transaction tr,Type type)
        {
            if(!dict.Contains(key))return null;
            var xr=(Xrecord)tr.GetObject(dict.GetAt(key),OpenMode.ForRead);
            using(var buffer=xr.Data)
            {
                if(buffer==null)return null;
                var bytes=buffer.AsArray().SelectMany(v=>(byte[])v.Value).ToArray();
                return Json.Deserialize(Encoding.UTF8.GetString(bytes),type);
            }
        }
        static void Write(DBDictionary dict,string key,object value,Transaction tr)
        {
            if(!dict.IsWriteEnabled)dict.UpgradeOpen();
            Xrecord xr;
            if(dict.Contains(key))xr=(Xrecord)tr.GetObject(dict.GetAt(key),OpenMode.ForWrite);
            else {xr=new Xrecord();dict.SetAt(key,xr);tr.AddNewlyCreatedDBObject(xr,true);}
            var bytes=Encoding.UTF8.GetBytes(Json.Serialize(value));
            var values=new List<TypedValue>();
            for(int i=0;i<bytes.Length;i+=127){int n=Math.Min(127,bytes.Length-i);var chunk=new byte[n];Array.Copy(bytes,i,chunk,0,n);values.Add(new TypedValue((int)DxfCode.BinaryChunk,chunk));}
            using(var buffer=new ResultBuffer(values.ToArray()))xr.Data=buffer;
        }
        static void Mark(Entity e,Meta meta,Transaction tr)
        {
            if(e.ExtensionDictionary.IsNull)e.CreateExtensionDictionary();
            Write((DBDictionary)tr.GetObject(e.ExtensionDictionary,OpenMode.ForWrite),MetaKey,meta,tr);
        }
        static Meta Metadata(Entity e,Transaction tr)
        {
            if(e.ExtensionDictionary.IsNull)return null;
            return (Meta)Read((DBDictionary)tr.GetObject(e.ExtensionDictionary,OpenMode.ForRead),MetaKey,tr,typeof(Meta));
        }
        static BlockTableRecord Model(Database db,Transaction tr,OpenMode mode)
        {
            var bt=(BlockTable)tr.GetObject(db.BlockTableId,OpenMode.ForRead);
            return (BlockTableRecord)tr.GetObject(bt[BlockTableRecord.ModelSpace],mode);
        }
        static IEnumerable<Entity> Entities(Database db,Transaction tr)
        {
            foreach(ObjectId id in Model(db,tr,OpenMode.ForRead))
            {
                if(id.IsErased)continue;
                var e=tr.GetObject(id,OpenMode.ForRead) as Entity;
                if(e!=null)yield return e;
            }
        }
        static Dictionary<string,Entity> Index(Database db,Transaction tr)
        {
            var items=new Dictionary<string,Entity>(StringComparer.Ordinal);
            foreach(var e in Entities(db,tr)){var m=Metadata(e,tr);if(m!=null){Require(!items.ContainsKey(m.id),"DUPLICATE_ID","Duplicate persistent entity ID.");items.Add(m.id,e);}}
            return items;
        }
        static Dictionary<string,string> Attributes(BlockReference br,Transaction tr)
        {
            var values=new Dictionary<string,string>(StringComparer.OrdinalIgnoreCase);
            foreach(ObjectId id in br.AttributeCollection){var a=(AttributeReference)tr.GetObject(id,OpenMode.ForRead);values[a.Tag]=a.TextString;}
            return values;
        }
        static void Layer(Database db,Transaction tr,string name,short color)
        {
            var lt=(LayerTable)tr.GetObject(db.LayerTableId,OpenMode.ForRead);
            if(lt.Has(name)){var existing=(LayerTableRecord)tr.GetObject(lt[name],OpenMode.ForRead);Require(!existing.IsLocked,"LAYER_LOCKED",name+" is locked.");return;}
            lt.UpgradeOpen();var layer=new LayerTableRecord{Name=name,Color=Autodesk.AutoCAD.Colors.Color.FromColorIndex(Autodesk.AutoCAD.Colors.ColorMethod.ByAci,color)};
            lt.Add(layer);tr.AddNewlyCreatedDBObject(layer,true);
        }
        static void Append(BlockTableRecord record,Entity e,Transaction tr){record.AppendEntity(e);tr.AddNewlyCreatedDBObject(e,true);}
        static void Fixture(Database db,Transaction tr)
        {
            var bt=(BlockTable)tr.GetObject(db.BlockTableId,OpenMode.ForWrite);
            Require(!bt.Has("EA_LIGHT"),"SYMBOL_EXISTS","Fixture symbol already exists.");
            var block=new BlockTableRecord{Name="EA_LIGHT",Units=UnitsValue.Millimeters};
            bt.Add(block);tr.AddNewlyCreatedDBObject(block,true);
            Append(block,new Circle(Point3d.Origin,Vector3d.ZAxis,150),tr);
            Append(block,new Line(new Point3d(-106,-106,0),new Point3d(106,106,0)),tr);
            Append(block,new Line(new Point3d(-106,106,0),new Point3d(106,-106,0)),tr);
            Append(block,new AttributeDefinition{Tag="DEVICE_ID",Prompt="Device ID",TextString="",Position=new Point3d(210,160,0),Height=120},tr);
            Append(block,new AttributeDefinition{Tag="MODEL",Prompt="Model",TextString="TEST-LED",Position=new Point3d(210,-100,0),Height=90},tr);
        }
        static void Place(Database db,Transaction tr,Operation op,Dictionary<string,Entity> index,bool tangent)
        {
            Require(op.instances!=null && op.instances.Length>0 && op.instances.Length<=2000,"INVALID_ARGUMENT","Expected 1..2000 symbol instances.");
            var bt=(BlockTable)tr.GetObject(db.BlockTableId,OpenMode.ForRead);
            Require(op.blockName!=null && bt.Has(op.blockName),"SYMBOL_NOT_FOUND","Unknown block definition: "+op.blockName);
            var definition=(BlockTableRecord)tr.GetObject(bt[op.blockName],OpenMode.ForRead);
            Require(!definition.IsFromExternalReference && !definition.IsDynamicBlock,"SYMBOL_UNSUPPORTED","MVP supports ordinary local block definitions.");
            Require(definition.Units==UnitsValue.Millimeters,"SYMBOL_UNITS_UNSUPPORTED","MVP requires a block definition explicitly declared in millimeters.");
            var defs=new List<AttributeDefinition>();
            foreach(ObjectId id in definition){var ad=tr.GetObject(id,OpenMode.ForRead) as AttributeDefinition;if(ad!=null&&!ad.Constant)defs.Add(ad);}
            Layer(db,tr,"E-LIGHT",2);
            var model=Model(db,tr,OpenMode.ForWrite);
            foreach(var item in op.instances)
            {
                Id(item.id);Require(!index.ContainsKey(item.id),"DUPLICATE_ID",item.id+" already exists.");
                Require(!Double.IsNaN(item.rotationRadians)&&!Double.IsInfinity(item.rotationRadians),"INVALID_ARGUMENT","Rotation must be finite radians.");
                var attrs=item.attributes??new Dictionary<string,string>();
                foreach(var tag in attrs.Keys)Require(defs.Any(a=>String.Equals(a.Tag,tag,StringComparison.OrdinalIgnoreCase)),"ATTRIBUTE_NOT_FOUND","Unknown attribute: "+tag);
                string placementLayer=item.layer??"E-LIGHT";Layer(db,tr,placementLayer,2);
                var br=new BlockReference(Point(item.position),definition.ObjectId){Rotation=item.rotationRadians,Layer=placementLayer};
                Append(model,br,tr);
                foreach(var ad in defs)
                {
                    var ar=new AttributeReference();ar.SetAttributeFromBlock(ad,br.BlockTransform);
                    ar.TextString=attrs.Where(p=>String.Equals(p.Key,ad.Tag,StringComparison.OrdinalIgnoreCase)).Select(p=>p.Value).FirstOrDefault()??ad.TextString;
                    br.AttributeCollection.AppendAttribute(ar);tr.AddNewlyCreatedDBObject(ar,true);
                }
                Mark(br,new Meta{kind="device",id=item.id},tr);index.Add(item.id,br);
                if(tangent)TangentAdapter.MarkNewDevice(db,tr,br);
            }
        }
        static Point3d Port(BlockReference br,Transaction tr){var meta=Metadata(br,tr);return meta!=null&&meta.portOffset!=null?Point(meta.portOffset).TransformBy(br.BlockTransform):br.Position;}
        static void CloneProject(Database db,Transaction tr,Operation op,Dictionary<string,Entity> index){
            ObjectId sourceId;try{sourceId=db.GetObjectId(false,new Handle(Convert.ToInt64(op.templateHandle,16)),0);}catch{throw new Fault("TEMPLATE_NOT_FOUND","Template handle does not exist in this DWG.");}
            var source=tr.GetObject(sourceId,OpenMode.ForRead) as BlockReference;
            Require(source!=null&&source.OwnerId==Model(db,tr,OpenMode.ForRead).ObjectId&&!source.IsDynamicBlock,"TEMPLATE_UNSUPPORTED","Template must be an ordinary root-level local block instance.");
            var definition=(BlockTableRecord)tr.GetObject(source.BlockTableRecord,OpenMode.ForRead);
            Require(!definition.IsFromExternalReference&&Metadata(source,tr)==null,"TEMPLATE_UNSUPPORTED","Select an unmodified local engineering template.");
            var data=TangentAdapter.Data(source);string category=TangentAdapter.Category(data);
            Require(category=="lighting"||category=="socket","TEMPLATE_UNVERIFIED","Engineering cloning is currently verified for lighting and socket instances only.");
            Require(source.ExtensionDictionary.IsNull&&source.GetPersistentReactorIds().Count==0&&!data.Keys.Any(k=>k=="KeyExtWire"||k=="KeyOwnWireId"||k=="bradata"||k=="Element"),"TEMPLATE_ASSOCIATIONS_UNSUPPORTED","Linked vendor dictionaries/reactors and topology identifiers need a dedicated cloning adapter.");
            Require(source.Normal.IsEqualTo(Vector3d.ZAxis)&&Math.Abs(source.Position.Z)<1e-8,"TEMPLATE_UNSUPPORTED","Planar WCS XY templates only.");
            Require(op.instances!=null&&op.instances.Length>0&&op.instances.Length<=100,"INVALID_ARGUMENT","Expected 1..100 project instances.");
            foreach(var item in op.instances){Id(item.id);Require(!index.ContainsKey(item.id),"DUPLICATE_ID",item.id);var position=Point(item.position);Point(item.portOffset);
                Require(!Double.IsNaN(item.rotationRadians)&&!Double.IsInfinity(item.rotationRadians),"INVALID_ARGUMENT","Finite rotation required.");
                var mapping=new IdMapping();db.DeepCloneObjects(new ObjectIdCollection(new[]{sourceId}),Model(db,tr,OpenMode.ForRead).ObjectId,mapping,false);
                var clone=(BlockReference)tr.GetObject(mapping[sourceId].Value,OpenMode.ForWrite);
                var transform=Matrix3d.Displacement(position-source.Position)*Matrix3d.Rotation(item.rotationRadians-source.Rotation,Vector3d.ZAxis,source.Position);
                clone.TransformBy(transform);
                foreach(ObjectId aid in clone.AttributeCollection){var attr=(AttributeReference)tr.GetObject(aid,OpenMode.ForWrite);if(attr.Tag.Equals("DEVICE_ID",StringComparison.OrdinalIgnoreCase))attr.TextString="";}
                foreach(var field in item.attributes??new Dictionary<string,string>()){bool found=false;foreach(ObjectId aid in clone.AttributeCollection){var attr=(AttributeReference)tr.GetObject(aid,OpenMode.ForRead);if(attr.Tag.Equals(field.Key,StringComparison.OrdinalIgnoreCase)){attr.UpgradeOpen();attr.TextString=field.Value;found=true;}}Require(found,"ATTRIBUTE_NOT_FOUND",field.Key);}
                Mark(clone,new Meta{kind="device",id=item.id,templateHandle=op.templateHandle,portOffset=item.portOffset},tr);index.Add(item.id,clone);
            }
        }
        static void Number(Database db,Transaction tr,Operation op,Dictionary<string,Entity> index)
        {
            Require(op.ids!=null&&op.ids.Length>0&&op.ids.Distinct().Count()==op.ids.Length,"INVALID_ARGUMENT","Numbering requires distinct device IDs.");
            Require(op.prefix!=null&&op.prefix.Length<=32&&op.start>=0&&op.width>=1&&op.width<=9,"INVALID_ARGUMENT","Invalid numbering range.");
            var used=new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach(var pair in index){var br=pair.Value as BlockReference;if(br==null||op.ids.Contains(pair.Key))continue;var attrs=Attributes(br,tr);if(attrs.ContainsKey("DEVICE_ID")&&attrs["DEVICE_ID"]!="")used.Add(attrs["DEVICE_ID"]);}
            for(int i=0;i<op.ids.Length;i++)
            {
                Id(op.ids[i]);Require(index.ContainsKey(op.ids[i])&&index[op.ids[i]] is BlockReference,"DEVICE_NOT_FOUND",op.ids[i]);
                string number=op.prefix+checked(op.start+i).ToString("D"+op.width);
                Require(used.Add(number),"NUMBER_CONFLICT",number+" already exists.");
                var br=(BlockReference)index[op.ids[i]];bool found=false;
                foreach(ObjectId aid in br.AttributeCollection){var ar=(AttributeReference)tr.GetObject(aid,OpenMode.ForRead);if(ar.Tag.Equals("DEVICE_ID",StringComparison.OrdinalIgnoreCase)){ar.UpgradeOpen();ar.TextString=number;found=true;}}
                if(!found&&Metadata(br,tr).templateHandle!=null){
                    br.UpgradeOpen();var ar=new AttributeReference();ar.SetDatabaseDefaults(db);ar.Tag="DEVICE_ID";ar.TextString=number;ar.Layer=br.Layer;
                    var bounds=br.GeometricExtents;double span=Math.Max(bounds.MaxPoint.X-bounds.MinPoint.X,bounds.MaxPoint.Y-bounds.MinPoint.Y);
                    ar.Position=new Point3d(bounds.MaxPoint.X+Math.Max(50,span*.1),bounds.MaxPoint.Y+Math.Max(50,span*.1),0);ar.Height=Math.Max(30,Math.Min(200,span*.2));
                    br.AttributeCollection.AppendAttribute(ar);tr.AddNewlyCreatedDBObject(ar,true);found=true;
                }
                Require(found,"ATTRIBUTE_NOT_FOUND","DEVICE_ID missing from "+op.ids[i]);
            }
        }
        static void Connect(Database db,Transaction tr,Operation op,Dictionary<string,Entity> index,bool tangent)
        {
            Id(op.id);Require(!index.ContainsKey(op.id),"DUPLICATE_ID",op.id);
            Require(op.from!=null&&op.to!=null&&op.from.id!=op.to.id&&op.from.port=="PWR"&&op.to.port=="PWR","INVALID_PORT","Fixture ports must be PWR on distinct devices.");
            Require(index.ContainsKey(op.from.id)&&index[op.from.id] is BlockReference && index.ContainsKey(op.to.id)&&index[op.to.id] is BlockReference,"DEVICE_NOT_FOUND","Route endpoint not found.");
            Require(!String.IsNullOrWhiteSpace(op.circuitId)&&op.circuitId.Length<=64,"INVALID_ARGUMENT","Circuit ID required.");
            Require(op.vertices!=null&&op.vertices.Length>=2&&op.vertices.Length<=1000,"INVALID_PATH","Expected 2..1000 vertices.");
            var points=op.vertices.Select(Point).ToArray();
            Require(points[0].DistanceTo(Port((BlockReference)index[op.from.id],tr))<1e-6&&points[points.Length-1].DistanceTo(Port((BlockReference)index[op.to.id],tr))<1e-6,"DISCONNECTED_ROUTE","Path endpoints must match the explicitly defined connection anchors.");
            string routeLayer=op.layer??"E-WIRE";Layer(db,tr,routeLayer,3);var line=new Polyline{Layer=routeLayer};
            for(int i=0;i<points.Length;i++){if(i>0)Require(points[i].DistanceTo(points[i-1])>1e-6,"INVALID_PATH","Zero-length route segment.");line.AddVertexAt(i,new Point2d(points[i].X,points[i].Y),0,0,0);}
            Append(Model(db,tr,OpenMode.ForWrite),line,tr);
            Mark(line,new Meta{kind="route",id=op.id,circuitId=op.circuitId,from=op.from.id,to=op.to.id},tr);index.Add(op.id,line);
            Require(tangent||op.wireSpec==null,"WIRE_SPEC_UNSUPPORTED","Wire specifications require the tangent-v8 fixture adapter.");
            if(tangent)TangentAdapter.MarkNewWire(db,tr,line,op);
        }
        static object Inspect(Database db)
        {
            using(var tr=db.TransactionManager.StartOpenCloseTransaction())
            {
                var nod=(DBDictionary)tr.GetObject(db.NamedObjectsDictionaryId,OpenMode.ForRead);
                var state=(State)Read(nod,StateKey,tr,typeof(State));
                var devices=new List<object>();var routes=new List<object>();var numbers=new HashSet<string>(StringComparer.OrdinalIgnoreCase);var issues=new List<string>();
                var index=Index(db,tr);int excluded=0;double length=0;
                foreach(var e in Entities(db,tr))
                {
                    var m=Metadata(e,tr);if(m==null){excluded++;continue;}
                    var br=e as BlockReference;var line=e as Polyline;
                    if(m.kind=="device"&&br!=null)
                    {
                        var a=Attributes(br,tr);string n=a.ContainsKey("DEVICE_ID")?a["DEVICE_ID"]:"";
                        if(n=="")issues.Add("MISSING_NUMBER:"+m.id);else if(!numbers.Add(n))issues.Add("DUPLICATE_NUMBER:"+n);
                        var port=Port(br,tr);devices.Add(new{id=m.id,handle=br.Handle.ToString(),blockName=br.Name,position=new[]{br.Position.X,br.Position.Y,br.Position.Z},portPosition=new[]{port.X,port.Y,port.Z},templateHandle=m.templateHandle,attributes=a});
                    }
                    else if(m.kind=="route"&&line!=null)
                    {
                        length+=line.Length;
                        var vertices=new List<double[]>();for(int i=0;i<line.NumberOfVertices;i++){var p=line.GetPoint3dAt(i);vertices.Add(new[]{p.X,p.Y,p.Z});}
                        if(!index.ContainsKey(m.from)||!index.ContainsKey(m.to))issues.Add("DANGLING_ROUTE:"+m.id);
                        else if(!(index[m.from] is BlockReference)||!(index[m.to] is BlockReference)||line.StartPoint.DistanceTo(Port((BlockReference)index[m.from],tr))>1e-6||line.EndPoint.DistanceTo(Port((BlockReference)index[m.to],tr))>1e-6)issues.Add("DISCONNECTED_ROUTE:"+m.id);
                        routes.Add(new{id=m.id,handle=line.Handle.ToString(),circuitId=m.circuitId,from=m.from,to=m.to,lengthMm=line.Length,vertices=vertices});
                    }
                    else issues.Add("INVALID_ENTITY_METADATA:"+m.id);
                }
                var symbols=new List<object>();var blocks=(BlockTable)tr.GetObject(db.BlockTableId,OpenMode.ForRead);
                foreach(ObjectId bid in blocks){var b=(BlockTableRecord)tr.GetObject(bid,OpenMode.ForRead);if(b.IsLayout||b.IsAnonymous||b.IsFromExternalReference)continue;var tags=new List<string>();foreach(ObjectId aid in b){var a=tr.GetObject(aid,OpenMode.ForRead) as AttributeDefinition;if(a!=null)tags.Add(a.Tag);}symbols.Add(new{name=b.Name,attributeTags=tags,dynamic=b.IsDynamicBlock});}
                return new{documentId=state==null?null:state.documentId,revision=state==null?0:state.revision,adapter=state==null?null:state.adapter??"generic",units=db.Insunits.ToString(),deviceCount=devices.Count,routeCount=routes.Count,routeLengthMm=length,devices=devices,routes=routes,symbols=symbols,issues=issues,excludedTopLevelEntities=excluded,coverage="Top-level model-space CADAGENT entities only; nested blocks and xrefs excluded."};
            }
        }
        [CommandMethod("CADAGENTRUN",CommandFlags.Modal)]
        public static void Run()
        {
            Execute(Environment.GetEnvironmentVariable("CADAGENT_REQUEST"),Environment.GetEnvironmentVariable("CADAGENT_RESPONSE"),Environment.GetEnvironmentVariable("CADAGENT_OUTPUT"),Environment.GetEnvironmentVariable("CADAGENT_DXF"));
        }
        [CommandMethod("CADBRIDGERUNFILE",CommandFlags.Modal)]
        public static void RunFile()
        {
            var options=new Autodesk.AutoCAD.EditorInput.PromptStringOptions("\nRequest JSON file: "){AllowSpaces=true};
            var result=App.DocumentManager.MdiActiveDocument.Editor.GetString(options);
            if(result.Status!=Autodesk.AutoCAD.EditorInput.PromptStatus.OK)return;
            string request=Path.GetFullPath(result.StringResult),job=Path.GetDirectoryName(request);
            Require(Path.GetFileName(request)=="request.json","INVALID_JOB","Expected a host-created request.json job file.");
            Execute(request,Path.Combine(job,"response.json"),Path.Combine(job,"output.dwg"),Path.Combine(job,"output.dxf"));
        }
        [CommandMethod("CADBRIDGEOPENRUNFILE",CommandFlags.Session)]
        public static void OpenRunFile(){
            var bootstrap=App.DocumentManager.MdiActiveDocument;var editor=bootstrap.Editor;
            var result=editor.GetString(new Autodesk.AutoCAD.EditorInput.PromptStringOptions("\nRequest JSON file: "){AllowSpaces=true});
            if(result.Status!=Autodesk.AutoCAD.EditorInput.PromptStatus.OK)return;
            string request=Path.GetFullPath(result.StringResult),job=Path.GetDirectoryName(request);
            Require(Path.GetFileName(request)=="request.json","INVALID_JOB","Expected host request.json.");
            Require(String.Equals(Path.GetFullPath(bootstrap.Name),Path.Combine(job,"startup.dwg"),StringComparison.OrdinalIgnoreCase),"INVALID_HOST","Session entry requires the owned startup drawing.");
            var document=Autodesk.AutoCAD.ApplicationServices.DocumentCollectionExtension.Open(App.DocumentManager,Path.Combine(job,"input.dwg"),false);
            App.DocumentManager.MdiActiveDocument=document;
            using(document.LockDocument())Execute(request,Path.Combine(job,"response.json"),Path.Combine(job,"output.dwg"),Path.Combine(job,"output.dxf"));
            document.CloseAndDiscard();
            bootstrap.CloseAndDiscard();App.Quit();
        }
        static void Execute(string requestFile,string response,string output,string dxf)
        {
            var doc=App.DocumentManager.MdiActiveDocument;
            bool mutationCommitted=false,drawingSaved=false;
            string executingAction=null;
            var watch=System.Diagnostics.Stopwatch.StartNew();long last=0;string phase="input";
            var timings=new Dictionary<string,long>();
            Action<string> mark=next=>{long now=watch.ElapsedMilliseconds;timings[phase]=timings.ContainsKey(phase)?timings[phase]+now-last:now-last;last=now;phase=next;};
            try
            {
                string raw=File.ReadAllText(requestFile,Encoding.UTF8);
                Require(Encoding.UTF8.GetByteCount(raw)<=1048576,"REQUEST_TOO_LARGE","Request exceeds 1 MiB.");
                var request=Json.Deserialize<Request>(raw);Require(request!=null,"INVALID_ARGUMENT","Request required.");
                executingAction=request.action;
                var db=doc.Database;bool replay=false;bool repair=request.action=="repair_copy";bool writes=repair||request.action=="create_drawing"||request.action=="create_test_drawing"||request.action=="prepare_project"||request.action=="apply"||request.action=="edit";
                Require(writes||request.action=="query_entities"||request.action=="export"||request.action=="audit_drawing"||request.action=="inspect"||request.action=="takeoff"||request.action=="validate"||request.action=="tangent_inspect"||request.action=="tangent_takeoff"||request.action=="native_status","INVALID_ACTION","Unsupported action.");
                var changes=new List<object>();
                bool nativeBatch=request.action=="edit"&&request.operations!=null&&request.operations.Any(op=>op!=null&&IsNativeOperation(op.type));
                string selectedAdapter="generic";
                if(writes)
                {
                    mark("transaction");
                    Require(repair||request.units=="mm","UNITS_UNKNOWN","MVP requires explicit mm.");
                    Guid requestGuid;Require(Guid.TryParse(request.requestId,out requestGuid),"INVALID_REQUEST_ID","requestId must be a UUID.");
                    if(nativeBatch){replay=NativeEdit(doc,request,changes);mutationCommitted=true;}
                    else if(repair){db.Audit(true,true);mutationCommitted=true;}
                    else {
                    using(var tr=db.TransactionManager.StartTransaction())
                    {
                        var nod=(DBDictionary)tr.GetObject(db.NamedObjectsDictionaryId,OpenMode.ForRead);
                        var state=(State)Read(nod,StateKey,tr,typeof(State));
                        if(request.action=="prepare_project"){
                            Require(state==null,"ALREADY_MANAGED","Drawing already has managed state; inspect it instead.");
                            Require(db.Insunits==UnitsValue.Millimeters,"UNITS_UNKNOWN","Project preparation requires declared millimeter drawing units; no silent assumption.");
                            selectedAdapter="tangent-project";state=new State{documentId=Guid.NewGuid().ToString(),revision=0,adapter=selectedAdapter};Write(nod,StateKey,state,tr);
                        }
                        else if(request.action=="create_drawing")
                        {
                            Require(state==null&&!Entities(db,tr).Any(),"DRAWING_NOT_EMPTY","Scene creation requires a new empty drawing.");
                            db.Insunits=UnitsValue.Millimeters;SceneBuilder.Build(db,tr,request.scene);
                            state=new State{documentId=Guid.NewGuid().ToString(),revision=0,adapter="generic"};Write(nod,StateKey,state,tr);
                        }
                        else if(request.action=="create_test_drawing")
                        {
                            Require(state==null&&!Entities(db,tr).Any(),"DRAWING_NOT_EMPTY","Fixture initialization requires a new empty drawing.");
                            db.Insunits=UnitsValue.Millimeters;Layer(db,tr,"E-LIGHT",2);Layer(db,tr,"E-WIRE",3);Fixture(db,tr);
                            selectedAdapter=request.adapter??"generic";
                            Require(selectedAdapter=="generic"||selectedAdapter=="tangent-v8","ADAPTER_UNSUPPORTED","Unknown fixture adapter.");
                            if(selectedAdapter=="tangent-v8")TangentAdapter.DefineFixture(db,tr);
                            state=new State{documentId=Guid.NewGuid().ToString(),revision=0,adapter=selectedAdapter};Write(nod,StateKey,state,tr);
                        }
                        else
                        {
                            Require(state!=null&&request.documentId==state.documentId,"DOCUMENT_MISMATCH","Target document identity does not match.");
                            selectedAdapter=state.adapter??"generic";
                            Require(request.adapter==null||request.adapter==selectedAdapter,"ADAPTER_MISMATCH","Adapter does not match drawing state.");
                            Require(db.Insunits==UnitsValue.Millimeters,"UNITS_UNKNOWN","Drawing unit must be millimeters.");
                            Require(request.operations!=null&&request.operations.Length>0&&request.operations.Length<=100,"INVALID_ARGUMENT","Expected 1..100 operations.");
                            string key="CADAGENT_TASK_"+requestGuid.ToString("N");
                            object fingerprintOperations=request.operations;
                            if(request.operations.All(op=>op!=null&&(op.type=="place_symbols"||op.type=="clone_project_symbols"||op.type=="connect_route"||op.type=="number_devices")))fingerprintOperations=Json.Deserialize<LegacyRequest>(raw).operations;
                            else fingerprintOperations=Json.Deserialize<EditingRequestV4>(raw).operations;
                            string fingerprintPayload=Json.Serialize(new{request.documentId,request.units,operations=fingerprintOperations});
                            string fingerprint=Hash(fingerprintPayload);
                            File.WriteAllText(Path.Combine(Path.GetDirectoryName(response),"operation-fingerprint.json"),fingerprintPayload,new UTF8Encoding(false));
                            var task=(TaskRecord)Read(nod,key,tr,typeof(TaskRecord));
                            if(task!=null){Require(task.fingerprint==fingerprint,"REQUEST_ID_CONFLICT","UUID reused with different operations.");replay=true;}
                            else
                            {
                                Require(request.expectedRevision==state.revision,"STALE_REVISION","Expected revision differs from DWG state.");
                                var index=Index(db,tr);
                                foreach(var op in request.operations)
                                {
                                    Require(op!=null,"INVALID_ARGUMENT","Null operation.");
                                    if(op.type=="clone_project_symbols"){Require(selectedAdapter=="tangent-project","ADAPTER_MISMATCH","Project clone requires prepare_project output.");CloneProject(db,tr,op,index);}
                                    else if(op.type=="place_symbols")Place(db,tr,op,index,selectedAdapter=="tangent-v8");
                                    else if(op.type=="number_devices")Number(db,tr,op,index);
                                    else if(op.type=="connect_route")Connect(db,tr,op,index,selectedAdapter=="tangent-v8"||selectedAdapter=="tangent-project");
                                    else if(request.action=="edit")changes.Add(Edit(db,tr,op,index,selectedAdapter));
                                    else throw new Fault("INVALID_OPERATION","Unsupported operation: "+op.type);
                                }
                                if(request.action=="edit"){ValidateRoutes(index,tr);RefreshLabels(db,tr,index);}
                                // Number collision validation includes all managed device instances.
                                var seen=new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                                foreach(var e in index.Values.OfType<BlockReference>()){var a=Attributes(e,tr);if(a.ContainsKey("DEVICE_ID")&&a["DEVICE_ID"]!="")Require(seen.Add(a["DEVICE_ID"]),"NUMBER_CONFLICT",a["DEVICE_ID"]);}
                                state.revision++;Write(nod,StateKey,state,tr);Write(nod,key,new TaskRecord{fingerprint=fingerprint,revision=state.revision},tr);
                            }
                        }
                        tr.Commit();
                        mutationCommitted=true;
                    }
                    }
                }
                mark("inspect");
                if(request.action=="create_drawing")SceneBuilder.SetView(doc,request.scene);
                var snapshot=Inspect(db);
                object tangent=(request.action=="tangent_inspect"||request.action=="tangent_takeoff"||request.action=="native_status"||selectedAdapter=="tangent-v8"||selectedAdapter=="tangent-project")?TangentAdapter.Read(db,request.units):null;
                if(writes)
                {
                    Require(!String.IsNullOrEmpty(output)&&!File.Exists(output),"OUTPUT_EXISTS","Output must be a new file.");
                    mark("save");db.SaveAs(output,DwgVersion.AC1032);
                    drawingSaved=true;
                    if(!String.IsNullOrEmpty(dxf)){mark("dxf");db.DxfOut(dxf,16,DwgVersion.AC1032);}
                }
                object audit=null;bool auditDxfExported=false;string auditDxfError=null;
                object query=request.action=="query_entities"||nativeBatch?QueryEntities(db,nativeBatch?new Request{limit=1000}:request):null;
                object exported=null;
                if(request.action=="export"){mark("plot");exported=ExportDrawing(doc,request,Path.GetDirectoryName(response));}
                if(request.action=="audit_drawing"||request.exportDxf){if(request.action=="audit_drawing")audit=DrawingAudit.Read(db);try{db.DxfOut(dxf,16,DwgVersion.AC1032);auditDxfExported=true;}catch(System.Exception exportError){auditDxfError=exportError.Message;}}
                var serializer=(request.action=="audit_drawing"||request.action=="query_entities")?new JavaScriptSerializer{MaxJsonLength=134217728,RecursionLimit=50}:Json;
                mark("response");
                File.WriteAllText(response,serializer.Serialize(new{ok=true,replayed=replay,mutationCommitted=mutationCommitted,drawingSaved=drawingSaved,timings=timings,snapshot=snapshot,tangent=tangent,audit=audit,query=query,changes=changes,exported=exported,auditDxfExported=auditDxfExported,auditDxfError=auditDxfError}),new UTF8Encoding(false));
                doc.Editor.WriteMessage("\nCADAGENT_RUN_OK\n");
            }
            catch(System.Exception ex)
            {
                var fault=ex as Fault;object snapshot=null;
                string failedPhase=phase;mark("response");
                try{snapshot=Inspect(doc.Database);}catch{}
                object afterFailureQuery=null;try{if(executingAction=="edit")afterFailureQuery=QueryEntities(doc.Database,new Request{limit=1000});}catch{}
                File.WriteAllText(response,Json.Serialize(new{ok=false,error=new{code=fault==null?(failedPhase=="save"?"DWG_SAVE_FAILED":failedPhase=="dxf"?"DXF_EXPORT_FAILED":"CAD_ERROR"):fault.Code,message=ex.Message},failureStage=failedPhase,timings=timings,mutationCommitted=mutationCommitted,drawingSaved=drawingSaved,afterFailure=snapshot,afterFailureQuery=afterFailureQuery}),new UTF8Encoding(false));
                doc.Editor.WriteMessage("\nCADAGENT_RUN_ERROR "+ex.ToString()+"\n");
            }
        }
    }
}

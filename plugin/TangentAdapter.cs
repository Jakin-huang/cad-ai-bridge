using System;
using System.Linq;
using System.Globalization;
using System.Collections.Generic;
using Autodesk.AutoCAD.DatabaseServices;
using Autodesk.AutoCAD.Geometry;

namespace CadAgent {
    public sealed class XDatum { public int code; public object value; }
    // Observed V8 sample interoperability. Foreign entities are read only.
    // No claim of the complete Tangent SDK/schema or native topology is made.
    public static class TangentAdapter {
        static readonly string[] WireKeys={"ltype","ldm","lmeth","linst","lnoar","lnorm","linenum"};
        static readonly Dictionary<string,string> DeviceKeys=new Dictionary<string,string>{{"light","lighting"},{"socket","socket"},{"fireequip","fire"},{"weakequip","weak-current"},{"switchboard","distribution-board"},{"switch","switch"},{"powerequip","power"},{"otherequip","other-equipment"},{"EES_Fire","fire"}};
        static bool Present(Dictionary<string,List<XDatum>> data,string key){string value=Text(data,key);return !String.IsNullOrWhiteSpace(value)&&value!="F"&&value!="false";}
        public static string Category(Dictionary<string,List<XDatum>> data){
            foreach(var pair in DeviceKeys)if(Present(data,pair.Key))return pair.Value;
            if(Present(data,"名称")){if(data.ContainsKey("照明平面设备层"))return "lighting";if(data.ContainsKey("动力平面设备层"))return "power";if(data.ContainsKey("消防平面设备层"))return "fire";}
            return data.ContainsKey("DEVTYPE")||Present(data,"设备名称")?"device-unclassified":null;
        }
        static void AddRegApp(Database db,Transaction tr,string app) {
            var table=(RegAppTable)tr.GetObject(db.RegAppTableId,OpenMode.ForRead);
            if(table.Has(app))return;
            table.UpgradeOpen();var record=new RegAppTableRecord{Name=app};table.Add(record);tr.AddNewlyCreatedDBObject(record,true);
        }
        static void SetData(Database db,Transaction tr,DBObject obj,Dictionary<string,string> fields) {
            var data=new List<TypedValue>();
            foreach(var item in fields){AddRegApp(db,tr,item.Key);data.Add(new TypedValue(1001,item.Key));data.Add(new TypedValue(1000,item.Value));}
            using(var rb=new ResultBuffer(data.ToArray()))obj.XData=rb;
        }
        public static void DefineFixture(Database db,Transaction tr) {
            var bt=(BlockTable)tr.GetObject(db.BlockTableId,OpenMode.ForWrite);
            var light=(BlockTableRecord)tr.GetObject(bt["EA_LIGHT"],OpenMode.ForWrite);
            SetData(db,tr,light,new Dictionary<string,string>{{"CADBRIDGE_SYMBOL","light"}});
            var socket=new BlockTableRecord{Name="EA_SOCKET",Units=UnitsValue.Millimeters};bt.Add(socket);tr.AddNewlyCreatedDBObject(socket,true);
            var entities=new Entity[]{new Circle(Point3d.Origin,Vector3d.ZAxis,100),new Line(new Point3d(-70,0,0),new Point3d(70,0,0)),new Line(Point3d.Origin,new Point3d(0,100,0)),
                new AttributeDefinition{Tag="DEVICE_ID",TextString="",Position=new Point3d(130,100,0),Height=90},new AttributeDefinition{Tag="MODEL",TextString="TEST-SOCKET",Position=new Point3d(130,-70,0),Height=70}};
            foreach(var e in entities){socket.AppendEntity(e);tr.AddNewlyCreatedDBObject(e,true);}
            SetData(db,tr,socket,new Dictionary<string,string>{{"CADBRIDGE_SYMBOL","socket"}});
        }
        public static void MarkNewDevice(Database db,Transaction tr,BlockReference br) {
            var def=(BlockTableRecord)tr.GetObject(br.BlockTableRecord,OpenMode.ForRead);
            string marker=Text(Data(def),"CADBRIDGE_SYMBOL");
            if(marker!="light"&&marker!="socket")throw new Fault("TANGENT_SYMBOL_UNVERIFIED","Only synthetic symbols explicitly marked by this adapter may be written in this preview.");
            SetData(db,tr,br,new Dictionary<string,string>{{marker,"T"}});
        }
        public static void MarkNewWire(Database db,Transaction tr,Polyline line,Operation op) {
            var fields=new Dictionary<string,string>{{"linenum",op.circuitId}};
            if(op.wireSpec!=null){
                if(op.wireSpec.wireType!=null)fields["ltype"]=op.wireSpec.wireType;
                if(op.wireSpec.conductorSpec!=null)fields["lnoar"]=op.wireSpec.conductorSpec;
                if(op.wireSpec.method!=null)fields["lmeth"]=op.wireSpec.method;
                if(op.wireSpec.installation!=null)fields["linst"]=op.wireSpec.installation;
                if(op.wireSpec.conduitDiameter!=null)fields["ldm"]=op.wireSpec.conduitDiameter;
            }
            SetData(db,tr,line,fields);
        }
        static object Value(object value) {
            if(value is Point3d){var p=(Point3d)value;return new[]{p.X,p.Y,p.Z};}
            if(value is byte[])return Convert.ToBase64String((byte[])value);
            if(value is string||value is double||value is short||value is int||value is long)return value;
            return Convert.ToString(value,CultureInfo.InvariantCulture);
        }
        public static Dictionary<string,List<XDatum>> Data(DBObject entity) {
            var result=new Dictionary<string,List<XDatum>>(StringComparer.Ordinal);
            using(var rb=entity.XData)if(rb!=null){string key=null;foreach(var item in rb.AsArray()){
                if(item.TypeCode==1001){key=Convert.ToString(item.Value);if(!result.ContainsKey(key))result[key]=new List<XDatum>();}
                else if(key!=null)result[key].Add(new XDatum{code=item.TypeCode,value=Value(item.Value)});
            }}
            return result;
        }
        static string Text(Dictionary<string,List<XDatum>> data,string app) {
            List<XDatum> values;if(!data.TryGetValue(app,out values))return null;
            foreach(var item in values)if(item.code==1000)return Convert.ToString(item.value,CultureInfo.InvariantCulture);
            return null;
        }
        static void Count(Dictionary<string,int> counts,string key){if(!counts.ContainsKey(key))counts[key]=0;counts[key]++;}
        public static object Read(Database db,string assumeUnits) {
            bool actualMm=db.Insunits==UnitsValue.Millimeters,assumedMm=db.Insunits==UnitsValue.Undefined&&assumeUnits=="mm";
            if(assumeUnits=="mm"&&!actualMm&&!assumedMm)throw new Fault("UNITS_MISMATCH","An explicit drawing unit cannot be overridden by an assumption.");
            var devices=new List<object>();var wires=new List<object>();var errors=new List<object>();var proxies=new Dictionary<string,int>();var groups=new Dictionary<string,int>();
            var circuitLengths=new Dictionary<string,double>(StringComparer.Ordinal);var circuitCounts=new Dictionary<string,int>(StringComparer.Ordinal);
            int total=0,excluded=0,unknownCircuits=0,emptyWireMetadata=0,unclassifiedBlocks=0;double length=0;bool allWiresManaged=true;
            var unresolvedWireLayers=new Dictionary<string,int>();var candidateLayers=new Dictionary<string,int>();
            using(var tr=db.TransactionManager.StartOpenCloseTransaction()) {
                var bt=(BlockTable)tr.GetObject(db.BlockTableId,OpenMode.ForRead);
                var model=(BlockTableRecord)tr.GetObject(bt[BlockTableRecord.ModelSpace],OpenMode.ForRead);
                foreach(ObjectId id in model) {
                    total++;
                    try {
                        var entity=tr.GetObject(id,OpenMode.ForRead) as Entity;if(entity==null){excluded++;continue;}
                        var proxy=entity as ProxyEntity;if(proxy!=null){Count(proxies,proxy.OriginalClassName+"|"+proxy.OriginalDxfName);excluded++;continue;}
                        var data=Data(entity);var br=entity as BlockReference;
                        string category=Category(data);
                        if(br!=null&&category!=null) {
                            var attrs=new Dictionary<string,string>(StringComparer.OrdinalIgnoreCase);
                            foreach(ObjectId aid in br.AttributeCollection){var a=(AttributeReference)tr.GetObject(aid,OpenMode.ForRead);attrs[a.Tag]=a.TextString;}
                            string name=Text(data,"设备名称")??Text(data,"名称");if(name==null&&attrs.ContainsKey("A"))name=attrs["A"];
                            devices.Add(new {handle=br.Handle.ToString(),blockName=br.Name,category=category,name=name,layer=br.Layer,position=new[]{br.Position.X,br.Position.Y,br.Position.Z},attributes=attrs,xdata=data,recognitionBasis="Observed Tangent V8 XData application names"});
                            Count(groups,category+"|"+br.Name);continue;
                        }
                        if(br!=null&&System.Text.RegularExpressions.Regex.IsMatch(br.Layer,@"(?i)EQUIP|设备|消防|照明|插座|弱电")){unclassifiedBlocks++;Count(candidateLayers,br.Layer);}
                        var curve=entity as Curve;
                        if(curve!=null&&(entity is Polyline||entity is Line||entity is Arc)&&WireKeys.Any(k=>data.ContainsKey(k))) {
                            if(!WireKeys.Any(k=>!String.IsNullOrWhiteSpace(Text(data,k)))){emptyWireMetadata++;Count(unresolvedWireLayers,entity.Layer);excluded++;continue;}
                            if(entity.ExtensionDictionary.IsNull||!((DBDictionary)tr.GetObject(entity.ExtensionDictionary,OpenMode.ForRead)).Contains("CADAGENT_ENTITY"))allWiresManaged=false;
                            double drawingLength=curve.GetDistanceAtParameter(curve.EndParam)-curve.GetDistanceAtParameter(curve.StartParam);
                            string circuit=Text(data,"linenum");if(String.IsNullOrWhiteSpace(circuit)){circuit=null;unknownCircuits++;}else{Count(circuitCounts,circuit);if(!circuitLengths.ContainsKey(circuit))circuitLengths[circuit]=0;circuitLengths[circuit]+=drawingLength;}
                            var spec=new Dictionary<string,string>();foreach(var key in WireKeys)if(data.ContainsKey(key))spec[key]=Text(data,key);
                            wires.Add(new {handle=entity.Handle.ToString(),entityType=entity.GetRXClass().DxfName,layer=entity.Layer,circuitId=circuit,spec=spec,lengthDrawingUnits=drawingLength,lengthMm=(actualMm||assumedMm)?(double?)drawingLength:null,start=new[]{curve.StartPoint.X,curve.StartPoint.Y,curve.StartPoint.Z},end=new[]{curve.EndPoint.X,curve.EndPoint.Y,curve.EndPoint.Z},xdata=data});
                            length+=drawingLength;continue;
                        }
                        excluded++;
                    }catch(System.Exception ex){errors.Add(new {handle=id.Handle.ToString(),message=ex.Message});}
                }
            }
            var nativeModules=new List<string>();
            foreach(System.Diagnostics.ProcessModule module in System.Diagnostics.Process.GetCurrentProcess().Modules)if(module.ModuleName.StartsWith("tel_",StringComparison.OrdinalIgnoreCase)||module.ModuleName.StartsWith("tch_",StringComparison.OrdinalIgnoreCase))nativeModules.Add(module.ModuleName);
            return new {adapter="tangent-v8-observed",units=db.Insunits.ToString(),unitsSource=actualMm?"drawing":assumedMm?"caller-assumption":"unresolved",deviceCount=devices.Count,wireCount=wires.Count,devices=devices,wires=wires,
                circuits=circuitCounts.OrderBy(x=>x.Key,StringComparer.Ordinal).Select(x=>new {id=x.Key,wireCount=x.Value,lengthDrawingUnits=circuitLengths[x.Key],lengthMm=(actualMm||assumedMm)?(double?)circuitLengths[x.Key]:null}).ToArray(),
                statistics=new {deviceGroups=groups,circuitCount=allWiresManaged&&wires.Count>0?(int?)circuitCounts.Count:null,circuitLabelCount=circuitCounts.Count,circuitIdentityResolved=allWiresManaged&&wires.Count>0,unassignedWireCount=unknownCircuits,lengthDrawingUnits=length,lengthMm=(actualMm||assumedMm)?(double?)length:null},
                coverage=new {modelSpaceEntities=total,excludedEntities=excluded,emptyWireMetadataEntities=emptyWireMetadata,emptyWireMetadataByLayer=unresolvedWireLayers,unclassifiedElectricalBlocks=unclassifiedBlocks,unclassifiedElectricalBlocksByLayer=candidateLayers,proxyEntities=proxies.Values.Sum(),proxyClasses=proxies,scope="Model-space root instances including legends and repeated views; nested blocks and xrefs excluded; circuit labels do not resolve feeder or board identities",errors=errors,completeWithinScope=errors.Count==0&&unclassifiedBlocks==0&&proxies.Count==0,geometryReadSucceeded=errors.Count==0},
                nativeRuntime=new {loadedModules=nativeModules,commandReadinessVerified=false,note="Loaded modules alone do not prove native command or license readiness."}};
        }
    }
}

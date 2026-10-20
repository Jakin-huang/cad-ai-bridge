using System;
using System.Linq;
using System.Collections.Generic;
using Autodesk.AutoCAD.DatabaseServices;
using Autodesk.AutoCAD.Geometry;

namespace CadAgent {
 public sealed class QueryRegion { public double[] min,max; public string mode; }
 public sealed class EntityFilter { public string[] handles,ids,types,layers; public string blockName,textContains; public Dictionary<string,string> attributes; public QueryRegion region; }
 public sealed class QueryScope { public string layout;public bool includeNested;public int maxDepth=4;public string[] rootHandles; }
 public static partial class Commands {
  static double[] XY(Point3d p){return new[]{p.X,p.Y,p.Z};}
  static double[] XYZ(Vector3d v){return new[]{v.X,v.Y,v.Z};}
  static string TextOf(Entity e){var text=e as DBText;if(text!=null)return text.TextString;var mt=e as MText;return mt==null?null:mt.Contents;}
  static Dictionary<string,object> Describe(Entity e,Transaction tr){
   var row=new Dictionary<string,object>{{"handle",e.Handle.ToString()},{"type",e.GetRXClass().DxfName},{"layer",e.Layer},{"color",e.ColorIndex}};
   var layer=(LayerTableRecord)tr.GetObject(e.LayerId,OpenMode.ForRead);row["locked"]=layer.IsLocked;
   if(e.GetRXClass().DxfName=="TCH_CABLETRY")row["native"]=NativeTrayProperties(e);
   if(e.GetRXClass().DxfName=="TCH_CABLEDIM")row["native"]=NativeLabelProperties(e);
   var m=Metadata(e,tr);if(m!=null){row["id"]=m.id;row["managedKind"]=m.kind;}
   try{var b=e.GeometricExtents;row["bounds"]=new{min=XY(b.MinPoint),max=XY(b.MaxPoint)};}catch{}
   var br=e as BlockReference;if(br!=null){row["blockName"]=br.Name;row["position"]=XY(br.Position);row["rotationRadians"]=br.Rotation;row["attributes"]=Attributes(br,tr);row["dynamic"]=br.IsDynamicBlock;var cs=br.BlockTransform.CoordinateSystem3d;row["basisX"]=XYZ(cs.Xaxis);row["basisY"]=XYZ(cs.Yaxis);row["basisZ"]=XYZ(cs.Zaxis);var definition=(BlockTableRecord)tr.GetObject(br.BlockTableRecord,OpenMode.ForRead);row["xref"]=definition.IsFromExternalReference;}
   var text=TextOf(e);if(text!=null){row["text"]=text;row["position"]=XY(e is DBText?((DBText)e).Position:((MText)e).Location);}
   var dbText=e as DBText;if(dbText!=null){row["height"]=dbText.Height;row["widthFactor"]=dbText.WidthFactor;row["rotationRadians"]=dbText.Rotation;row["textStyle"]=((TextStyleTableRecord)tr.GetObject(dbText.TextStyleId,OpenMode.ForRead)).Name;var ocs=Matrix3d.PlaneToWorld(dbText.Normal);var x=new Vector3d(Math.Cos(dbText.Rotation),Math.Sin(dbText.Rotation),0).TransformBy(ocs);var y=new Vector3d(-Math.Sin(dbText.Rotation),Math.Cos(dbText.Rotation),0).TransformBy(ocs);row["basisX"]=XYZ(x*dbText.Height*dbText.WidthFactor*(dbText.IsMirroredInX?-1:1));row["basisY"]=XYZ(y*dbText.Height*(dbText.IsMirroredInY?-1:1));}
   var mText=e as MText;if(mText!=null){row["height"]=mText.TextHeight;row["textWidth"]=mText.Width;row["rotationRadians"]=mText.Rotation;row["textStyle"]=((TextStyleTableRecord)tr.GetObject(mText.TextStyleId,OpenMode.ForRead)).Name;var x=mText.Direction.GetNormal();row["basisX"]=XYZ(x*mText.TextHeight);row["basisY"]=XYZ(mText.Normal.CrossProduct(x)*mText.TextHeight);}
   var curve=e as Curve;if(curve!=null){try{row["start"]=XY(curve.StartPoint);row["end"]=XY(curve.EndPoint);row["length"]=curve.GetDistanceAtParameter(curve.EndParam)-curve.GetDistanceAtParameter(curve.StartParam);}catch{}}
   var poly=e as Polyline;if(poly!=null){row["vertices"]=Enumerable.Range(0,poly.NumberOfVertices).Select(i=>XY(poly.GetPoint3dAt(i))).ToArray();row["bulges"]=Enumerable.Range(0,poly.NumberOfVertices).Select(i=>poly.GetBulgeAt(i)*(poly.Normal.Z<0?-1:1)).ToArray();row["closed"]=poly.Closed;try{row["width"]=poly.ConstantWidth;}catch(Autodesk.AutoCAD.Runtime.Exception){row["segmentWidths"]=Enumerable.Range(0,poly.NumberOfVertices).Select(i=>new[]{poly.GetStartWidthAt(i),poly.GetEndWidthAt(i)}).ToArray();row["variableWidth"]=true;}}
   var solid=e as Solid;if(solid!=null)row["vertices"]=Enumerable.Range(0,4).Select(i=>XY(solid.GetPointAt((short)i))).ToArray();
   var circle=e as Circle;if(circle!=null){row["center"]=XY(circle.Center);row["radius"]=circle.Radius;}
   var arc=e as Arc;if(arc!=null){row["center"]=XY(arc.Center);row["radius"]=arc.Radius;}
   var dim=e as Dimension;if(dim!=null){row["measurement"]=dim.Measurement;row["dimensionText"]=dim.DimensionText;}
   return row;
  }
  static bool Matches(Entity e,Transaction tr,EntityFilter f,Matrix3d? transform=null){
   if(f==null)return true;
   if(f.handles!=null&&!f.handles.Contains(e.Handle.ToString(),StringComparer.OrdinalIgnoreCase))return false;
   var m=Metadata(e,tr);if(f.ids!=null&&(m==null||!f.ids.Contains(m.id)))return false;
   if(f.types!=null&&!f.types.Contains(e.GetRXClass().DxfName))return false;
   if(f.layers!=null&&!f.layers.Contains(e.Layer,StringComparer.OrdinalIgnoreCase))return false;
   var br=e as BlockReference;if(f.blockName!=null&&(br==null||!String.Equals(br.Name,f.blockName,StringComparison.OrdinalIgnoreCase)))return false;
   if(f.textContains!=null&&(TextOf(e)==null||TextOf(e).IndexOf(f.textContains,StringComparison.OrdinalIgnoreCase)<0))return false;
   if(f.attributes!=null){if(br==null)return false;var a=Attributes(br,tr);foreach(var kv in f.attributes)if(!a.ContainsKey(kv.Key)||a[kv.Key]!=kv.Value)return false;}
   if(f.region!=null){try{var b=e.GeometricExtents;if(transform.HasValue)b.TransformBy(transform.Value);var lo=Point(f.region.min);var hi=Point(f.region.max);
    if(f.region.mode=="contains"){if(b.MinPoint.X<lo.X||b.MaxPoint.X>hi.X||b.MinPoint.Y<lo.Y||b.MaxPoint.Y>hi.Y)return false;}
    else if(b.MaxPoint.X<lo.X||b.MinPoint.X>hi.X||b.MaxPoint.Y<lo.Y||b.MinPoint.Y>hi.Y)return false;
   }catch{return false;}}
   return true;
  }
  static object QueryEntities(Database db,Request request){
   using(var tr=db.TransactionManager.StartOpenCloseTransaction()){
    var items=new List<object>();int total=0;var errors=new List<object>();bool scopeTruncated=false;
    object traversal;ReadQueryScope(db,tr,request,items,errors,ref total,ref scopeTruncated,out traversal);
    var layers=new List<object>();foreach(ObjectId id in (LayerTable)tr.GetObject(db.LayerTableId,OpenMode.ForRead)){var l=(LayerTableRecord)tr.GetObject(id,OpenMode.ForRead);layers.Add(new{name=l.Name,color=l.Color.ColorIndex,locked=l.IsLocked,off=l.IsOff,frozen=l.IsFrozen});}
    var layouts=new List<object>();foreach(DBDictionaryEntry kv in (DBDictionary)tr.GetObject(db.LayoutDictionaryId,OpenMode.ForRead)){var l=(Layout)tr.GetObject(kv.Value,OpenMode.ForRead);layouts.Add(new{name=l.LayoutName,model=l.ModelType});}
    var views=new List<object>();foreach(ObjectId id in (ViewTable)tr.GetObject(db.ViewTableId,OpenMode.ForRead)){var v=(ViewTableRecord)tr.GetObject(id,OpenMode.ForRead);views.Add(new{name=v.Name,center=new[]{v.CenterPoint.X,v.CenterPoint.Y,0},width=v.Width,height=v.Height});}
    return new{total=total,returned=items.Count,truncated=total>items.Count||scopeTruncated,entities=items,layers=layers,layouts=layouts,views=views,errors=errors,units=db.Insunits.ToString(),traversal=traversal,scope=request.scope!=null?"Explicit layout and optional selected root handles; optional local nested expansion with instancePath. Nested coordinates are WCS bounds/points; nested scalar sizes remain definition values. Xref contents excluded and reported. Nested and paper-space entities are read only.":"Model-space roots; region matches WCS bounding boxes. Handles are valid only with this input SHA-256. Refine filters when truncated."};
   }
  }
  static Entity ByHandle(Database db,Transaction tr,string handle){
   ObjectId id;try{id=db.GetObjectId(false,new Handle(Convert.ToInt64(handle,16)),0);}catch{throw new Fault("ENTITY_NOT_FOUND","Unknown handle: "+handle);}
   Require(!id.IsNull&&!id.IsErased,"ENTITY_NOT_FOUND",handle);var e=tr.GetObject(id,OpenMode.ForRead) as Entity;
   Require(e!=null&&e.OwnerId==Model(db,tr,OpenMode.ForRead).ObjectId,"ENTITY_SCOPE_UNSUPPORTED","Only model-space roots can be edited.");return e;
  }
  static void SafeEntity(Database db,Transaction tr,Entity e,bool allowManaged){
   Require(new[]{"LINE","LWPOLYLINE","ARC","CIRCLE","TEXT","MTEXT","INSERT","DIMENSION","SOLID"}.Contains(e.GetRXClass().DxfName),"ENTITY_TYPE_UNSUPPORTED","Custom and proxy entities are read only.");
   Require(!((LayerTableRecord)tr.GetObject(e.LayerId,OpenMode.ForRead)).IsLocked,"LAYER_LOCKED",e.Layer);
   Require(e.GetPersistentReactorIds().Count==0,"ENTITY_ASSOCIATIONS_UNSUPPORTED","Associated entities need a dedicated adapter.");
   if(!e.ExtensionDictionary.IsNull)foreach(DBDictionaryEntry kv in (DBDictionary)tr.GetObject(e.ExtensionDictionary,OpenMode.ForRead))Require(kv.Key==MetaKey||kv.Key=="CADBRIDGE_ROUTE_LABEL","ENTITY_ASSOCIATIONS_UNSUPPORTED","Unknown extension dictionary: "+kv.Key);
   var meta=Metadata(e,tr);Require(allowManaged||meta==null,"MANAGED_OPERATION_REQUIRED","Use the dedicated device/route operation for managed entities.");
   var allowed=new HashSet<string>{"light","socket","linenum","ltype","lnoar","lmeth","linst","ldm","lnorm"};
   foreach(var key in TangentAdapter.Data(e).Keys)Require(meta!=null&&allowed.Contains(key),"ENTITY_XDATA_UNSUPPORTED","Unverified application data: "+key);
   var br=e as BlockReference;if(br!=null){var b=(BlockTableRecord)tr.GetObject(br.BlockTableRecord,OpenMode.ForRead);Require(!br.IsDynamicBlock&&!b.IsFromExternalReference,"ENTITY_TYPE_UNSUPPORTED","Dynamic blocks and xrefs are read only.");Require(br.Normal.IsEqualTo(Vector3d.ZAxis)&&Math.Abs(br.Position.Z)<1e-8,"ENTITY_PLANE_UNSUPPORTED","Only planar WCS XY entities are supported.");}
   else {Require(e is Line||e is Polyline||e is Circle||e is Arc||e is DBText||e is MText||e is Dimension||e is Solid,"ENTITY_TYPE_UNSUPPORTED",e.GetRXClass().DxfName);try{var b=e.GeometricExtents;Require(Math.Abs(b.MinPoint.Z)<1e-6&&Math.Abs(b.MaxPoint.Z)<1e-6,"ENTITY_PLANE_UNSUPPORTED","Only WCS XY entities supported.");}catch(Fault){throw;}catch{throw new Fault("ENTITY_BOUNDS_UNAVAILABLE","Cannot establish planar bounds.");}}
  }
  static void TransformEntity(Entity e,Transaction tr,Matrix3d matrix){e.UpgradeOpen();e.TransformBy(matrix);}
  static Entity CopyEntity(Database db,Transaction tr,Entity e,Matrix3d matrix){var map=new IdMapping();db.DeepCloneObjects(new ObjectIdCollection(new[]{e.ObjectId}),e.OwnerId,map,false);var copy=(Entity)tr.GetObject(map[e.ObjectId].Value,OpenMode.ForWrite);TransformEntity(copy,tr,matrix);return copy;}
  static void EditableLayer(Database db,Transaction tr,string name){var lt=(LayerTable)tr.GetObject(db.LayerTableId,OpenMode.ForRead);Require(lt.Has(name),"LAYER_NOT_FOUND",name);var l=(LayerTableRecord)tr.GetObject(lt[name],OpenMode.ForRead);Require(!l.IsLocked&&!l.IsDependent,"LAYER_LOCKED",name);}
  static void ValidateRoutes(Dictionary<string,Entity> index,Transaction tr){foreach(var pair in index){var m=Metadata(pair.Value,tr);if(m.kind!="route")continue;var line=pair.Value as Polyline;Require(line!=null&&index.ContainsKey(m.from)&&index.ContainsKey(m.to)&&index[m.from] is BlockReference&&index[m.to] is BlockReference,"DANGLING_ROUTE",m.id);Require(line.StartPoint.DistanceTo(Port((BlockReference)index[m.from],tr))<1e-6&&line.EndPoint.DistanceTo(Port((BlockReference)index[m.to],tr))<1e-6,"DISCONNECTED_ROUTE",m.id);}}
  static ObjectId EditingTextStyle(Database db,Transaction tr){var styles=(TextStyleTable)tr.GetObject(db.TextStyleTableId,OpenMode.ForRead);string name="CADBRIDGE_UNICODE";if(styles.Has(name)){var existing=(TextStyleTableRecord)tr.GetObject(styles[name],OpenMode.ForRead);if(existing.Font.TypeFace=="Microsoft YaHei")return existing.ObjectId;name+="_"+Guid.NewGuid().ToString("N");}styles.UpgradeOpen();var style=new TextStyleTableRecord{Name=name};style.Font=new Autodesk.AutoCAD.GraphicsInterface.FontDescriptor("Microsoft YaHei",false,false,134,0);styles.Add(style);tr.AddNewlyCreatedDBObject(style,true);return style.ObjectId;}
  static string RouteText(Meta m,Polyline line){var spec=TangentAdapter.Data(line);var parts=new List<string>{m.circuitId};foreach(string key in new[]{"ltype","lnoar","lmeth","linst","ldm"})if(spec.ContainsKey(key))parts.Add(String.Join("",spec[key].Where(v=>v.code==1000).Select(v=>Convert.ToString(v.value))));return String.Join(" ",parts);}
  static void RefreshLabels(Database db,Transaction tr,Dictionary<string,Entity> index){foreach(var e in Entities(db,tr).OfType<DBText>()){if(e.ExtensionDictionary.IsNull)continue;var dict=(DBDictionary)tr.GetObject(e.ExtensionDictionary,OpenMode.ForRead);var link=(Meta)Read(dict,"CADBRIDGE_ROUTE_LABEL",tr,typeof(Meta));if(link==null)continue;Require(index.ContainsKey(link.id),"DANGLING_ROUTE_LABEL",link.id);var route=index[link.id] as Polyline;Require(route!=null,"ROUTE_NOT_FOUND",link.id);SafeEntity(db,tr,e,false);e.UpgradeOpen();e.TextString=RouteText(Metadata(route,tr),route);}}
  static object Edit(Database db,Transaction tr,Operation op,Dictionary<string,Entity> index,string adapter){
   var changed=new List<string>();var created=new List<string>();var removed=new List<string>();
   if(op.type=="upsert_layer"){
    var lt=(LayerTable)tr.GetObject(db.LayerTableId,OpenMode.ForRead);if(!lt.Has(op.name))Layer(db,tr,op.name,(short)op.color);var l=(LayerTableRecord)tr.GetObject(lt[op.name],OpenMode.ForWrite);Require(!l.IsDependent,"LAYER_DEPENDENT",op.name);Require(!l.IsLocked||op.locked==false,"LAYER_LOCKED","Explicitly unlock the layer before editing its settings.");l.Color=Autodesk.AutoCAD.Colors.Color.FromColorIndex(Autodesk.AutoCAD.Colors.ColorMethod.ByAci,(short)op.color);if(op.locked.HasValue)l.IsLocked=op.locked.Value;if(op.off.HasValue)l.IsOff=op.off.Value;
   }else if(op.type=="add_geometry"){
    var layers=new HashSet<string>();foreach(ObjectId id in (LayerTable)tr.GetObject(db.LayerTableId,OpenMode.ForRead))layers.Add(((LayerTableRecord)tr.GetObject(id,OpenMode.ForRead)).Name);
    foreach(var p in op.entities){EditableLayer(db,tr,p.layer);var entity=SceneBuilder.Make(p,layers,p.kind=="text"?EditingTextStyle(db,tr):db.Textstyle);Append(Model(db,tr,OpenMode.ForWrite),entity,tr);created.Add(entity.Handle.ToString());}
   }else if(op.type=="insert_block"){
    EditableLayer(db,tr,op.layer);var bt=(BlockTable)tr.GetObject(db.BlockTableId,OpenMode.ForRead);Require(bt.Has(op.blockName),"SYMBOL_NOT_FOUND",op.blockName);var definition=(BlockTableRecord)tr.GetObject(bt[op.blockName],OpenMode.ForRead);Require(!definition.IsDynamicBlock&&!definition.IsFromExternalReference&&TangentAdapter.Data(definition).Count==0,"SYMBOL_UNSUPPORTED","Insert only ordinary unassociated local definitions.");var br=new BlockReference(Point(op.position),definition.ObjectId){Layer=op.layer,Rotation=op.rotationRadians};Append(Model(db,tr,OpenMode.ForWrite),br,tr);var supplied=op.attributes??new Dictionary<string,string>();var consumed=new HashSet<string>(StringComparer.OrdinalIgnoreCase);foreach(ObjectId id in definition){var ad=tr.GetObject(id,OpenMode.ForRead) as AttributeDefinition;if(ad==null||ad.Constant)continue;var ar=new AttributeReference();ar.SetAttributeFromBlock(ad,br.BlockTransform);var kv=supplied.FirstOrDefault(k=>k.Key.Equals(ad.Tag,StringComparison.OrdinalIgnoreCase));ar.TextString=kv.Key==null?ad.TextString:kv.Value;if(kv.Key!=null)consumed.Add(kv.Key);br.AttributeCollection.AppendAttribute(ar);tr.AddNewlyCreatedDBObject(ar,true);}Require(supplied.Keys.All(consumed.Contains),"ATTRIBUTE_NOT_FOUND","Unknown attribute tag.");created.Add(br.Handle.ToString());
   }else if(op.type=="add_dimension"){
    EditableLayer(db,tr,op.layer);var a=Point(op.fromPoint);var b=Point(op.toPoint);Require(a.DistanceTo(b)>1e-6,"INVALID_DIMENSION","Dimension endpoints must differ.");Dimension dim=op.kind=="aligned"?(Dimension)new AlignedDimension(a,b,Point(op.position),op.text,db.Dimstyle):new RotatedDimension(op.rotationRadians,a,b,Point(op.position),op.text,db.Dimstyle);dim.Layer=op.layer;dim.Dimtxt=op.height;dim.Dimasz=op.height*.6;Append(Model(db,tr,OpenMode.ForWrite),dim,tr);dim.RecomputeDimensionBlock(true);created.Add(dim.Handle.ToString());
   }else if(op.type=="upsert_view"){
    var table=(ViewTable)tr.GetObject(db.ViewTableId,OpenMode.ForWrite);ViewTableRecord view;if(table.Has(op.name))view=(ViewTableRecord)tr.GetObject(table[op.name],OpenMode.ForWrite);else{view=new ViewTableRecord{Name=op.name};table.Add(view);tr.AddNewlyCreatedDBObject(view,true);}var c=Point(op.center);view.CenterPoint=new Point2d(c.X,c.Y);view.Target=Point3d.Origin;view.ViewDirection=Vector3d.ZAxis;view.Width=op.width;view.Height=op.height;view.ViewTwist=0;
   }else if(op.type=="create_layout"){
    var manager=LayoutManager.Current;Require(!manager.LayoutExists(op.name),"LAYOUT_EXISTS",op.name);var id=manager.CreateLayout(op.name);string oldLayout=manager.CurrentLayout;manager.CurrentLayout=op.name;var layout=(Layout)tr.GetObject(id,OpenMode.ForWrite);var paper=(BlockTableRecord)tr.GetObject(layout.BlockTableRecordId,OpenMode.ForWrite);
    foreach(ObjectId oldId in paper){var old=tr.GetObject(oldId,OpenMode.ForRead) as Viewport;if(old!=null&&old.Number>1){old.UpgradeOpen();old.Erase();}}var viewport=new Viewport();Append(paper,viewport,tr);viewport.CenterPoint=new Point3d(148.5,105,0);viewport.Width=277;viewport.Height=190;viewport.ViewDirection=Vector3d.ZAxis;viewport.ViewTarget=Point3d.Origin;var c=Point(op.center);viewport.ViewCenter=new Point2d(c.X,c.Y);viewport.ViewHeight=Math.Max(op.height,op.width*190/277);viewport.On=true;viewport.Locked=true;created.Add(viewport.Handle.ToString());manager.CurrentLayout=oldLayout;
   }else if(op.type=="move_devices"){
    var delta=Point(op.delta)-Point3d.Origin;foreach(var id in op.ids){Require(index.ContainsKey(id)&&index[id] is BlockReference,"DEVICE_NOT_FOUND",id);var e=index[id];SafeEntity(db,tr,e,true);TransformEntity(e,tr,Matrix3d.Displacement(delta));changed.Add(e.Handle.ToString());}
    foreach(var pair in index){var m=Metadata(pair.Value,tr);if(m.kind!="route"||(!op.ids.Contains(m.from)&&!op.ids.Contains(m.to)))continue;var p=(Polyline)pair.Value;SafeEntity(db,tr,p,true);p.UpgradeOpen();if(op.ids.Contains(m.from)&&op.ids.Contains(m.to)){TransformEntity(p,tr,Matrix3d.Displacement(delta));changed.Add(p.Handle.ToString());continue;}if(op.ids.Contains(m.from)){var v=Port((BlockReference)index[m.from],tr);p.SetPointAt(0,new Point2d(v.X,v.Y));}if(op.ids.Contains(m.to)){var v=Port((BlockReference)index[m.to],tr);p.SetPointAt(p.NumberOfVertices-1,new Point2d(v.X,v.Y));}for(int i=1;i<p.NumberOfVertices;i++)Require(p.GetPoint3dAt(i).DistanceTo(p.GetPoint3dAt(i-1))>1e-6,"INVALID_PATH","Movement would create zero-length route.");changed.Add(p.Handle.ToString());}
   }else if(op.type=="update_route"||op.type=="add_route_label"){
    Require(index.ContainsKey(op.id)&&index[op.id] is Polyline,"ROUTE_NOT_FOUND",op.id);var p=(Polyline)index[op.id];var m=Metadata(p,tr);Require(m.kind=="route","ROUTE_NOT_FOUND",op.id);SafeEntity(db,tr,p,true);
    if(op.type=="add_route_label"){EditableLayer(db,tr,op.layer);var text=new DBText{Position=Point(op.position),Height=op.height,TextString=RouteText(m,p),Layer=op.layer,TextStyleId=EditingTextStyle(db,tr)};Append(Model(db,tr,OpenMode.ForWrite),text,tr);text.CreateExtensionDictionary();Write((DBDictionary)tr.GetObject(text.ExtensionDictionary,OpenMode.ForWrite),"CADBRIDGE_ROUTE_LABEL",new Meta{id=op.id},tr);created.Add(text.Handle.ToString());}
    else{
     p.UpgradeOpen();if(op.from!=null)m.from=op.from.id;if(op.to!=null)m.to=op.to.id;if(op.circuitId!=null)m.circuitId=op.circuitId;
     if(op.vertices!=null){var points=op.vertices.Select(Point).ToArray();for(int i=1;i<points.Length;i++)Require(points[i].DistanceTo(points[i-1])>1e-6,"INVALID_PATH","Zero-length route segment.");while(p.NumberOfVertices>points.Length)p.RemoveVertexAt(p.NumberOfVertices-1);for(int i=0;i<points.Length;i++){if(i<p.NumberOfVertices){p.SetPointAt(i,new Point2d(points[i].X,points[i].Y));p.SetBulgeAt(i,0);}else p.AddVertexAt(i,new Point2d(points[i].X,points[i].Y),0,0,0);}p.Closed=false;}
     Require(m.from!=m.to,"INVALID_PORT","Distinct route endpoints required.");Mark(p,m,tr);
     if(adapter!="generic"){
      var old=TangentAdapter.Data(p);Func<string,string> field=key=>old.ContainsKey(key)?String.Join("",old[key].Where(v=>v.code==1000).Select(v=>Convert.ToString(v.value))):null;
      var spec=op.wireSpec??new WireSpec();spec.wireType=spec.wireType??field("ltype");spec.conductorSpec=spec.conductorSpec??field("lnoar");spec.method=spec.method??field("lmeth");spec.installation=spec.installation??field("linst");spec.conduitDiameter=spec.conduitDiameter??field("ldm");TangentAdapter.MarkNewWire(db,tr,p,new Operation{circuitId=m.circuitId,wireSpec=spec});
     }else Require(op.wireSpec==null,"WIRE_SPEC_UNSUPPORTED","Wire specifications require a verified Tangent adapter.");changed.Add(p.Handle.ToString());
    }
   }else if(op.type=="trim"||op.type=="extend_line"){
    var e=ByHandle(db,tr,op.handle);SafeEntity(db,tr,e,false);var line=e as Line;Require(line!=null,"ENTITY_TYPE_UNSUPPORTED","Trim/extend currently support ordinary straight LINE entities.");line.UpgradeOpen();var original=line.EndPoint-line.StartPoint;
    if(op.type=="trim"){var a=Point(op.fromPoint);var b=Point(op.toPoint);Require(a.DistanceTo(b)>1e-6&&line.GetClosestPointTo(a,false).DistanceTo(a)<1e-6&&line.GetClosestPointTo(b,false).DistanceTo(b)<1e-6,"INVALID_TRIM","Keep endpoints must lie on the existing segment.");line.StartPoint=a;line.EndPoint=b;}
    else{var p=Point(op.position);var other=op.endpoint=="start"?line.EndPoint:line.StartPoint;var current=op.endpoint=="start"?line.StartPoint:line.EndPoint;Require(line.GetClosestPointTo(p,true).DistanceTo(p)<1e-6&&(p-other).DotProduct(current-other)>(current-other).LengthSqrd,"INVALID_EXTENSION","New endpoint must extend outward on the same line.");if(op.endpoint=="start")line.StartPoint=p;else line.EndPoint=p;}changed.Add(e.Handle.ToString());
   }else{
    Require(op.handles!=null&&op.handles.Length>0,"INVALID_ARGUMENT","Explicit handles required.");var targets=op.handles.Select(h=>ByHandle(db,tr,h)).ToArray();
    foreach(var e in targets){bool attrs=op.type=="set_attributes"||op.type=="set_layer";SafeEntity(db,tr,e,attrs);
     if(op.type=="set_attributes"){var br=e as BlockReference;Require(br!=null,"ENTITY_TYPE_UNSUPPORTED","Attributes require an ordinary block reference.");Require(!op.attributes.Keys.Any(k=>k.Equals("DEVICE_ID",StringComparison.OrdinalIgnoreCase)),"NUMBERING_OPERATION_REQUIRED","Use number_devices for DEVICE_ID.");foreach(var kv in op.attributes){bool found=false;foreach(ObjectId aid in br.AttributeCollection){var a=(AttributeReference)tr.GetObject(aid,OpenMode.ForRead);if(a.Tag.Equals(kv.Key,StringComparison.OrdinalIgnoreCase)){Require(!a.IsConstant,"ATTRIBUTE_CONSTANT",kv.Key);a.UpgradeOpen();a.TextString=kv.Value;found=true;}}Require(found,"ATTRIBUTE_NOT_FOUND",kv.Key);}changed.Add(e.Handle.ToString());}
     else if(op.type=="set_text"){e.UpgradeOpen();if(e is DBText){((DBText)e).TextString=op.text;if(op.text.Any(c=>c>127))((DBText)e).TextStyleId=EditingTextStyle(db,tr);}else if(e is MText){((MText)e).Contents=op.text;if(op.text.Any(c=>c>127))((MText)e).TextStyleId=EditingTextStyle(db,tr);}else throw new Fault("ENTITY_TYPE_UNSUPPORTED","Text update requires TEXT or MTEXT.");changed.Add(e.Handle.ToString());}
     else if(op.type=="set_layer"){EditableLayer(db,tr,op.layer);e.UpgradeOpen();e.Layer=op.layer;changed.Add(e.Handle.ToString());}
     else if(op.type=="erase"){e.UpgradeOpen();e.Erase();removed.Add(e.Handle.ToString());}
     else if(op.type=="offset"){var curve=e as Curve;Require(curve is Line||curve is Polyline||curve is Arc||curve is Circle,"ENTITY_TYPE_UNSUPPORTED","Offset requires ordinary planar line, polyline, arc or circle.");using(var offsets=curve.GetOffsetCurves(op.distance)){Require(offsets.Count>0,"OFFSET_FAILED","No offset geometry.");foreach(Entity copy in offsets){copy.Layer=e.Layer;Append(Model(db,tr,OpenMode.ForWrite),copy,tr);created.Add(copy.Handle.ToString());}}}
     else if(op.type=="array"){Require(op.rows*op.columns*targets.Length<=2000,"OPERATION_TOO_LARGE","Array limited to 2000 new entities.");for(int r=0;r<op.rows;r++)for(int c=0;c<op.columns;c++){if(r==0&&c==0)continue;created.Add(CopyEntity(db,tr,e,Matrix3d.Displacement(new Vector3d(c*op.columnSpacing,r*op.rowSpacing,0))).Handle.ToString());}}
     else{
      Matrix3d matrix;if(op.type=="move"||op.type=="copy")matrix=Matrix3d.Displacement(Point(op.delta)-Point3d.Origin);
      else if(op.type=="rotate")matrix=Matrix3d.Rotation(op.angleRadians,Vector3d.ZAxis,Point(op.center));
      else if(op.type=="scale")matrix=Matrix3d.Scaling(op.factor,Point(op.center));
      else if(op.type=="mirror")matrix=Matrix3d.Mirroring(new Line3d(Point(op.axisStart),Point(op.axisEnd)));
      else throw new Fault("INVALID_OPERATION",op.type);
      if(op.type=="copy"||(op.type=="mirror"&&op.copy))created.Add(CopyEntity(db,tr,e,matrix).Handle.ToString());else{TransformEntity(e,tr,matrix);changed.Add(e.Handle.ToString());}
     }
    }
   }
   return new{type=op.type,changed=changed,created=created,removed=removed};
  }
 }
}

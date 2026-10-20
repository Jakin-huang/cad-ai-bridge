using System;
using System.Linq;
using System.Collections.Generic;
using Autodesk.AutoCAD.DatabaseServices;
using Autodesk.AutoCAD.Geometry;
namespace CadAgent {
 public static partial class Commands {
  static void ReadQueryScope(Database db,Transaction tr,Request request,List<object> items,List<object> errors,ref int total,ref bool truncated){
   var scope=request.scope??new QueryScope{layout="Model"};string layoutName=scope.layout??"Model";BlockTableRecord owner=null;bool model=true;
   foreach(DBDictionaryEntry entry in (DBDictionary)tr.GetObject(db.LayoutDictionaryId,OpenMode.ForRead)){var layout=(Layout)tr.GetObject(entry.Value,OpenMode.ForRead);if(layout.LayoutName.Equals(layoutName,StringComparison.OrdinalIgnoreCase)){owner=(BlockTableRecord)tr.GetObject(layout.BlockTableRecordId,OpenMode.ForRead);model=layout.ModelType;break;}}
   Require(owner!=null,"LAYOUT_NOT_FOUND",layoutName);int matched=0,visited=0;bool incomplete=false;
   Action<Entity,Matrix3d,List<string>,int,HashSet<ObjectId>> visit=null;
   visit=(entity,matrix,parents,depth,definitions)=>{
    if(++visited>100000){incomplete=true;return;}
    var identity=parents.Concat(new[]{entity.Handle.ToString()}).ToList();
    try{
     if(Matches(entity,tr,request.filter,depth>0?(Matrix3d?)matrix:null)){
      matched++;if(items.Count<request.limit){var row=Describe(entity,tr);
       if(request.scope!=null){row["layout"]=layoutName;row["instancePath"]=identity;row["nested"]=depth>0;row["editableScope"]=model&&depth==0;}
       if(depth>0){
        foreach(var key in new[]{"position","start","end","center"})if(row.ContainsKey(key)){var p=(double[])row[key];row[key]=XY(new Point3d(p[0],p[1],p[2]).TransformBy(matrix));}
        if(row.ContainsKey("vertices"))row["vertices"]=((double[][])row["vertices"]).Select(p=>XY(new Point3d(p[0],p[1],p[2]).TransformBy(matrix))).ToArray();
        foreach(var key in new[]{"length","radius","measurement","rotationRadians","width","segmentWidths","height","widthFactor","textWidth","basisX","basisY","basisZ","bulges"})if(row.ContainsKey(key)){row["definition_"+key]=row[key];row.Remove(key);}
        try{var bounds=entity.GeometricExtents;bounds.TransformBy(matrix);row["bounds"]=new{min=XY(bounds.MinPoint),max=XY(bounds.MaxPoint)};}catch{}
       }items.Add(row);
      }
     }
     var block=entity as BlockReference;if(!scope.includeNested||block==null)return;
     var definition=(BlockTableRecord)tr.GetObject(block.BlockTableRecord,OpenMode.ForRead);if(definition.IsFromExternalReference)return;
     if(depth>=scope.maxDepth||definitions.Contains(definition.ObjectId)){incomplete=true;if(errors.Count<100)errors.Add(new{handle=entity.Handle.ToString(),message="Nested traversal depth/cycle limit reached; counts are incomplete."});return;}
     var ancestry=new HashSet<ObjectId>(definitions);ancestry.Add(definition.ObjectId);var transform=matrix*block.BlockTransform;
     foreach(ObjectId id in definition){var child=tr.GetObject(id,OpenMode.ForRead) as Entity;if(child!=null&&!(child is AttributeDefinition))visit(child,transform,identity,depth+1,ancestry);if(visited>100000)break;}
    }catch(System.Exception ex){if(errors.Count<100)errors.Add(new{handle=entity.Handle.ToString(),message=ex.Message});}
   };
   foreach(ObjectId id in owner){var entity=tr.GetObject(id,OpenMode.ForRead) as Entity;if(entity!=null)visit(entity,Matrix3d.Identity,new List<string>(),0,new HashSet<ObjectId>());if(visited>100000)break;}
   total=matched;truncated=incomplete;
  }
 }
}

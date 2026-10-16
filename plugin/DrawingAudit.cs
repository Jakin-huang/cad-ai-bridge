using System;
using System.Linq;
using System.Collections.Generic;
using Autodesk.AutoCAD.DatabaseServices;
using Autodesk.AutoCAD.Geometry;

namespace CadAgent {
    // Raw CAD census, separate from the electrical classification rules.
    public static class DrawingAudit {
        static void Count(Dictionary<string,int> map,string key){if(!map.ContainsKey(key))map[key]=0;map[key]++;}
        static double[] P(Point3d p){return new[]{p.X,p.Y,p.Z};}
        static object Bounds(Entity entity){try{var e=entity.GeometricExtents;return new{min=P(e.MinPoint),max=P(e.MaxPoint)};}catch{return null;}}
        static object PreviewData(Dictionary<string,List<XDatum>> data){return data.ToDictionary(p=>p.Key,p=>p.Value.Take(8).Select(v=>new{code=v.code,value=v.code==1004?"[binary omitted]":Convert.ToString(v.value).Length>256?Convert.ToString(v.value).Substring(0,256)+"[truncated]":v.value}).ToArray());}
        public static object Read(Database db){
            var types=new Dictionary<string,int>();var layers=new Dictionary<string,int>();var apps=new Dictionary<string,int>();
            var inserts=new List<object>();var definitions=new List<object>();var texts=new List<object>();var errors=new List<object>();
            using(var tr=db.TransactionManager.StartOpenCloseTransaction()){
                var blocks=(BlockTable)tr.GetObject(db.BlockTableId,OpenMode.ForRead);
                foreach(ObjectId bid in blocks){var b=(BlockTableRecord)tr.GetObject(bid,OpenMode.ForRead);if(b.IsLayout||b.IsFromExternalReference)continue;
                    var geometry=new List<object>();var attributes=new List<object>();int children=0;
                    foreach(ObjectId id in b){children++;if(id.IsNull||id.IsErased)continue;Entity entity;try{entity=tr.GetObject(id,OpenMode.ForRead) as Entity;}catch(System.Exception ex){errors.Add(new{handle=id.Handle.ToString(),message=ex.Message,scope="block-definition"});continue;}if(entity==null)continue;var a=entity as AttributeDefinition;
                        if(a!=null)attributes.Add(new{tag=a.Tag,text=a.TextString,constant=a.Constant,position=P(a.Position),height=a.Height});
                        if(geometry.Count<8){var curve=entity as Curve;object ends=null;try{if(curve!=null)ends=new{start=P(curve.StartPoint),end=P(curve.EndPoint)};}catch{}geometry.Add(new{type=entity.GetRXClass().DxfName,bounds=Bounds(entity),ends=ends});}
                    }
                    definitions.Add(new{name=b.Name,units=b.Units.ToString(),dynamic=b.IsDynamicBlock,anonymous=b.IsAnonymous,children=children,attributes=attributes,geometryPreview=geometry});
                }
                var model=(BlockTableRecord)tr.GetObject(blocks[BlockTableRecord.ModelSpace],OpenMode.ForRead);
                foreach(ObjectId id in model){try{var e=tr.GetObject(id,OpenMode.ForRead) as Entity;if(e==null)continue;Count(types,e.GetRXClass().DxfName);Count(layers,e.Layer);var data=TangentAdapter.Data(e);foreach(var key in data.Keys)Count(apps,key);
                    var br=e as BlockReference;if(br!=null){var attrs=new Dictionary<string,string>(StringComparer.OrdinalIgnoreCase);foreach(ObjectId aid in br.AttributeCollection){var a=(AttributeReference)tr.GetObject(aid,OpenMode.ForRead);attrs[a.Tag]=a.TextString;}
                        inserts.Add(new{handle=e.Handle.ToString(),blockName=br.Name,layer=e.Layer,position=P(br.Position),rotationRadians=br.Rotation,scale=new[]{br.ScaleFactors.X,br.ScaleFactors.Y,br.ScaleFactors.Z},normal=new[]{br.Normal.X,br.Normal.Y,br.Normal.Z},bounds=Bounds(br),attributes=attrs,xdata=PreviewData(data),dynamic=br.IsDynamicBlock,hasExtensionDictionary=!br.ExtensionDictionary.IsNull,persistentReactorCount=br.GetPersistentReactorIds().Count});}
                    var text=e as DBText;var mtext=e as MText;if(text!=null||mtext!=null)texts.Add(new{handle=e.Handle.ToString(),layer=e.Layer,text=text!=null?text.TextString:mtext.Contents,position=P(text!=null?text.Position:mtext.Location)});
                }catch(System.Exception ex){errors.Add(new{handle=id.Handle.ToString(),message=ex.Message});}}
            }
            return new{units=db.Insunits.ToString(),types=types,layers=layers,xdataApplications=apps,inserts=inserts,definitions=definitions,texts=texts,errors=errors,xdataPreview="At most 8 values per app, strings capped at 256 characters; binary omitted. Exported DXF retains full records.",scope="Raw model-space roots; block definitions listed separately; no classification inferred"};
        }
    }
}

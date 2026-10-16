using System;
using System.Linq;
using System.Collections.Generic;
using Autodesk.AutoCAD.DatabaseServices;
using Autodesk.AutoCAD.Geometry;

namespace CadAgent {
    public sealed class Scene { public SceneView view; public SceneNamedView[] views; public SceneLayer[] layers; public SceneSymbol[] symbols; public Primitive[] entities; }
    public sealed class SceneView { public double[] center; public double width,height; }
    public sealed class SceneNamedView { public string name; public double[] center; public double width,height; }
    public sealed class SceneLayer { public string name; public short color; }
    public sealed class SceneSymbol { public string name; public Primitive[] geometry; public SceneAttribute[] attributes; }
    public sealed class SceneAttribute { public string tag,value; public double[] position; public double height; public bool visible; }
    public sealed class Primitive { public string kind,layer,text; public double[][] points; public double[] position; public double height,radius,rotationRadians; public bool closed; }
    // Declarative geometry only. No commands, files, external references or evaluation.
    public static class SceneBuilder {
        static void Check(bool ok,string message){if(!ok)throw new Fault("INVALID_SCENE",message);}
        static Point3d P(double[] p){Check(p!=null&&p.Length==3&&p.All(n=>!Double.IsNaN(n)&&!Double.IsInfinity(n)&&Math.Abs(n)<=1e9)&&p[2]==0,"Invalid planar point");return new Point3d(p[0],p[1],0);}
        static void Positive(double n){Check(n>0&&n<=1e6&&!Double.IsNaN(n)&&!Double.IsInfinity(n),"Invalid size");}
        static void Append(BlockTableRecord b,Entity e,Transaction t){b.AppendEntity(e);t.AddNewlyCreatedDBObject(e,true);}
        static bool Name(string n){return n!=null&&System.Text.RegularExpressions.Regex.IsMatch(n,@"\A[A-Za-z0-9_-]{1,64}\z");}
        static Entity Make(Primitive p,HashSet<string> layers,ObjectId style){
            Check(p!=null&&layers.Contains(p.layer),"Undefined layer");Entity e;
            if(p.kind=="polyline"){
                Check(p.points!=null&&p.points.Length>=2&&p.points.Length<=1000,"Invalid polyline");var poly=new Polyline();
                foreach(var a in p.points){var v=P(a);poly.AddVertexAt(poly.NumberOfVertices,new Point2d(v.X,v.Y),0,0,0);}poly.Closed=p.closed;e=poly;
            }else if(p.kind=="circle"){Positive(p.radius);e=new Circle(P(p.position),Vector3d.ZAxis,p.radius);}
            else if(p.kind=="text"){
                Positive(p.height);Check(p.height<=10000&&p.text!=null&&p.text.Length>0&&p.text.Length<=512&&!p.text.Any(c=>c=='\r'||c=='\n'||c=='\0')&&!Double.IsNaN(p.rotationRadians)&&!Double.IsInfinity(p.rotationRadians),"Invalid text");
                e=new DBText{Position=P(p.position),Height=p.height,TextString=p.text,Rotation=p.rotationRadians,TextStyleId=style};
            }else throw new Fault("INVALID_SCENE","Unsupported primitive");
            e.Layer=p.layer;return e;
        }
        public static void Build(Database db,Transaction t,Scene scene){
            Check(scene!=null&&scene.layers!=null&&scene.layers.Length>0&&scene.layers.Length<=100&&scene.symbols!=null&&scene.symbols.Length<=100&&scene.entities!=null&&scene.entities.Length<=20000,"Scene bounds exceeded");
            var layers=new HashSet<string>(StringComparer.Ordinal){"0"};var lt=(LayerTable)t.GetObject(db.LayerTableId,OpenMode.ForWrite);
            foreach(var l in scene.layers){Check(l!=null&&Name(l.name)&&l.name.ToUpperInvariant()==l.name&&l.color>=1&&l.color<=255&&layers.Add(l.name),"Invalid or duplicate layer");if(!lt.Has(l.name)){var r=new LayerTableRecord{Name=l.name,Color=Autodesk.AutoCAD.Colors.Color.FromColorIndex(Autodesk.AutoCAD.Colors.ColorMethod.ByAci,l.color)};lt.Add(r);t.AddNewlyCreatedDBObject(r,true);}}
            var styles=(TextStyleTable)t.GetObject(db.TextStyleTableId,OpenMode.ForWrite);
            Check(!styles.Has("CADBRIDGE_CJK"),"Style already exists");var textStyle=new TextStyleTableRecord{Name="CADBRIDGE_CJK",FileName="msyh.ttc"};styles.Add(textStyle);t.AddNewlyCreatedDBObject(textStyle,true);
            var bt=(BlockTable)t.GetObject(db.BlockTableId,OpenMode.ForWrite);
            foreach(var s in scene.symbols){
                Check(s!=null&&Name(s.name)&&!bt.Has(s.name)&&s.geometry!=null&&s.geometry.Length>0&&s.geometry.Length<=100&&s.attributes!=null&&s.attributes.Length<=20,"Invalid or duplicate symbol");
                var b=new BlockTableRecord{Name=s.name,Units=UnitsValue.Millimeters};bt.Add(b);t.AddNewlyCreatedDBObject(b,true);
                foreach(var p in s.geometry)Append(b,Make(p,layers,textStyle.ObjectId),t);
                var tags=new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                foreach(var a in s.attributes){Check(a!=null&&Name(a.tag)&&tags.Add(a.tag)&&a.value!=null&&a.value.Length<=512,"Invalid attribute");Positive(a.height);Check(a.height<=10000,"Invalid attribute size");Append(b,new AttributeDefinition{Tag=a.tag,TextString=a.value,Position=P(a.position),Height=a.height,Invisible=!a.visible,TextStyleId=textStyle.ObjectId},t);}
            }
            var model=(BlockTableRecord)t.GetObject(bt[BlockTableRecord.ModelSpace],OpenMode.ForWrite);
            foreach(var p in scene.entities)Append(model,Make(p,layers,textStyle.ObjectId),t);
            if(scene.views!=null){
                Check(scene.views.Length<=100,"Too many named views");var table=(ViewTable)t.GetObject(db.ViewTableId,OpenMode.ForWrite);
                foreach(var v in scene.views){Check(v!=null&&Name(v.name)&&!table.Has(v.name)&&v.width>0&&v.width<=1e9&&v.height>0&&v.height<=1e9&&!Double.IsNaN(v.width)&&!Double.IsNaN(v.height),"Invalid named view");var cp=P(v.center);
                    var record=new ViewTableRecord{Name=v.name,CenterPoint=new Point2d(cp.X,cp.Y),Width=v.width,Height=v.height,ViewDirection=Vector3d.ZAxis,Target=Point3d.Origin,ViewTwist=0};table.Add(record);t.AddNewlyCreatedDBObject(record,true);
                }
            }
        }
        public static void SetView(Autodesk.AutoCAD.ApplicationServices.Document document,Scene scene){
            if(scene.view==null)return;var center=P(scene.view.center);
            Check(scene.view.width>0&&scene.view.width<=1e9&&scene.view.height>0&&scene.view.height<=1e9&&!Double.IsNaN(scene.view.width)&&!Double.IsNaN(scene.view.height),"Invalid initial view");
            using(var view=document.Editor.GetCurrentView()){
                double aspect=view.Width/view.Height;
                view.ViewDirection=Vector3d.ZAxis;view.Target=Point3d.Origin;view.ViewTwist=0;
                view.CenterPoint=new Point2d(center.X,center.Y);view.Height=Math.Max(scene.view.height,scene.view.width/aspect);view.Width=view.Height*aspect;
                document.Editor.SetCurrentView(view);
            }
        }
    }
}

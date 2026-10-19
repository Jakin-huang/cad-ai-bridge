using System;
using System.IO;
using System.Linq;
using Autodesk.AutoCAD.DatabaseServices;
using Autodesk.AutoCAD.Geometry;
using Autodesk.AutoCAD.PlottingServices;
using Autodesk.AutoCAD.ApplicationServices;
using App=Autodesk.AutoCAD.ApplicationServices.Core.Application;

namespace CadAgent {
 public static partial class Commands {
  static object ExportDrawing(Document doc,Request request,string directory){
   Require(request.format=="pdf"||request.format=="png","EXPORT_FORMAT_UNSUPPORTED","Expected PDF or PNG.");
   string format=request.format,output=Path.Combine(directory,"output."+format);Require(!File.Exists(output),"OUTPUT_EXISTS",output);
   var db=doc.Database;var manager=LayoutManager.Current;string previousLayout=manager.CurrentLayout;object background=App.GetSystemVariable("BACKGROUNDPLOT");
   try{
    Require(manager.LayoutExists(request.layout),"LAYOUT_NOT_FOUND",request.layout);manager.CurrentLayout=request.layout;
    App.SetSystemVariable("BACKGROUNDPLOT",0);
    using(var tr=db.TransactionManager.StartTransaction()){
     var layout=(Layout)tr.GetObject(manager.GetLayoutId(request.layout),OpenMode.ForRead);
     if(layout.ModelType){using(var view=doc.Editor.GetCurrentView()){view.ViewDirection=Vector3d.ZAxis;view.Target=Point3d.Origin;view.ViewTwist=0;doc.Editor.SetCurrentView(view);}}
     using(var settings=new PlotSettings(layout.ModelType)){
      settings.CopyFrom(layout);var validator=PlotSettingsValidator.Current;
      string device=format=="pdf"?"DWG To PDF.pc3":"PublishToWeb PNG.pc3";
      Require(validator.GetPlotDeviceList().Cast<string>().Any(s=>s.Equals(device,StringComparison.OrdinalIgnoreCase)),"PLOT_DEVICE_MISSING",device);
      validator.SetPlotConfigurationName(settings,device,null);validator.RefreshLists(settings);
      var media=validator.GetCanonicalMediaNameList(settings).Cast<string>().ToArray();Require(media.Length>0,"PLOT_MEDIA_MISSING",device);
      string paper=format=="pdf"?(media.FirstOrDefault(s=>s=="ISO_A4_(210.00_x_297.00_MM)")??media.FirstOrDefault(s=>s.Contains("A4"))):media.FirstOrDefault(s=>s.Contains("1600.00_x_1280.00"));
      paper=paper??media.First();validator.SetCanonicalMediaName(settings,paper);
      validator.SetPlotRotation(settings,PlotRotation.Degrees000);
      if(request.region!=null){Require(layout.ModelType,"PLOT_REGION_UNSUPPORTED","A WCS region is supported only for Model.");var a=Point(request.region.min);var b=Point(request.region.max);validator.SetPlotWindowArea(settings,new Extents2d(a.X,a.Y,b.X,b.Y));validator.SetPlotType(settings,Autodesk.AutoCAD.DatabaseServices.PlotType.Window);}
      else validator.SetPlotType(settings,Autodesk.AutoCAD.DatabaseServices.PlotType.Extents);
      validator.SetUseStandardScale(settings,true);validator.SetStdScaleType(settings,StdScaleType.ScaleToFit);validator.SetPlotCentered(settings,true);
      using(var info=new PlotInfo()){info.Layout=layout.ObjectId;info.OverrideSettings=settings;
       using(var check=new PlotInfoValidator()){check.MediaMatchingPolicy=MatchingPolicy.MatchEnabled;check.Validate(info);}
       Require(PlotFactory.ProcessPlotState==ProcessPlotState.NotPlotting,"PLOT_BUSY","Owned host is already plotting.");
       using(var engine=PlotFactory.CreatePublishEngine()){
        engine.BeginPlot(null,null);engine.BeginDocument(info,doc.Name,null,1,true,output);
        using(var page=new PlotPageInfo()){engine.BeginPage(page,info,true,null);engine.BeginGenerateGraphics(null);engine.EndGenerateGraphics(null);engine.EndPage(null);}
        engine.EndDocument(null);engine.EndPlot(null);
       }
      }
      Require(File.Exists(output)&&new FileInfo(output).Length>100,"PLOT_OUTPUT_MISSING","CAD did not produce a nonempty plot file.");
      return new{format=format,file=Path.GetFileName(output),device=device,media=paper,layout=request.layout,region=request.region,source="AutoCAD PlotEngine; actual drawing graphics, not reconstructed geometry."};
     }
    }
   }finally{App.SetSystemVariable("BACKGROUNDPLOT",background);manager.CurrentLayout=previousLayout;}
  }
 }
}
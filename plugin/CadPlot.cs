using System;
using System.IO;
using System.Linq;
using Autodesk.AutoCAD.DatabaseServices;
using Autodesk.AutoCAD.Geometry;
using Autodesk.AutoCAD.PlottingServices;
using Autodesk.AutoCAD.ApplicationServices;
using App=Autodesk.AutoCAD.ApplicationServices.Core.Application;

namespace CadAgent {
 public sealed class PlotContract { public string paper,orientation,scale,style;public double denominator=1; }
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
      var contract=request.plot;string requestedPaper=contract==null?"A4":contract.paper;
      string paper=format=="pdf"?(media.FirstOrDefault(s=>s.StartsWith("ISO_"+requestedPaper+"_("))??media.FirstOrDefault(s=>s.Contains("_"+requestedPaper+"_"))):media.FirstOrDefault(s=>s.Contains("1600.00_x_1280.00"));
      Require(contract==null||paper!=null,"PLOT_MEDIA_MISSING","Requested paper is unavailable: "+requestedPaper);paper=paper??media.First();validator.SetCanonicalMediaName(settings,paper);
      // Canonical ISO media may already be landscape. Rotate relative to its
      // actual dimensions, not relative to an assumed portrait paper.
      var paperSize=settings.PlotPaperSize;bool quarterTurn=contract!=null&&((paperSize.X>paperSize.Y)!=(contract.orientation=="landscape"));
      validator.SetPlotRotation(settings,quarterTurn?PlotRotation.Degrees090:PlotRotation.Degrees000);
      if(request.region!=null){Require(layout.ModelType,"PLOT_REGION_UNSUPPORTED","A WCS region is supported only for Model.");var a=Point(request.region.min);var b=Point(request.region.max);validator.SetPlotWindowArea(settings,new Extents2d(a.X,a.Y,b.X,b.Y));validator.SetPlotType(settings,Autodesk.AutoCAD.DatabaseServices.PlotType.Window);}
      else validator.SetPlotType(settings,Autodesk.AutoCAD.DatabaseServices.PlotType.Extents);
      if(contract!=null&&contract.scale=="fixed"){
       Require(db.Insunits==UnitsValue.Millimeters,"PLOT_UNITS_UNSUPPORTED","Fixed engineering scale requires declared millimeters.");Require(layout.ModelType,"PLOT_FIXED_LAYOUT_UNSUPPORTED","Fixed scale is supported for Model; paper layouts need their own viewport setup.");
       validator.SetPlotPaperUnits(settings,PlotPaperUnit.Millimeters);validator.SetUseStandardScale(settings,false);validator.SetCustomPrintScale(settings,new CustomScale(1,contract.denominator));
       var min=request.region!=null?Point(request.region.min):db.Extmin;var max=request.region!=null?Point(request.region.max):db.Extmax;var size=settings.PlotPaperSize;double w=quarterTurn?size.Y:size.X,h=quarterTurn?size.X:size.Y;
       // Conservative printable envelope; do not silently clip a fixed-scale request.
       Require((max.X-min.X)/contract.denominator<=w-20&&(max.Y-min.Y)/contract.denominator<=h-20,"PLOT_FIXED_SCALE_CLIPPED","Drawing/region cannot fit the conservative 10 mm margin at requested scale.");
      }else{validator.SetUseStandardScale(settings,true);validator.SetStdScaleType(settings,StdScaleType.ScaleToFit);}validator.SetPlotCentered(settings,true);
      if(contract!=null&&contract.style!=null){Require(validator.GetPlotStyleSheetList().Cast<string>().Any(s=>s.Equals(contract.style,StringComparison.OrdinalIgnoreCase)),"PLOT_STYLE_MISSING",contract.style);validator.SetCurrentStyleSheet(settings,contract.style);settings.PlotPlotStyles=true;}
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
      return new{format=format,file=Path.GetFileName(output),device=device,media=paper,layout=request.layout,region=request.region,requestedPlot=contract,actualPlot=new{paperSize=new[]{settings.PlotPaperSize.X,settings.PlotPaperSize.Y},rotation=settings.PlotRotation.ToString(),useStandardScale=settings.UseStandardScale,scaleNumerator=settings.CustomPrintScale.Numerator,scaleDenominator=settings.CustomPrintScale.Denominator,style=settings.CurrentStyleSheet},source="AutoCAD PlotEngine; actual drawing graphics, not reconstructed geometry. Font appearance and engineering layout still require visual review."};
     }
    }
   }finally{App.SetSystemVariable("BACKGROUNDPLOT",background);manager.CurrentLayout=previousLayout;}
  }
 }
}

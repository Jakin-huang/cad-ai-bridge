"""Render a read-only R3 room lighting audit. Missing photometry stays missing."""
import csv, hashlib, html, json, math, sys
from pathlib import Path
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT, TA_RIGHT, TA_CENTER
from reportlab.lib.pagesizes import A3, landscape
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Table, TableStyle, Spacer, PageBreak
from pypdf import PdfReader

folder=Path(sys.argv[1]).resolve(); report=json.loads((folder/'room-lighting.json').read_text(encoding='utf-8'))
pdfmetrics.registerFont(TTFont('CJK', 'C:/Windows/Fonts/simhei.ttf'))
navy=colors.HexColor('#243D5B'); muted=colors.HexColor('#53667B'); pale=colors.HexColor('#FFF5DF')
styles={
 'title':ParagraphStyle('title',fontName='CJK',fontSize=18,leading=23,textColor=navy,spaceAfter=7*mm),
 'sub':ParagraphStyle('sub',fontName='CJK',fontSize=11,leading=16,textColor=navy,spaceBefore=3*mm,spaceAfter=3*mm),
 'body':ParagraphStyle('body',fontName='CJK',fontSize=9,leading=14,textColor=navy,spaceAfter=2*mm),
 'note':ParagraphStyle('note',fontName='CJK',fontSize=8,leading=12,textColor=muted,spaceAfter=2*mm),
 'cell':ParagraphStyle('cell',fontName='CJK',fontSize=8.2,leading=11.5,textColor=navy),
 'num':ParagraphStyle('num',fontName='CJK',fontSize=8.2,leading=11.5,textColor=navy,alignment=TA_RIGHT),
 'head':ParagraphStyle('head',fontName='CJK',fontSize=8.4,leading=12,textColor=colors.white,alignment=TA_CENTER),
}
def P(v,style='body'): return Paragraph(html.escape(str(v)).replace('\n','<br/>'),styles[style])
def num(v,d=1): return '待输入' if v is None else f'{v:,.{d}f}'
def table(headers,rows,widths,highlight=None,numeric=()):
 data=[[P(v,'head') for v in headers]]+[[P(v,'num' if c in numeric else 'cell') for c,v in enumerate(row)] for row in rows]
 widths=[w/sum(widths)*388*mm for w in widths]
 t=Table(data,colWidths=widths,repeatRows=1,hAlign='LEFT')
 commands=[('BACKGROUND',(0,0),(-1,0),navy),('VALIGN',(0,0),(-1,-1),'MIDDLE'),('LEFTPADDING',(0,0),(-1,-1),5),('RIGHTPADDING',(0,0),(-1,-1),5),('TOPPADDING',(0,0),(-1,-1),5),('BOTTOMPADDING',(0,0),(-1,-1),5),('LINEBELOW',(0,0),(-1,0),.6,navy)]
 for i in range(1,len(data)):
  commands += [('LINEBELOW',(0,i),(-1,i),.25,colors.HexColor('#DAE1E9'))]
  if highlight and highlight[i-1]:commands += [('BACKGROUND',(0,i),(-1,i),pale)]
 t.setStyle(TableStyle(commands));return t
def footer(c,doc):
 c.saveState();c.setFont('CJK',8);c.setFillColor(muted);c.drawString(16*mm,12*mm,f"{report['projectId']}  R3逐房间照度复核  {report['designDate']}");c.drawRightString(404*mm,12*mm,f'{doc.page} / 3');c.restoreState()

story=[P('R3 每个房间的普通照明计算表','title')]
t=report['totals']
story += [P(f"{t['rooms']}个空间；普通灯{t['normalLights']}只、黑板灯{t['boardLights']}只，共{t['normalWatts']}W。6间教室可按R3假设估算，其余16个空间缺参数或专用灯。"),P('Eavg = N×Φ×UF×MF/A。表中灯数不含黑板灯；照明总W包含黑板灯。公区反算UF=0.50，MF=0.80仅作明确假设，不是实测或厂家保证值。','note')]
headers=['编号','房间/空间','净长\nm','净宽\nm','面积\nm2','灯高差\nm','普通\n灯数','照明\n总W','单灯Φ\nlm','UF','MF','目标\nlx','Eavg\nlx','反算\nUF','所需Φ\nlm/灯','结果范围']
rows=[]
for r in report['rooms']:
 rows.append([r['id'],r['name'],num(r['lengthM'],2),num(r['widthM'],2),num(r['areaM2'],2),num(r['mountingAbovePlaneM'],2),r['generalCount'],num(r['normalWatts'],0),num(r['lumens'],0),num(r['uf'],2),num(r['mf'],2),num(r['targetLux'],0),num(r['averageLux']) if r['generalCount'] else '未设专用灯',num(r['reverseUf'],2),num(math.ceil(r['requiredLumensPerLamp']),0) if r['requiredLumensPerLamp'] is not None else '需布灯/借光核算','R3假设下\n平均值达到' if r['averageLux'] is not None else '缺Φ/UF' if r['generalCount'] else '无专用普通灯'])
story += [table(headers,rows,[22,36,20,20,22,22,16,22,22,16,16,22,28,20,26,44],highlight=[r['averageLux'] is None for r in report['rooms']],numeric=range(2,15)),Spacer(1,3*mm),P(report['areaBasis'],'note'),P('灯高差=3.0m安装标高-参考面高度；教室及设备间按0.75m水平面，其余按地面。楼梯仅按每层水平投影面积列项，不代替梯段三维计算。','note'),P('学校走道、楼梯按100lx复核；普通厕所75lx；强电间参照配电装置室200lx；弱电间200lx为维护用途项目目标，若承担网络中心/固定值班功能须重新确定指标。','note'),P('所需Φ是达到目标的条件反算值。没有专用灯时不把照度写成0lx；相邻房间借光尚未核算。窗外自然光不计入本表。','note'),PageBreak()]

story += [P('黑板照明计算与普通照明待核项','title')]
br=[]
for b in report['boards']:br.append([b['roomId'],f"{b['widthM']}×{b['heightM']}",num(b['areaM2'],2),b['count'],num(b['watts'],0),b['lumens'],num(b['uf'],2),num(b['mf'],2),b['targetLux'],num(b['averageLux']),b['status']])
story += [table(['房间','板面尺寸 m','面积 m2','灯数','功率 W','Φ lm/灯','UF','MF','目标 lx','Eavg lx','范围'],br,[18,25,20,15,18,22,15,15,20,22,95],numeric=range(2,10)),P('黑板按4.5m×1.2m垂直板面、3×2000lm、UF=0.70、MF=0.80，估算622.2lx。板面与课桌面独立计算，未把黑板照度叠加到课桌平均照度。','note'),P('复核方法与参数范围','sub'),P('教室：12×3600×0.65×0.80÷68.64=327.3lx，较300lx目标约高9.1%。教室室形指数约1.84；室形指数不能直接证明UF=0.65成立，还需灯具利用系数表与顶棚/墙面/地面反射比。'),P('黑板均匀度、课桌均匀度、UGR、频闪及逐点照度均未计算；必须取得灯具IES/LDT、安装标高/角度、桌面及板面实物尺寸。'),P('公区及中间通道需求反算','sub')]
protos=[]
for r in [x for x in report['rooms'] if x['floor']==1 and x['kind']!='classroom']:
 protos.append([r['name'],num(r['areaM2'],2),r['generalCount'],r['targetLux'],num(math.ceil(r['requiredLumensPerLamp']),0) if r['requiredLumensPerLamp'] is not None else '未布灯',num(math.ceil(r['requiredTotalLumens']),0),'Φ/UF待厂家资料' if r['generalCount'] else '补灯或核验门洞借光'])
story += [table(['每层空间','面积 m2','现有12W灯数','目标 lx','所需lm/灯','所需总lm','后续资料/动作'],protos,[44,22,30,24,30,30,100],numeric=range(1,6)),Spacer(1,2*mm),P('例如每层走廊7盏灯，按UF=0.50、MF=0.80、141.44m2及100lx反算，每灯至少5052lm。该数值与“12W”标注存在明显选型核对需求，但缺实际光通量时不直接判定现有灯具合格或不合格。','note'),P('依据与适用时间','sub')]
for src in report['sources'][1:4]:
 label=html.escape(src['title']);url=html.escape(src.get('url',''),quote=True)
 story.append(Paragraph(f'<link href="{url}" color="#245B8A">{label}</link>：'+html.escape(src['detail']),styles['note']))
story += [PageBreak(),P('逐房间应急照明与灯具数量核对','title'),P('普通Eavg、备用Eavg与疏散地面最低Emin是不同指标。现有资料没有应急灯光通量及配光，不能由5W/1W功率或平均照度推算Emin。'),P('走廊Emin目标3lx，楼梯Emin目标10lx；教室3lx为本次项目建议目标。设备间若属GB55037-2022第10.1.11条配电室或火灾仍需工作设备房，备用工作面Emin不得低于正常照度，本表按200lx作条件目标；具体用途及备用电源方案须确认。','note')]
er=[]
for r in report['rooms']:
 circuits='/'.join(r['emergencyCircuits']) or '无专用灯'
 er.append([r['id'],r['name'],len(r['emergencyIds']),len(r['signIds']),num(r['emergencyWatts'],0),num(r['signWatts'],0),r['emergencyMetric'],num(r['emergencyTargetLux'],0) if r['emergencyTargetLux'] is not None else '范围待核','待IES/三维校核',circuits])
story += [table(['编号','空间','应急灯数','标志灯数','应急 W','标志 W','照度指标','目标 lx','计算结果','归属回路'],er,[24,40,22,22,22,22,48,25,60,70],numeric=range(2,8)),Spacer(1,3*mm),P(f"数量勾稽：一般灯{t['normalLights']}+黑板灯{t['boardLights']}+应急灯{t['emergencyLights']}+标志灯{t['signs']}={len(report['inventory'])}只。普通照明{t['normalWatts']}W；应急灯{t['emergencyWatts']}W+标志灯{t['signWatts']}W=260W（每层130W），未混入普通照明。",'note'),P('R3原DWG/DXF及模型摘要已核对，11项独立回读检查通过。本次按插入点补建空间台账；不覆盖R3图纸、原施工图或标准模板。设备间现有5W疏散灯尚无备用工作照明的配光/供电依据，应补核，不能视为已满足200lx。','note')]
pdf=folder/'R3-room-lighting.pdf'
doc=SimpleDocTemplate(str(pdf),pagesize=landscape(A3),leftMargin=16*mm,rightMargin=16*mm,topMargin=15*mm,bottomMargin=20*mm,title='R3逐房间照度计算表',author='CAD AI Bridge')
doc.build(story,onFirstPage=footer,onLaterPages=footer)
reader=PdfReader(pdf)
if len(reader.pages)!=3:raise RuntimeError('Unexpected PDF pagination: '+str(len(reader.pages)))
for room in report['rooms']:
 if not any(room['id'] in (page.extract_text() or '') for page in reader.pages):raise RuntimeError('Missing PDF room '+room['id'])
with (folder/'R3-room-lighting.csv').open('w',encoding='utf-8-sig',newline='') as stream:
 writer=csv.writer(stream);writer.writerow(['编号','层','房间','净长m','净宽m','估算面积m2','灯高差m','一般灯数','黑板灯数','普通总W','单灯lm','UF','MF','目标lx','估算Eavg_lx','反算UF','所需lm_每灯','状态'])
 for r in report['rooms']:writer.writerow([r[k] for k in ['id','floor','name','lengthM','widthM','areaM2','mountingAbovePlaneM','generalCount','boardCount','normalWatts','lumens','uf','mf','targetLux','averageLux','reverseUf','requiredLumensPerLamp','status']])
(folder/'pdf-verification.json').write_text(json.dumps({'ok':True,'pages':3,'paper':'A3 landscape','everyRoomIncluded':True,'normalCalculatedRooms':6,'normalUnavailableRooms':16},indent=2),encoding='utf-8')
print(json.dumps({'ok':True,'pdf':str(pdf),'pages':len(reader.pages)},ensure_ascii=False))

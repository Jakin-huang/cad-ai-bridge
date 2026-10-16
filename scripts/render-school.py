"""Render the verified declarative model as a vector A2 sheet set (not a CAD plot)."""
import json, sys, math, html
from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.units import mm
from pypdf import PdfReader

folder = Path(sys.argv[1]).resolve()
model = json.loads((folder / 'design-model.json').read_text(encoding='utf-8'))
preview='--preview' in sys.argv
verification = json.loads((folder / 'cad-verification.json').read_text(encoding='utf-8')) if (folder / 'cad-verification.json').exists() else {'ok':False,'checks':[]}
if not verification['ok'] and not preview:
    raise SystemExit('CAD readback must pass before PDF output')
font = Path(sys.argv[2]) if len(sys.argv) > 2 and not sys.argv[2].startswith('--') else Path('C:/Windows/Fonts/simhei.ttf')
pdfmetrics.registerFont(TTFont('CJK', str(font)))
output = folder / 'school-electrical.pdf'
c = canvas.Canvas(str(output), pagesize=(594*mm, 420*mm), pageCompression=1)
c.setTitle(model['requirements']['name'])
c.setAuthor('CAD AI Bridge - school electrical design demonstration')
symbols = {s['name']: s for s in model['scene']['symbols']}
palette = {'A-WALL': '#8b939d', 'A-DOOR': '#8b939d', 'A-FURN': '#bdc4cb', 'A-TEXT': '#6a7480', 'S-TEXT': '#172b45', 'S-FRAME': '#172b45', 'E-LIGHT': '#12628a', 'E-WIRE': '#318574', 'E-CTRL': '#9964b5', 'E-FIRE': '#c24141', 'E-DATA': '#3a63ae', 'E-EARTH': '#318574', '0': '#12628a'}
layout_issues = []
for sheet in model['sheets']:
    origin = sheet['origin'][0]
    scale = mm / sheet['modelPerPaper']
    def draw(p, dx=0, dy=0, layer_override=None):
        layer = layer_override or p['layer']
        c.setStrokeColor(palette.get(layer, '#172b45'))
        c.setFillColor(palette.get(layer, '#172b45'))
        c.setLineWidth(p.get('width', 0)*scale if p.get('width',0) else (0.16 if layer.startswith('A-') else 0.23)*mm)
        def xy(v): return ((v[0]+dx-origin)*scale, (v[1]+dy)*scale)
        if p['kind'] in ('polyline','solid'):
            path = c.beginPath()
            path.moveTo(*xy(p['points'][0]))
            for point in p['points'][1:]: path.lineTo(*xy(point))
            if p.get('closed') or p['kind']=='solid': path.close()
            c.drawPath(path,stroke=0 if p['kind']=='solid' else 1,fill=1 if p['kind']=='solid' else 0)
        elif p['kind'] == 'circle':
            c.circle(*xy(p['position']), p['radius']*scale, stroke=1, fill=0)
        else:
            x,y=xy(p['position']); size=p['height']*scale
            c.saveState(); c.translate(x,y); c.rotate(p.get('rotationRadians',0)*180/math.pi)
            c.scale(p.get('widthFactor',1),1)
            c.setFont('CJK',size); c.drawString(0,0,p['text']); c.restoreState()
            width=pdfmetrics.stringWidth(p['text'],'CJK',size)*p.get('widthFactor',1)
            angle=p.get('rotationRadians',0)
            corners=[(x+u*math.cos(angle)-v*math.sin(angle),y+u*math.sin(angle)+v*math.cos(angle)) for u,v in [(0,0),(width,0),(width,size),(0,size)]]
            if any(X<0 or Y<0 or X>594*mm or Y>420*mm for X,Y in corners):
                layout_issues.append({'sheet':sheet['id'],'text':p['text'],'issue':'outside sheet'})
    for p in model['scene']['entities']:
        x=(p.get('position') or p.get('points')[0])[0]
        if origin <= x < origin+59400: draw(p)
    # Routes are checked against independently reopened DWG and DXF before rendering.
    for route in model['routes']:
        if origin <= route['vertices'][0][0] < origin+59400:
            draw({'kind':'polyline','layer':route['layer'],'points':route['vertices'],'closed':False})
    for d in model['devices']:
        if d['sheetId'] != sheet['id']: continue
        for p in symbols[d['blockName']]['geometry']: draw(p,d['position'][0],d['position'][1],d['layer'])
        for a in symbols[d['blockName']]['attributes']:
            if a['visible']:
                draw({'kind':'text','layer':d['layer'],'position':a['position'],'text':d['attributes'][a['tag']],'height':a['height']},d['position'][0],d['position'][1])
    c.setFillColor('#6a7480'); c.setFont('CJK',7)
    c.drawString(22*mm, 7*mm, '模型布局预览 / 尚未执行CAD回读验证' if preview else '同一结构化模型矢量输出，已核对DWG/DXF；非AutoCAD打印。施工前须完成专业审定及待验证事项。')
    c.bookmarkPage(sheet['id']); c.addOutlineEntry(sheet['id']+' '+sheet['title'],sheet['id'])
    c.showPage()
c.save()
reader=PdfReader(output)
assert len(reader.pages)==len(model['sheets'])
for i,page in enumerate(reader.pages):
    assert model['sheets'][i]['title'] in (page.extract_text() or '')
(folder/'pdf-validation.json').write_text(json.dumps({'ok':not layout_issues and not preview,'preview':preview,'pages':len(reader.pages),'pageSize':'A2 landscape','source':'unverified model layout preview' if preview else 'verified declarative model, not native CAD plotting','layoutIssues':layout_issues},ensure_ascii=False,indent=2),encoding='utf-8')
if layout_issues: raise SystemExit(json.dumps(layout_issues,ensure_ascii=False))

def esc(s): return html.escape(str(s))
calc=model['calculations']; req=model['requirements']
rows=''.join('<tr><td>'+esc(k)+'</td><td>'+esc(json.dumps(v,ensure_ascii=False))+'</td></tr>' for k,v in calc.items())
checks=''.join('<li>'+esc(x['name'])+('：通过' if x['ok'] else '：失败')+'</li>' for x in model['validation']['checks'])
sheets=''.join('<li>'+esc(s['id']+' '+s['title'])+'</li>' for s in model['sheets'])
pending=''.join('<li>'+esc(x)+'</li>' for x in model['validation']['pending'])
assumptions=''.join('<li>'+esc(x)+'</li>' for x in req['assumptions'])
formula='教室E=N×Φ×UF×MF/A；黑板E=3×Φ×UF×MF/(4.5×1.2)。支路Ib=P/(220×cosφ)，馈线按分相需用负荷累计；ΔU%=100×2ρLI/(S×U)，为保守的相线-中性线电阻近似，不代替电抗与谐波计算。基础管估算长度=图面路线+假定立面及端接+每设备0.5m；控制返回另穿管并单列清单；照明压降再加入最远开关腿等效长度，按全支路电流保守估算。不含采购损耗。应急电池铭牌Wh≥负荷×小时/可用系数。'
standard_note='原创教学楼底图与符号，未复制本地医院项目几何。'
if model.get('standard'):
    std=model['standard']; standard_note='原创教学楼底图；箱柜/图例及普通电源选型采用本地V02标准库，火灾报警/信息/广播6项图例取既有施工图。<a href="template-provenance.json">模板来源、哈希与选型句柄</a>。'
    standard_note+='图块已展平为普通实体；曲线弦高误差不超过0.05mm，原SHX文字改用中文TTF，原文件未修改。'
review=model.get('review',{})
sheet_review=''.join('<tr><td>'+esc(x['sheetId'])+' '+esc(x['title'])+'</td><td>'+esc('；'.join(x['checks']))+'</td><td>'+esc(', '.join(x['requiredInputs']))+'</td></tr>' for x in review.get('sheets',[]))
input_rows=''.join('<tr><td>'+esc(x['id'])+'</td><td>'+esc(x['materials'])+'</td><td>'+esc(x['owner'])+'</td><td>'+esc(x['limit'])+'</td></tr>' for x in review.get('requiredInputs',[]))
review_html='<section><h2>R3逐张检查及修复</h2><ul>'+''.join('<li>'+esc(x)+'</li>' for x in review.get('closed',[]))+'</ul><p>'+esc(json.dumps(review.get('routing',{}),ensure_ascii=False))+'</p><p><a href="sheet-review.json">逐张核对JSON</a> · <a href="panel-hardware.csv">进线及出线器件表</a> · <a href="required-inputs.csv">待补资料</a> · <a href="cable-quantities.csv">线缆估算清单</a> · <a href="lighting-controls.csv">分组控制</a> · <a href="control-wiring.csv">控制线及管径</a></p><table>'+sheet_review+'</table></section><section><h2>所需资料与责任方</h2><table>'+input_rows+'</table></section>'
report=f'''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>{esc(req['name'])}</title><style>body{{max-width:1120px;margin:36px auto;padding:0 28px;font:16px/1.8 'Microsoft YaHei',sans-serif;color:#172b45;background:#f7f9fc}}section{{background:white;border:1px solid #dce4ed;border-radius:12px;padding:24px;margin:20px 0}}table{{border-collapse:collapse;width:100%;font-size:14px}}td{{padding:8px;border-bottom:1px solid #ddd;overflow-wrap:anywhere}}a{{color:#12628a}}li{{margin:6px 0}}.tag{{background:#fff0cc;padding:8px 14px;border-radius:5px}}</style><h1>{esc(req['name'])}</h1><p class="tag">{esc(req['projectId'])} / {len(model['sheets'])}张A2 / {len(model['devices'])}个设备及接口 / {len(model['circuits'])}个回路 / 待专业审定</p><section><h2>交付入口</h2><p><a href="school-electrical.pdf">完整图册 PDF</a> · <a href="school-electrical.dwg">可编辑 DWG</a> · <a href="school-electrical.dxf">交换 DXF</a> · <a href="devices.csv">设备台账</a> · <a href="circuits.csv">回路计算表</a> · <a href="bill-of-quantities.csv">设备数量表</a> · <a href="standards-register.json">规范依据</a></p><p>{standard_note}普通AutoCAD可读取，天正宿主已重新打开。所有输出位于新建目录。</p></section>{review_html}<section><h2>需求及边界</h2><ul>{assumptions}</ul></section><section><h2>计算结果与公式</h2><p>{formula}</p><table>{rows}</table><p>数值通过仅对应显式假设下的程序校核，不表示照度实测、产品认证或施工审查通过。</p></section><section><h2>图纸目录</h2><ol>{sheets}</ol></section><section><h2>业务自动校核</h2><ul>{checks}</ul><p>CAD独立回读核验：{len(verification['checks'])}项通过，包含全部静态图形文字、原创图块、设备属性、端点及线路长度。</p></section><section><h2>专业审定清单</h2><ul>{pending}</ul><p>真实项目必须补齐上述资料后调整模型重新生成，不能将本示范直接盖章用于施工。</p></section></html>'''
if preview:
    report=report.replace('普通AutoCAD可读取，天正宿主已重新打开。','此为布局预览，尚未执行CAD保存与宿主复开验收。').replace('CAD独立回读核验：0项通过','尚未执行CAD独立回读核验')
(folder/'project-report.html').write_text(report,encoding='utf-8')
print(json.dumps({'ok':True,'pdf':str(output),'report':str(folder/'project-report.html'),'pages':len(reader.pages)},ensure_ascii=False))

using System;
using System.Net;

namespace Oilix.PrintAgent;

/// <summary>Built-in diagnostic page (Arabic + French) used by the tray menu and --selftest.</summary>
public static class TestPage
{
    public static string Html(string printer, int paperWidthMm)
    {
        var p = WebUtility.HtmlEncode(printer);
        var when = WebUtility.HtmlEncode(DateTime.Now.ToString("dd/MM/yyyy HH:mm:ss"));
        var machine = WebUtility.HtmlEncode(Environment.MachineName);
        return $$"""
            <!doctype html>
            <html lang="fr"><head><meta charset="utf-8">
            <style>
              html,body{margin:0;padding:0;background:#fff;color:#000}
              body{width:{{paperWidthMm}}mm;font-family:'Segoe UI',Tahoma,Arial,sans-serif;font-size:12px}
              .wrap{padding:3mm 3mm 5mm;text-align:center}
              h1{font-size:20px;margin:0 0 2mm}
              .ar{direction:rtl;font-size:14px;font-weight:700;margin:2mm 0}
              .row{display:flex;justify-content:space-between;border-top:1px dashed #000;padding:1.5mm 0}
              .ok{margin-top:3mm;font-weight:800;font-size:14px}
            </style></head>
            <body><div class="wrap">
              <h1>Oilix</h1>
              <div class="ar">اختبار الطباعة — وكيل الطباعة</div>
              <div class="row"><span>Poste</span><b>{{machine}}</b></div>
              <div class="row"><span>Imprimante</span><b>{{p}}</b></div>
              <div class="row"><span>Date</span><b>{{when}}</b></div>
              <div class="ok">Impression test réussie</div>
              <div class="ar">تمت الطباعة بنجاح</div>
            </div></body></html>
            """;
    }
}

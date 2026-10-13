using System;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using Oilix.PrintAgent.Core;

namespace Oilix.PrintAgent;

/// <summary>
/// Renders a static HTML document in an off-screen WebView2 (Chromium — full Arabic shaping,
/// RTL, Oilix CSS) and prints it silently to a named Windows printer.
/// Scripts are disabled and every network request is refused: the document must be self-contained.
/// </summary>
public sealed class PrintEngine : IDisposable
{
    private const string JobHost = "print.oilix.invalid";
    private const string JobCsp =
        "default-src 'none'; style-src 'unsafe-inline' data:; font-src data:; img-src data:; script-src 'none'";

    private readonly HostForm _host;
    private readonly WebView2 _view;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private CoreWebView2Environment? _env;
    private string? _currentUrl;
    private byte[]? _currentHtml;

    /// <summary>Must be constructed on the UI (STA) thread.</summary>
    public PrintEngine()
    {
        _host = new HostForm();
        _view = new WebView2 { Dock = DockStyle.Fill };
        _host.Controls.Add(_view);
        _host.Show();
    }

    public async Task InitializeAsync()
    {
        var profile = Path.Combine(AgentInfo.DataDirectory, "WebView2");
        _env = await CoreWebView2Environment.CreateAsync(null, profile);
        RuntimeVersion = _env.BrowserVersionString;
        await _view.EnsureCoreWebView2Async(_env);
        var core = _view.CoreWebView2;

        var s = core.Settings;
        s.IsScriptEnabled = false;
        s.AreDefaultContextMenusEnabled = false;
        s.AreDevToolsEnabled = false;
        s.IsWebMessageEnabled = false;
        s.IsStatusBarEnabled = false;
        s.AreDefaultScriptDialogsEnabled = false;
        s.IsPasswordAutosaveEnabled = false;
        s.IsGeneralAutofillEnabled = false;

        core.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All);
        core.WebResourceRequested += OnWebResourceRequested;
        core.NavigationStarting += (_, e) =>
        {
            if (e.Uri != _currentUrl && e.Uri != "about:blank") e.Cancel = true;
        };
        core.NewWindowRequested += (_, e) => e.Handled = true;
        core.PermissionRequested += (_, e) => e.State = CoreWebView2PermissionState.Deny;
        core.DownloadStarting += (_, e) => e.Cancel = true;
    }

    /// <summary>Captured on the UI thread: WebView2 objects must not be touched from Kestrel threads.</summary>
    public string RuntimeVersion { get; private set; } = "unknown";

    public async Task<PrintJobResult> PrintAsync(ValidatedPrintJob job, CancellationToken ct)
    {
        await _gate.WaitAsync(ct);
        try
        {
            return await OnUiThread(() => PrintOnUiAsync(job));
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <summary>Diagnostics only: renders built-in HTML to a PDF inside the agent data folder.</summary>
    public async Task<bool> RenderPdfAsync(string html, PageLayout layout, string outputPath)
    {
        await _gate.WaitAsync();
        try
        {
            return await OnUiThread(async () =>
            {
                if (!await LoadAsync(Guid.NewGuid(), html, layout)) return false;
                var measured = await MeasureAsync(layout);
                var settings = BuildSettings(measured, null, 1);
                return await _view.CoreWebView2.PrintToPdfAsync(outputPath, settings);
            });
        }
        finally
        {
            _gate.Release();
        }
    }

    private async Task<PrintJobResult> PrintOnUiAsync(ValidatedPrintJob job)
    {
        var id = job.JobId.ToString();
        var sw = Stopwatch.StartNew();
        try
        {
            if (!await LoadAsync(job.JobId, job.Html, job.Layout))
                return PrintJobResult.Failed(id, job.Printer, job.Copies, PrintErrorCodes.PrintFailed, "Rendu du document impossible");

            var layout = await MeasureAsync(job.Layout);
            var settings = BuildSettings(layout, job.Printer, job.Copies);
            var status = await _view.CoreWebView2.PrintAsync(settings);
            return status switch
            {
                CoreWebView2PrintStatus.Succeeded => PrintJobResult.Submitted(id, job.Printer, job.Copies, sw.ElapsedMilliseconds),
                CoreWebView2PrintStatus.PrinterUnavailable => PrintJobResult.Failed(id, job.Printer, job.Copies,
                    PrintErrorCodes.PrinterUnavailable, "Imprimante indisponible (hors ligne, éteinte ou déconnectée)"),
                _ => PrintJobResult.Failed(id, job.Printer, job.Copies, PrintErrorCodes.PrintFailed, "Échec de l'impression"),
            };
        }
        catch (ArgumentException)
        {
            return PrintJobResult.Failed(id, job.Printer, job.Copies, PrintErrorCodes.PrinterNotFound, "Imprimante introuvable sur ce poste");
        }
        catch (Exception ex)
        {
            AgentLog.Write("print", $"job {id} exception {ex.GetType().Name}");
            return PrintJobResult.Failed(id, job.Printer, job.Copies, PrintErrorCodes.PrintFailed, "Échec de l'impression");
        }
        finally
        {
            _currentHtml = null;
            _currentUrl = null;
            try { _view.CoreWebView2.Navigate("about:blank"); } catch { }
        }
    }

    private async Task<bool> LoadAsync(Guid jobId, string html, PageLayout layout)
    {
        var core = _view.CoreWebView2;
        _host.ClientSize = new Size(Math.Max(200, layout.ContentWidthPx), 900);
        _currentHtml = Encoding.UTF8.GetBytes(html);
        _currentUrl = $"https://{JobHost}/job/{jobId:N}";

        var done = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        void Handler(object? _, CoreWebView2NavigationCompletedEventArgs e) => done.TrySetResult(e.IsSuccess);
        core.NavigationCompleted += Handler;
        try
        {
            core.Navigate(_currentUrl);
            var finished = await Task.WhenAny(done.Task, Task.Delay(TimeSpan.FromSeconds(15)));
            if (finished != done.Task || !done.Task.Result) return false;
        }
        finally
        {
            core.NavigationCompleted -= Handler;
        }

        // Embedded (data:) fonts load asynchronously; wait briefly so Arabic glyphs are final.
        for (var i = 0; i < 20; i++)
        {
            var status = await TryScriptAsync("document.fonts ? document.fonts.status : 'loaded'");
            if (status is null || status.Contains("loaded")) break;
            await Task.Delay(50);
        }
        return true;
    }

    private async Task<PageLayout> MeasureAsync(PageLayout layout)
    {
        if (!layout.IsReceipt) return layout;
        var raw = await TryScriptAsync(
            "Math.ceil(Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0))");
        if (raw is not null && double.TryParse(raw, NumberStyles.Float, CultureInfo.InvariantCulture, out var px) && px > 0)
            return layout.WithMeasuredHeight(px * 25.4 / 96);
        return layout;
    }

    private CoreWebView2PrintSettings BuildSettings(PageLayout layout, string? printer, int copies)
    {
        var s = _env!.CreatePrintSettings();
        if (printer is not null) s.PrinterName = printer;
        s.Copies = copies;
        s.ShouldPrintBackgrounds = true;
        s.ShouldPrintHeaderAndFooter = false;
        s.ShouldPrintSelectionOnly = false;
        s.ScaleFactor = 1.0;
        s.MediaSize = CoreWebView2PrintMediaSize.Custom;
        s.Orientation = layout.Landscape
            ? CoreWebView2PrintOrientation.Landscape
            : CoreWebView2PrintOrientation.Portrait;
        // PageWidth/PageHeight describe the portrait sheet; orientation rotates it.
        var w = layout.Landscape ? layout.HeightMm : layout.WidthMm;
        var h = layout.Landscape ? layout.WidthMm : layout.HeightMm;
        s.PageWidth = PageLayout.ToInches(w);
        s.PageHeight = PageLayout.ToInches(h);
        var m = PageLayout.ToInches(layout.MarginMm);
        s.MarginTop = m;
        s.MarginBottom = m;
        s.MarginLeft = m;
        s.MarginRight = m;
        return s;
    }

    private async Task<string?> TryScriptAsync(string script)
    {
        try
        {
            return await _view.CoreWebView2.ExecuteScriptAsync(script);
        }
        catch
        {
            return null;
        }
    }

    private void OnWebResourceRequested(object? sender, CoreWebView2WebResourceRequestedEventArgs e)
    {
        var uri = e.Request.Uri;
        if (_currentUrl is not null && _currentHtml is not null && uri == _currentUrl)
        {
            e.Response = _env!.CreateWebResourceResponse(
                new MemoryStream(_currentHtml, writable: false),
                200,
                "OK",
                $"Content-Type: text/html; charset=utf-8\r\nContent-Security-Policy: {JobCsp}");
            return;
        }
        e.Response = _env!.CreateWebResourceResponse(null, 403, "Blocked", "");
        if (Uri.TryCreate(uri, UriKind.Absolute, out var u))
            AgentLog.Write("print", $"blocked resource {u.Scheme}://{u.Host}");
    }

    private Task<T> OnUiThread<T>(Func<Task<T>> work)
    {
        var tcs = new TaskCompletionSource<T>(TaskCreationOptions.RunContinuationsAsynchronously);
        _host.BeginInvoke(new Action(async () =>
        {
            try
            {
                tcs.SetResult(await work());
            }
            catch (Exception ex)
            {
                tcs.SetException(ex);
            }
        }));
        return tcs.Task;
    }

    public void Dispose()
    {
        _view.Dispose();
        _host.Dispose();
        _gate.Dispose();
    }

    /// <summary>Off-screen tool window: never in the taskbar, Alt+Tab or focus chain.</summary>
    private sealed class HostForm : Form
    {
        public HostForm()
        {
            ShowInTaskbar = false;
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.Manual;
            Location = new Point(-32000, -32000);
            Size = new Size(320, 900);
            Text = "Oilix Print Agent renderer";
        }

        protected override bool ShowWithoutActivation => true;

        protected override CreateParams CreateParams
        {
            get
            {
                var cp = base.CreateParams;
                cp.ExStyle |= 0x80 /* WS_EX_TOOLWINDOW */ | 0x08000000 /* WS_EX_NOACTIVATE */;
                return cp;
            }
        }
    }
}

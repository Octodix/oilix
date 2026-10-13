using System;
using System.Diagnostics;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Oilix.PrintAgent.Core;

namespace Oilix.PrintAgent;

/// <summary>System-tray shell: status, printers, pairing, start-with-Windows, logs, quit.</summary>
public sealed class TrayContext : ApplicationContext
{
    private readonly ConfigStore _store;
    private readonly PairingManager _pairing;
    private readonly PrintEngine _engine;
    private readonly AgentServer _server;
    private readonly NotifyIcon _tray;
    private readonly ToolStripMenuItem _statusItem;
    private readonly ToolStripMenuItem _pairingsItem;
    private readonly ToolStripMenuItem _startupItem;
    private readonly ToolStripMenuItem _testItem;
    private readonly SynchronizationContext _ui;
    private PairingCodeForm? _pairingForm;
    private bool _running;

    public TrayContext(ConfigStore store)
    {
        _ui = SynchronizationContext.Current ?? new WindowsFormsSynchronizationContext();
        _store = store;
        _pairing = new PairingManager(store);
        _engine = new PrintEngine();
        _server = new AgentServer(store, _pairing, _engine, ShowPairing, msg => Notify(msg, ToolTipIcon.Info));

        _statusItem = new ToolStripMenuItem("Démarrage…") { Enabled = false };
        _pairingsItem = new ToolStripMenuItem("Révoquer les appairages", null, (_, _) => RevokePairings());
        _startupItem = new ToolStripMenuItem("Démarrer avec Windows", null, (_, _) => ToggleStartup())
        {
            CheckOnClick = false,
        };
        _testItem = new ToolStripMenuItem("Imprimer une page de test");

        var menu = new ContextMenuStrip();
        menu.Items.Add(new ToolStripMenuItem($"{AgentInfo.DisplayName} v{AgentInfo.Version}") { Enabled = false });
        menu.Items.Add(_statusItem);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(_testItem);
        menu.Items.Add(_pairingsItem);
        menu.Items.Add(_startupItem);
        menu.Items.Add(new ToolStripMenuItem("Ouvrir le dossier des journaux", null, (_, _) => OpenLogs()));
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(new ToolStripMenuItem("Quitter", null, (_, _) => ExitThread()));
        menu.Opening += (_, _) => RefreshMenu();

        _tray = new NotifyIcon
        {
            Icon = AgentIcon.Create(false),
            Text = AgentInfo.DisplayName,
            ContextMenuStrip = menu,
            Visible = true,
        };

        _ = StartAsync();
    }

    private async Task StartAsync()
    {
        try
        {
            await _engine.InitializeAsync();
            await _server.StartAsync();
            _running = true;
            _tray.Icon = AgentIcon.Create(true);
            _tray.Text = Truncate($"{AgentInfo.DisplayName} v{AgentInfo.Version} — connecté (127.0.0.1:{_server.Port})");
            RefreshMenu();
        }
        catch (Exception ex)
        {
            _running = false;
            AgentLog.Write("startup", $"failed {ex.GetType().Name}: {ex.Message}");
            _tray.Text = Truncate($"{AgentInfo.DisplayName} — arrêté");
            RefreshMenu();
            Notify(
                ex is IOException
                    ? $"Le port {_store.Read(c => c.Port)} est déjà utilisé. L'agent ne peut pas démarrer."
                    : "L'agent d'impression n'a pas pu démarrer (WebView2 manquant ?). Voir les journaux.",
                ToolTipIcon.Error);
        }
    }

    private void RefreshMenu()
    {
        _statusItem.Text = _running
            ? $"● Connecté — 127.0.0.1:{_server.Port}"
            : "○ Arrêté";
        var count = _store.Read(c => c.Pairings.Count);
        _pairingsItem.Text = $"Révoquer les appairages ({count})";
        _pairingsItem.Enabled = count > 0;
        _startupItem.Checked = StartupRegistration.IsEnabled();

        _testItem.DropDownItems.Clear();
        try
        {
            foreach (var p in PrinterCatalog.List())
            {
                var label = p.IsDefault ? $"{p.Name} (par défaut)" : p.Name;
                _testItem.DropDownItems.Add(new ToolStripMenuItem(label, null, (_, _) => _ = PrintTestPageAsync(p.Name)));
            }
        }
        catch (Exception ex)
        {
            AgentLog.Write("printers", $"menu enumeration failed {ex.GetType().Name}");
        }
        _testItem.Enabled = _running && _testItem.DropDownItems.Count > 0;
    }

    private async Task PrintTestPageAsync(string printer)
    {
        var job = new ValidatedPrintJob(Guid.NewGuid(), printer, PageLayout.Receipt(80, null), 1,
            TestPage.Html(printer, 80), "Oilix test");
        var result = await _engine.PrintAsync(job, CancellationToken.None);
        AgentLog.Write("print", $"tray test page printer='{printer}' status={result.Status} code={result.Code}");
        Notify(result.Ok ? $"Page de test envoyée à {printer}" : result.Message ?? "Échec", result.Ok ? ToolTipIcon.Info : ToolTipIcon.Error);
    }

    private void ShowPairing(PairingChallenge challenge) => _ui.Post(_ =>
    {
        _pairingForm?.Close();
        _pairingForm = new PairingCodeForm(challenge, () => _pairing.Active, _pairing.Cancel);
        _pairingForm.FormClosed += (_, _) => _pairingForm = null;
        _pairingForm.Show();
        _pairingForm.Activate();
    }, null);

    private void RevokePairings()
    {
        var answer = MessageBox.Show(
            "Révoquer tous les appairages ? Oilix devra être ré-appairé sur ce poste avant l'impression directe.",
            AgentInfo.DisplayName, MessageBoxButtons.YesNo, MessageBoxIcon.Warning);
        if (answer != DialogResult.Yes) return;
        var n = _pairing.RevokeAll();
        AgentLog.Write("pairing", $"revoked {n}");
        RefreshMenu();
    }

    private void ToggleStartup()
    {
        StartupRegistration.Set(!StartupRegistration.IsEnabled());
        RefreshMenu();
    }

    private static void OpenLogs()
    {
        Directory.CreateDirectory(AgentLog.Directory);
        Process.Start(new ProcessStartInfo { FileName = AgentLog.Directory, UseShellExecute = true });
    }

    private void Notify(string message, ToolTipIcon icon) => _ui.Post(_ =>
    {
        _tray.BalloonTipTitle = AgentInfo.DisplayName;
        _tray.BalloonTipText = message;
        _tray.BalloonTipIcon = icon;
        _tray.ShowBalloonTip(4000);
    }, null);

    private static string Truncate(string s) => s.Length <= 63 ? s : s[..63];

    protected override void ExitThreadCore()
    {
        _tray.Visible = false;
        try
        {
            _server.DisposeAsync().AsTask().Wait(TimeSpan.FromSeconds(3));
        }
        catch
        {
        }
        _engine.Dispose();
        _tray.Dispose();
        AgentLog.Write("server", "stopped");
        base.ExitThreadCore();
    }
}

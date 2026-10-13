using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using System.Windows.Forms;
using Oilix.PrintAgent.Core;

namespace Oilix.PrintAgent;

internal static class Program
{
    /// <summary>
    /// --background            start silently (used by the Windows "Run" entry)
    /// --allow-origin URL      pre-approve an Oilix address (repeatable)
    /// --restrict-pairing      only pre-approved addresses may request pairing
    /// --configure-only        apply the options above and exit
    /// --selftest              render the built-in test page to selftest.pdf and exit (0 = OK)
    /// </summary>
    [STAThread]
    private static int Main(string[] args)
    {
        var store = new ConfigStore(ConfigStore.DefaultPath);
        ApplyConfigArgs(store, args);
        if (args.Contains("--configure-only")) return 0;

        ApplicationConfiguration.Initialize();
        if (args.Contains("--selftest")) return RunSelfTest();

        using var mutex = new Mutex(true, @"Local\OilixPrintAgent", out var firstInstance);
        if (!firstInstance)
        {
            if (!args.Contains("--background"))
            {
                MessageBox.Show("Oilix Print Agent est déjà en cours d'exécution (icône dans la zone de notification).",
                    AgentInfo.DisplayName, MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
            return 0;
        }

        AgentLog.PruneOlderThan(TimeSpan.FromDays(30));
        AgentLog.Write("startup", $"v{AgentInfo.Version} starting");
        Application.Run(new TrayContext(store));
        return 0;
    }

    private static void ApplyConfigArgs(ConfigStore store, string[] args)
    {
        var origins = new List<string>();
        for (var i = 0; i < args.Length - 1; i++)
        {
            if (args[i] == "--allow-origin" && OriginPolicy.Normalize(args[i + 1]) is { } o) origins.Add(o);
        }
        var restrict = args.Contains("--restrict-pairing");
        if (origins.Count == 0 && !restrict) return;
        store.Update(cfg =>
        {
            cfg.AllowedOrigins.AddRange(origins);
            if (restrict) cfg.RestrictPairingToAllowedOrigins = true;
        });
    }

    private static int RunSelfTest()
    {
        var exitCode = 1;
        var output = Path.Combine(AgentInfo.DataDirectory, "selftest.pdf");
        var context = new ApplicationContext();
        var engine = new PrintEngine();
        async void Run()
        {
            try
            {
                Directory.CreateDirectory(AgentInfo.DataDirectory);
                await engine.InitializeAsync();
                var ok = await engine.RenderPdfAsync(
                    TestPage.Html("Microsoft Print to PDF", 80),
                    PageLayout.Receipt(80, null),
                    output);
                exitCode = ok && File.Exists(output) ? 0 : 1;
                AgentLog.Write("selftest", $"renderer={engine.RuntimeVersion} ok={ok}");
            }
            catch (Exception ex)
            {
                AgentLog.Write("selftest", $"failed {ex.GetType().Name}: {ex.Message}");
            }
            finally
            {
                engine.Dispose();
                context.ExitThread();
            }
        }
        var timer = new System.Windows.Forms.Timer { Interval = 10 };
        timer.Tick += (_, _) =>
        {
            timer.Stop();
            Run();
        };
        timer.Start();
        Application.Run(context);
        return exitCode;
    }
}

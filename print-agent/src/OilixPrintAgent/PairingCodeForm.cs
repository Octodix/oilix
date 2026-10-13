using System;
using System.Drawing;
using System.Windows.Forms;
using Oilix.PrintAgent.Core;

namespace Oilix.PrintAgent;

/// <summary>
/// Shows the pairing code on the workstation itself. Entering it in Oilix proves the person
/// pairing is physically at this computer.
/// </summary>
public sealed class PairingCodeForm : Form
{
    private readonly PairingChallenge _challenge;
    private readonly Func<PairingChallenge?> _active;
    private readonly Label _countdown;
    private readonly Timer _timer;

    public PairingCodeForm(PairingChallenge challenge, Func<PairingChallenge?> active, Action onCancel)
    {
        _challenge = challenge;
        _active = active;
        Text = "Oilix Print Agent — Appairage";
        TopMost = true;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        ClientSize = new Size(440, 300);
        Font = new Font("Segoe UI", 10);
        Icon = AgentIcon.Create(true);

        var layout = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            Padding = new Padding(18),
            ColumnCount = 1,
            RowCount = 6,
        };
        layout.Controls.Add(new Label
        {
            Text = "Demande d'appairage · طلب ربط",
            Font = new Font("Segoe UI", 12, FontStyle.Bold),
            AutoSize = true,
        });
        layout.Controls.Add(new Label
        {
            Text = $"Adresse : {challenge.Origin}\nPoste : {challenge.Label}",
            AutoSize = true,
            Margin = new Padding(0, 6, 0, 6),
        });
        layout.Controls.Add(new Label
        {
            Text = challenge.Code[..3] + " " + challenge.Code[3..],
            Font = new Font("Consolas", 34, FontStyle.Bold),
            ForeColor = Color.FromArgb(146, 64, 14),
            AutoSize = true,
            Margin = new Padding(0, 4, 0, 4),
        });
        layout.Controls.Add(new Label
        {
            Text = "Saisissez ce code dans Oilix uniquement si l'adresse ci-dessus est bien votre serveur Oilix.",
            AutoSize = true,
            MaximumSize = new Size(400, 0),
        });
        _countdown = new Label { AutoSize = true, ForeColor = Color.DimGray, Margin = new Padding(0, 6, 0, 0) };
        layout.Controls.Add(_countdown);
        var cancel = new Button { Text = "Annuler", AutoSize = true };
        cancel.Click += (_, _) =>
        {
            onCancel();
            Close();
        };
        layout.Controls.Add(cancel);
        Controls.Add(layout);

        _timer = new Timer { Interval = 500 };
        _timer.Tick += (_, _) => Tick();
        _timer.Start();
        Tick();
    }

    private void Tick()
    {
        var left = _challenge.ExpiresAt - DateTimeOffset.UtcNow;
        if (left <= TimeSpan.Zero || _active()?.PairingId != _challenge.PairingId)
        {
            Close();
            return;
        }
        _countdown.Text = $"Expire dans {(int)left.TotalSeconds} s";
    }

    protected override void OnFormClosed(FormClosedEventArgs e)
    {
        _timer.Dispose();
        base.OnFormClosed(e);
    }
}

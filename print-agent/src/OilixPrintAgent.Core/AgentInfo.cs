using System.Reflection;

namespace Oilix.PrintAgent.Core;

public static class AgentInfo
{
    public const string Name = "oilix-print-agent";
    public const string DisplayName = "Oilix Print Agent";
    public const int DefaultPort = 17777;

    public static string Version { get; } =
        typeof(AgentInfo).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()
            ?.InformationalVersion.Split('+')[0]
        ?? typeof(AgentInfo).Assembly.GetName().Version?.ToString(3)
        ?? "0.0.0";

    /// <summary>%LOCALAPPDATA%\Oilix\PrintAgent — config, logs and WebView2 profile (per Windows user).</summary>
    public static string DataDirectory { get; } = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "Oilix",
        "PrintAgent");
}

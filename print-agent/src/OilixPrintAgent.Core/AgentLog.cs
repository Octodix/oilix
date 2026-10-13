using System.Text;

namespace Oilix.PrintAgent.Core;

/// <summary>
/// Minimal daily log file. Callers must never pass document HTML, tokens or pairing codes.
/// </summary>
public static class AgentLog
{
    private static readonly object Gate = new();
    public static string Directory { get; set; } = Path.Combine(AgentInfo.DataDirectory, "logs");

    public static void Write(string category, string message)
    {
        try
        {
            var line = new StringBuilder()
                .Append(DateTimeOffset.Now.ToString("yyyy-MM-dd HH:mm:ss.fff zzz"))
                .Append(" [").Append(category).Append("] ")
                .Append(Sanitize(message))
                .AppendLine()
                .ToString();
            lock (Gate)
            {
                System.IO.Directory.CreateDirectory(Directory);
                File.AppendAllText(Path.Combine(Directory, $"agent-{DateTime.Now:yyyyMMdd}.log"), line);
            }
        }
        catch
        {
            // Logging must never break printing.
        }
    }

    /// <summary>Single line, bounded length, no control characters.</summary>
    public static string Sanitize(string? value)
    {
        if (string.IsNullOrEmpty(value)) return "";
        var sb = new StringBuilder(Math.Min(value.Length, 300));
        foreach (var ch in value)
        {
            if (sb.Length >= 300) break;
            sb.Append(char.IsControl(ch) ? ' ' : ch);
        }
        return sb.ToString();
    }

    public static void PruneOlderThan(TimeSpan age)
    {
        try
        {
            if (!System.IO.Directory.Exists(Directory)) return;
            foreach (var f in System.IO.Directory.GetFiles(Directory, "agent-*.log"))
            {
                if (File.GetLastWriteTime(f) < DateTime.Now - age) File.Delete(f);
            }
        }
        catch
        {
        }
    }
}

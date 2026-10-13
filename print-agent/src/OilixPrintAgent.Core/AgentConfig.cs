using System.Text.Json;
using System.Text.Json.Serialization;

namespace Oilix.PrintAgent.Core;

public sealed class PairingRecord
{
    public string Origin { get; set; } = "";
    /// <summary>SHA-256 of the bearer token (hex). The token itself is never stored.</summary>
    public string TokenHash { get; set; } = "";
    public string Label { get; set; } = "";
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? LastUsedAt { get; set; }
}

public sealed class AgentConfig
{
    public int Port { get; set; } = AgentInfo.DefaultPort;

    /// <summary>Origins pre-approved by the installer. Pairing is still required to obtain a token.</summary>
    public List<string> AllowedOrigins { get; set; } = new();

    /// <summary>When true only <see cref="AllowedOrigins"/> may start a pairing.</summary>
    public bool RestrictPairingToAllowedOrigins { get; set; }

    public List<PairingRecord> Pairings { get; set; } = new();

    public int MaxJobBytes { get; set; } = 4 * 1024 * 1024;

    public int MaxCopies { get; set; } = 5;

    [JsonIgnore]
    public IEnumerable<string> EffectiveOrigins =>
        AllowedOrigins.Concat(Pairings.Select(p => p.Origin)).Distinct(StringComparer.Ordinal);
}

/// <summary>Thread-safe JSON persistence of <see cref="AgentConfig"/>.</summary>
public sealed class ConfigStore
{
    private static readonly JsonSerializerOptions Json = new() { WriteIndented = true };
    private readonly object _gate = new();
    private readonly string _path;
    private AgentConfig _config;

    public ConfigStore(string path)
    {
        _path = path;
        _config = Load(path);
    }

    public static string DefaultPath => Path.Combine(AgentInfo.DataDirectory, "config.json");

    public AgentConfig Snapshot()
    {
        lock (_gate)
        {
            return JsonSerializer.Deserialize<AgentConfig>(JsonSerializer.Serialize(_config, Json), Json)!;
        }
    }

    public T Read<T>(Func<AgentConfig, T> read)
    {
        lock (_gate) return read(_config);
    }

    public void Update(Action<AgentConfig> mutate)
    {
        lock (_gate)
        {
            mutate(_config);
            Sanitize(_config);
            Directory.CreateDirectory(Path.GetDirectoryName(_path)!);
            var tmp = _path + ".tmp";
            File.WriteAllText(tmp, JsonSerializer.Serialize(_config, Json));
            File.Move(tmp, _path, overwrite: true);
        }
    }

    private static AgentConfig Load(string path)
    {
        try
        {
            if (File.Exists(path))
            {
                var cfg = JsonSerializer.Deserialize<AgentConfig>(File.ReadAllText(path), Json);
                if (cfg is not null)
                {
                    Sanitize(cfg);
                    return cfg;
                }
            }
        }
        catch (Exception ex) when (ex is IOException or JsonException or UnauthorizedAccessException)
        {
            AgentLog.Write("config", $"invalid config ignored: {ex.GetType().Name}");
        }
        return new AgentConfig();
    }

    private static void Sanitize(AgentConfig cfg)
    {
        if (cfg.Port is < 1024 or > 65535) cfg.Port = AgentInfo.DefaultPort;
        cfg.AllowedOrigins = cfg.AllowedOrigins
            .Select(OriginPolicy.Normalize)
            .Where(o => o is not null)
            .Select(o => o!)
            .Distinct(StringComparer.Ordinal)
            .ToList();
        cfg.Pairings = cfg.Pairings
            .Where(p => OriginPolicy.Normalize(p.Origin) is not null && p.TokenHash.Length == 64)
            .ToList();
        cfg.MaxJobBytes = Math.Clamp(cfg.MaxJobBytes, 64 * 1024, 16 * 1024 * 1024);
        cfg.MaxCopies = Math.Clamp(cfg.MaxCopies, 1, 10);
    }
}

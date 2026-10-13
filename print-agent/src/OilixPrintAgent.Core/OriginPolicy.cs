namespace Oilix.PrintAgent.Core;

public static class OriginPolicy
{
    /// <summary>
    /// Canonical "scheme://host[:port]" for http(s) origins, or null when the value is not a
    /// plain web origin (paths, credentials, file:, data:, "null" …).
    /// </summary>
    public static string? Normalize(string? origin)
    {
        if (string.IsNullOrWhiteSpace(origin)) return null;
        var raw = origin.Trim();
        if (raw.Length > 255 || raw == "null") return null;
        if (!Uri.TryCreate(raw, UriKind.Absolute, out var uri)) return null;
        if (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps) return null;
        if (!string.IsNullOrEmpty(uri.UserInfo)) return null;
        if (uri.AbsolutePath != "/" || !string.IsNullOrEmpty(uri.Query) || !string.IsNullOrEmpty(uri.Fragment))
            return null;
        if (raw.EndsWith('/')) return null;
        var host = uri.IdnHost.ToLowerInvariant();
        return uri.IsDefaultPort ? $"{uri.Scheme}://{host}" : $"{uri.Scheme}://{host}:{uri.Port}";
    }

    public static bool IsAllowed(string? origin, IEnumerable<string> allowed)
    {
        var o = Normalize(origin);
        if (o is null) return false;
        return allowed.Any(a => string.Equals(Normalize(a), o, StringComparison.Ordinal));
    }

    /// <summary>Host header must name the loopback listener (blocks DNS-rebinding attacks).</summary>
    public static bool IsLoopbackHost(string? hostHeader, int port)
    {
        if (string.IsNullOrWhiteSpace(hostHeader)) return false;
        var h = hostHeader.Trim().ToLowerInvariant();
        return h == $"127.0.0.1:{port}" || h == $"localhost:{port}" || h == $"[::1]:{port}";
    }
}

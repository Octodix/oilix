namespace Oilix.PrintAgent.Core;

public enum EndpointKind { Unknown, Public, Pairing, Authorized }

public sealed record RequestFacts(
    string Method,
    string Path,
    string? Origin,
    string? Host,
    bool RemoteIsLoopback,
    string? BearerToken);

public sealed record AccessDecision(bool Allowed, int StatusCode, string? Code, string? Message, string? CorsOrigin)
{
    public static AccessDecision Allow(string? corsOrigin) => new(true, 200, null, null, corsOrigin);

    public static AccessDecision Deny(int status, string code, string message, string? corsOrigin = null) =>
        new(false, status, code, message, corsOrigin);
}

/// <summary>Every HTTP request is evaluated here before reaching an endpoint.</summary>
public static class AccessPolicy
{
    public static EndpointKind Classify(string method, string path)
    {
        var m = method.ToUpperInvariant();
        var p = path.TrimEnd('/').ToLowerInvariant();
        var isPreflight = m == "OPTIONS";
        return p switch
        {
            "/v1/health" when m == "GET" || isPreflight => EndpointKind.Public,
            "/v1/pair/start" or "/v1/pair/complete" when m == "POST" || isPreflight => EndpointKind.Pairing,
            "/v1/printers" when m == "GET" || isPreflight => EndpointKind.Authorized,
            "/v1/print" when m == "POST" || isPreflight => EndpointKind.Authorized,
            _ => EndpointKind.Unknown,
        };
    }

    public static AccessDecision Evaluate(
        RequestFacts req,
        int port,
        IEnumerable<string> allowedOrigins,
        Func<string?, string?, bool> isAuthorized)
    {
        if (!req.RemoteIsLoopback)
            return AccessDecision.Deny(403, "LOOPBACK_ONLY", "Accès local uniquement");
        if (!OriginPolicy.IsLoopbackHost(req.Host, port))
            return AccessDecision.Deny(421, "INVALID_HOST", "Hôte non autorisé");

        var kind = Classify(req.Method, req.Path);
        if (kind == EndpointKind.Unknown) return AccessDecision.Deny(404, "NOT_FOUND", "Introuvable");

        var origin = OriginPolicy.Normalize(req.Origin);
        var preflight = string.Equals(req.Method, "OPTIONS", StringComparison.OrdinalIgnoreCase);

        switch (kind)
        {
            case EndpointKind.Public:
                return AccessDecision.Allow(origin);

            case EndpointKind.Pairing:
                if (origin is null)
                    return AccessDecision.Deny(403, PrintErrorCodes.OriginNotAllowed, "Origine requise");
                return AccessDecision.Allow(origin);

            default:
                if (origin is null || !OriginPolicy.IsAllowed(origin, allowedOrigins))
                    return AccessDecision.Deny(403, PrintErrorCodes.OriginNotAllowed, "Origine non appairée");
                if (preflight) return AccessDecision.Allow(origin);
                if (!isAuthorized(origin, req.BearerToken))
                    return AccessDecision.Deny(401, PrintErrorCodes.NotPaired, "Agent non appairé avec ce poste", origin);
                return AccessDecision.Allow(origin);
        }
    }

    public static string? BearerFrom(string? authorizationHeader)
    {
        if (string.IsNullOrWhiteSpace(authorizationHeader)) return null;
        const string prefix = "Bearer ";
        return authorizationHeader.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)
            ? authorizationHeader[prefix.Length..].Trim()
            : null;
    }
}

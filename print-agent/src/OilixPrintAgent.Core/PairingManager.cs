using System.Security.Cryptography;
using System.Text;

namespace Oilix.PrintAgent.Core;

public sealed record PairingChallenge(string PairingId, string Origin, string Code, string Label, DateTimeOffset ExpiresAt);

public enum PairingStartError { None, OriginInvalid, OriginNotAllowed, Busy, RateLimited }

public enum PairingCompleteError { None, Unknown, Expired, WrongCode, TooManyAttempts, OriginMismatch }

/// <summary>
/// Pairing = physical-presence proof. The agent displays a short code on the workstation screen;
/// the Oilix page must send it back to receive a bearer token bound to its origin.
/// </summary>
public sealed class PairingManager
{
    public static readonly TimeSpan ChallengeLifetime = TimeSpan.FromMinutes(2);
    public const int MaxAttempts = 5;

    private readonly ConfigStore _store;
    private readonly Func<DateTimeOffset> _now;
    private readonly SlidingWindowLimiter _startLimiter;
    private readonly object _gate = new();
    private PairingChallenge? _active;
    private int _attempts;

    public PairingManager(ConfigStore store, Func<DateTimeOffset>? now = null)
    {
        _store = store;
        _now = now ?? (() => DateTimeOffset.UtcNow);
        _startLimiter = new SlidingWindowLimiter(3, TimeSpan.FromMinutes(1), _now);
    }

    public (PairingChallenge? Challenge, PairingStartError Error) Start(string? origin, string? label)
    {
        var o = OriginPolicy.Normalize(origin);
        if (o is null) return (null, PairingStartError.OriginInvalid);
        var restricted = _store.Read(c => c.RestrictPairingToAllowedOrigins);
        if (restricted && !OriginPolicy.IsAllowed(o, _store.Read(c => c.AllowedOrigins.ToList())))
            return (null, PairingStartError.OriginNotAllowed);

        lock (_gate)
        {
            if (_active is not null && _active.ExpiresAt > _now()) return (null, PairingStartError.Busy);
            if (!_startLimiter.TryAcquire()) return (null, PairingStartError.RateLimited);
            var code = RandomNumberGenerator.GetInt32(0, 1_000_000).ToString("D6");
            _active = new PairingChallenge(
                Guid.NewGuid().ToString("N"),
                o,
                code,
                AgentLog.Sanitize(label).Trim() is { Length: > 0 } l ? l[..Math.Min(l.Length, 80)] : "Oilix",
                _now() + ChallengeLifetime);
            _attempts = 0;
            return (_active, PairingStartError.None);
        }
    }

    public (string? Token, PairingCompleteError Error) Complete(string? pairingId, string? origin, string? code)
    {
        lock (_gate)
        {
            var c = _active;
            if (c is null || !string.Equals(c.PairingId, pairingId, StringComparison.Ordinal))
                return (null, PairingCompleteError.Unknown);
            if (c.ExpiresAt <= _now())
            {
                _active = null;
                return (null, PairingCompleteError.Expired);
            }
            if (OriginPolicy.Normalize(origin) != c.Origin) return (null, PairingCompleteError.OriginMismatch);
            if (!FixedEquals(c.Code, (code ?? "").Trim()))
            {
                if (++_attempts >= MaxAttempts)
                {
                    _active = null;
                    return (null, PairingCompleteError.TooManyAttempts);
                }
                return (null, PairingCompleteError.WrongCode);
            }

            _active = null;
            var token = NewToken();
            _store.Update(cfg => cfg.Pairings.Add(new PairingRecord
            {
                Origin = c.Origin,
                TokenHash = HashToken(token),
                Label = c.Label,
                CreatedAt = _now(),
            }));
            return (token, PairingCompleteError.None);
        }
    }

    public void Cancel()
    {
        lock (_gate) _active = null;
    }

    public PairingChallenge? Active
    {
        get
        {
            lock (_gate) return _active is not null && _active.ExpiresAt > _now() ? _active : null;
        }
    }

    /// <summary>Token must exist and be bound to the calling origin.</summary>
    public bool IsAuthorized(string? origin, string? token)
    {
        var o = OriginPolicy.Normalize(origin);
        if (o is null || string.IsNullOrWhiteSpace(token) || token.Length > 200) return false;
        var hash = HashToken(token.Trim());
        var match = _store.Read(cfg =>
            cfg.Pairings.FirstOrDefault(p => p.Origin == o && FixedEquals(p.TokenHash, hash)));
        return match is not null;
    }

    public int RevokeAll()
    {
        var count = _store.Read(c => c.Pairings.Count);
        _store.Update(c => c.Pairings.Clear());
        return count;
    }

    public static string HashToken(string token) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token))).ToLowerInvariant();

    private static string NewToken() =>
        Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))
            .TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private static bool FixedEquals(string a, string b) =>
        CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(a), Encoding.UTF8.GetBytes(b));
}

public sealed class SlidingWindowLimiter
{
    private readonly int _max;
    private readonly TimeSpan _window;
    private readonly Func<DateTimeOffset> _now;
    private readonly Queue<DateTimeOffset> _hits = new();
    private readonly object _gate = new();

    public SlidingWindowLimiter(int max, TimeSpan window, Func<DateTimeOffset>? now = null)
    {
        _max = max;
        _window = window;
        _now = now ?? (() => DateTimeOffset.UtcNow);
    }

    public bool TryAcquire()
    {
        lock (_gate)
        {
            var now = _now();
            while (_hits.Count > 0 && now - _hits.Peek() >= _window) _hits.Dequeue();
            if (_hits.Count >= _max) return false;
            _hits.Enqueue(now);
            return true;
        }
    }
}

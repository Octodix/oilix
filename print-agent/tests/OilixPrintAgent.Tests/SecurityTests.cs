using Oilix.PrintAgent.Core;
using Xunit;

namespace Oilix.PrintAgent.Tests;

public class OriginPolicyTests
{
    [Theory]
    [InlineData("http://192.168.1.249:3000", "http://192.168.1.249:3000")]
    [InlineData("HTTPS://Oilix.Example.COM", "https://oilix.example.com")]
    [InlineData("https://oilix.example.com:443", "https://oilix.example.com")]
    public void Normalizes_web_origins(string input, string expected) =>
        Assert.Equal(expected, OriginPolicy.Normalize(input));

    [Theory]
    [InlineData(null)]
    [InlineData("null")]
    [InlineData("file:///C:/Windows/win.ini")]
    [InlineData("data:text/html,hi")]
    [InlineData("http://evil.test/path")]
    [InlineData("http://user:pw@oilix.test")]
    [InlineData("http://oilix.test/")]
    [InlineData("C:\\Windows\\System32")]
    public void Rejects_non_origins(string? input) => Assert.Null(OriginPolicy.Normalize(input));

    [Theory]
    [InlineData("127.0.0.1:17777", true)]
    [InlineData("localhost:17777", true)]
    [InlineData("evil.test:17777", false)]
    [InlineData("127.0.0.1:80", false)]
    [InlineData(null, false)]
    public void Host_header_must_be_loopback(string? host, bool ok) =>
        Assert.Equal(ok, OriginPolicy.IsLoopbackHost(host, 17777));
}

public class AccessPolicyTests
{
    private const int Port = 17777;
    private const string Oilix = "http://192.168.1.249:3000";
    private static readonly string[] Allowed = { Oilix };

    private static AccessDecision Eval(
        string method,
        string path,
        string? origin = Oilix,
        string? token = "good",
        bool loopback = true,
        string host = "127.0.0.1:17777") =>
        AccessPolicy.Evaluate(
            new RequestFacts(method, path, origin, host, loopback, token),
            Port,
            Allowed,
            (o, t) => o == Oilix && t == "good");

    [Fact]
    public void Remote_peers_are_always_refused() =>
        Assert.Equal(403, Eval("GET", "/v1/health", loopback: false).StatusCode);

    [Fact]
    public void Dns_rebinding_host_is_refused() =>
        Assert.Equal(421, Eval("POST", "/v1/print", host: "attacker.test:17777").StatusCode);

    [Fact]
    public void Unknown_routes_do_not_exist() =>
        Assert.Equal(404, Eval("POST", "/v1/exec").StatusCode);

    [Fact]
    public void Health_is_public_but_harmless()
    {
        var d = Eval("GET", "/v1/health", origin: "https://other.test", token: null);
        Assert.True(d.Allowed);
    }

    [Fact]
    public void Print_from_an_unpaired_origin_is_refused()
    {
        var d = Eval("POST", "/v1/print", origin: "https://evil.test");
        Assert.False(d.Allowed);
        Assert.Equal(PrintErrorCodes.OriginNotAllowed, d.Code);
    }

    [Fact]
    public void Print_without_origin_header_is_refused() =>
        Assert.False(Eval("POST", "/v1/print", origin: null).Allowed);

    [Fact]
    public void Print_without_a_valid_token_is_refused()
    {
        var d = Eval("POST", "/v1/print", token: "forged");
        Assert.Equal(401, d.StatusCode);
        Assert.Equal(PrintErrorCodes.NotPaired, d.Code);
    }

    [Fact]
    public void Paired_origin_with_token_may_print_and_list_printers()
    {
        Assert.True(Eval("POST", "/v1/print").Allowed);
        Assert.True(Eval("GET", "/v1/printers").Allowed);
        Assert.Equal(Oilix, Eval("POST", "/v1/print").CorsOrigin);
    }

    [Fact]
    public void Preflight_of_paired_origin_passes_without_token() =>
        Assert.True(Eval("OPTIONS", "/v1/print", token: null).Allowed);

    [Fact]
    public void Wrong_method_is_unknown() => Assert.Equal(404, Eval("GET", "/v1/print").StatusCode);
}

public class PairingTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "oilix-agent-tests-" + Guid.NewGuid().ToString("N"));
    private DateTimeOffset _now = new(2026, 10, 1, 12, 0, 0, TimeSpan.Zero);

    private (ConfigStore Store, PairingManager Pairing) Make(Action<AgentConfig>? seed = null)
    {
        var store = new ConfigStore(Path.Combine(_dir, "config.json"));
        if (seed is not null) store.Update(seed);
        return (store, new PairingManager(store, () => _now));
    }

    public void Dispose()
    {
        if (Directory.Exists(_dir)) Directory.Delete(_dir, true);
    }

    [Fact]
    public void Correct_code_issues_a_token_bound_to_the_origin()
    {
        var (store, pairing) = Make();
        var (challenge, err) = pairing.Start("http://192.168.1.249:3000", "POS-HUILE-01");
        Assert.Equal(PairingStartError.None, err);
        var (token, cerr) = pairing.Complete(challenge!.PairingId, "http://192.168.1.249:3000", challenge.Code);
        Assert.Equal(PairingCompleteError.None, cerr);
        Assert.NotNull(token);
        Assert.True(pairing.IsAuthorized("http://192.168.1.249:3000", token));
        Assert.False(pairing.IsAuthorized("https://evil.test", token));
        Assert.DoesNotContain(token!, File.ReadAllText(Path.Combine(_dir, "config.json")));
        Assert.Single(store.Read(c => c.Pairings));
    }

    [Fact]
    public void Wrong_codes_are_limited()
    {
        var (_, pairing) = Make();
        var (c, _) = pairing.Start("http://oilix.test", null);
        for (var i = 1; i < PairingManager.MaxAttempts; i++)
            Assert.Equal(PairingCompleteError.WrongCode, pairing.Complete(c!.PairingId, "http://oilix.test", "000000x").Error);
        Assert.Equal(PairingCompleteError.TooManyAttempts, pairing.Complete(c!.PairingId, "http://oilix.test", "nope").Error);
        Assert.Equal(PairingCompleteError.Unknown, pairing.Complete(c.PairingId, "http://oilix.test", c.Code).Error);
    }

    [Fact]
    public void Codes_expire()
    {
        var (_, pairing) = Make();
        var (c, _) = pairing.Start("http://oilix.test", null);
        _now += PairingManager.ChallengeLifetime + TimeSpan.FromSeconds(1);
        Assert.Equal(PairingCompleteError.Expired, pairing.Complete(c!.PairingId, "http://oilix.test", c.Code).Error);
    }

    [Fact]
    public void Another_origin_cannot_complete_someone_elses_pairing()
    {
        var (_, pairing) = Make();
        var (c, _) = pairing.Start("http://oilix.test", null);
        Assert.Equal(PairingCompleteError.OriginMismatch, pairing.Complete(c!.PairingId, "https://evil.test", c.Code).Error);
    }

    [Fact]
    public void Only_one_pairing_at_a_time_and_rate_limited()
    {
        var (_, pairing) = Make();
        Assert.Equal(PairingStartError.None, pairing.Start("http://oilix.test", null).Error);
        Assert.Equal(PairingStartError.Busy, pairing.Start("http://oilix.test", null).Error);
        pairing.Cancel();
        Assert.Equal(PairingStartError.None, pairing.Start("http://oilix.test", null).Error);
        pairing.Cancel();
        Assert.Equal(PairingStartError.None, pairing.Start("http://oilix.test", null).Error);
        pairing.Cancel();
        Assert.Equal(PairingStartError.RateLimited, pairing.Start("http://oilix.test", null).Error);
    }

    [Fact]
    public void Restricted_mode_only_pairs_preapproved_origins()
    {
        var (_, pairing) = Make(c =>
        {
            c.AllowedOrigins.Add("http://192.168.1.249:3000");
            c.RestrictPairingToAllowedOrigins = true;
        });
        Assert.Equal(PairingStartError.OriginNotAllowed, pairing.Start("https://evil.test", null).Error);
        Assert.Equal(PairingStartError.None, pairing.Start("http://192.168.1.249:3000", null).Error);
    }

    [Fact]
    public void Revoking_removes_every_token()
    {
        var (_, pairing) = Make();
        var (c, _) = pairing.Start("http://oilix.test", null);
        var (token, _) = pairing.Complete(c!.PairingId, "http://oilix.test", c.Code);
        Assert.Equal(1, pairing.RevokeAll());
        Assert.False(pairing.IsAuthorized("http://oilix.test", token));
    }
}

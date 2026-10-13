using System;
using System.Linq;
using System.Net;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Oilix.PrintAgent.Core;

namespace Oilix.PrintAgent;

/// <summary>
/// HTTP API bound to 127.0.0.1 only. Every request passes <see cref="AccessPolicy"/> first:
/// loopback peer, loopback Host header, known route, paired origin and bearer token.
/// </summary>
public sealed class AgentServer : IAsyncDisposable
{
    private readonly ConfigStore _store;
    private readonly PairingManager _pairing;
    private readonly PrintEngine _engine;
    private readonly JobDeduplicator _dedupe = new();
    private readonly Action<PairingChallenge> _showPairing;
    private readonly Action<string> _notify;
    private WebApplication? _app;

    public AgentServer(
        ConfigStore store,
        PairingManager pairing,
        PrintEngine engine,
        Action<PairingChallenge> showPairing,
        Action<string> notify)
    {
        _store = store;
        _pairing = pairing;
        _engine = engine;
        _showPairing = showPairing;
        _notify = notify;
    }

    public int Port => _store.Read(c => c.Port);

    public async Task StartAsync()
    {
        var cfg = _store.Snapshot();
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions
        {
            Args = Array.Empty<string>(),
            ContentRootPath = AppContext.BaseDirectory,
        });
        builder.Logging.ClearProviders();
        builder.WebHost.ConfigureKestrel(k =>
        {
            k.AddServerHeader = false;
            k.Listen(IPAddress.Loopback, cfg.Port);
            k.Limits.MaxRequestBodySize = (long)cfg.MaxJobBytes * 2 + 64 * 1024;
        });

        var app = builder.Build();
        app.Use(GateAsync);
        app.MapGet("/v1/health", new Func<HttpContext, IResult>(Health));
        app.MapPost("/v1/pair/start", new Func<HttpContext, Task<IResult>>(PairStartAsync));
        app.MapPost("/v1/pair/complete", new Func<HttpContext, Task<IResult>>(PairCompleteAsync));
        app.MapGet("/v1/printers", new Func<IResult>(Printers));
        app.MapPost("/v1/print", new Func<HttpContext, Task<IResult>>(PrintAsync));

        await app.StartAsync();
        _app = app;
        AgentLog.Write("server", $"listening on 127.0.0.1:{cfg.Port} v{AgentInfo.Version}");
    }

    private async Task GateAsync(HttpContext ctx, RequestDelegate next)
    {
        var req = ctx.Request;
        var cfg = _store.Snapshot();
        var facts = new RequestFacts(
            req.Method,
            req.Path.Value ?? "/",
            req.Headers.Origin.ToString(),
            req.Headers.Host.ToString(),
            ctx.Connection.RemoteIpAddress is { } ip && IPAddress.IsLoopback(ip),
            AccessPolicy.BearerFrom(req.Headers.Authorization.ToString()));

        var decision = AccessPolicy.Evaluate(facts, cfg.Port, cfg.EffectiveOrigins, _pairing.IsAuthorized);
        var res = ctx.Response;
        res.Headers.CacheControl = "no-store";
        res.Headers["X-Content-Type-Options"] = "nosniff";
        if (decision.CorsOrigin is not null)
        {
            res.Headers.AccessControlAllowOrigin = decision.CorsOrigin;
            res.Headers.Vary = "Origin";
        }

        if (!decision.Allowed)
        {
            AgentLog.Write("access", $"denied {req.Method} {req.Path} origin={AgentLog.Sanitize(facts.Origin)} code={decision.Code}");
            await WriteJson(ctx, decision.StatusCode, new { ok = false, code = decision.Code, message = decision.Message });
            return;
        }

        if (HttpMethods.IsOptions(req.Method))
        {
            res.Headers.AccessControlAllowMethods = "GET, POST";
            res.Headers.AccessControlAllowHeaders = "Content-Type, Authorization";
            res.Headers.AccessControlMaxAge = "600";
            if (req.Headers.ContainsKey("Access-Control-Request-Private-Network"))
                res.Headers["Access-Control-Allow-Private-Network"] = "true";
            res.StatusCode = StatusCodes.Status204NoContent;
            return;
        }

        try
        {
            await next(ctx);
        }
        catch (Exception ex) when (!res.HasStarted)
        {
            AgentLog.Write("error", $"{req.Method} {req.Path} {ex.GetType().Name}: {AgentLog.Sanitize(ex.Message)}");
            await WriteJson(ctx, 500, new { ok = false, code = "INTERNAL_ERROR", message = "Erreur interne de l'agent" });
        }
    }

    private IResult Health(HttpContext ctx)
    {
        var origin = OriginPolicy.Normalize(ctx.Request.Headers.Origin.ToString());
        var token = AccessPolicy.BearerFrom(ctx.Request.Headers.Authorization.ToString());
        return Results.Json(new
        {
            ok = true,
            agent = AgentInfo.Name,
            version = AgentInfo.Version,
            port = Port,
            renderer = _engine.RuntimeVersion,
            paired = origin is not null && _pairing.IsAuthorized(origin, token),
            originAllowed = origin is not null && OriginPolicy.IsAllowed(origin, _store.Read(c => c.EffectiveOrigins.ToList())),
            pairingPending = _pairing.Active is not null,
        });
    }

    private sealed record PairStartBody(string? Label);
    private sealed record PairCompleteBody(string? PairingId, string? Code);

    private async Task<IResult> PairStartAsync(HttpContext ctx)
    {
        var body = await ReadBody<PairStartBody>(ctx);
        var origin = ctx.Request.Headers.Origin.ToString();
        var (challenge, error) = _pairing.Start(origin, body?.Label);
        if (challenge is null)
        {
            return error switch
            {
                PairingStartError.Busy => Fail(409, "PAIRING_BUSY", "Un appairage est déjà en cours sur ce poste"),
                PairingStartError.RateLimited => Fail(429, "RATE_LIMITED", "Trop de demandes — réessayez dans une minute"),
                PairingStartError.OriginNotAllowed => Fail(403, PrintErrorCodes.OriginNotAllowed, "Cette adresse Oilix n'est pas autorisée sur ce poste"),
                _ => Fail(400, "ORIGIN_INVALID", "Origine invalide"),
            };
        }
        AgentLog.Write("pairing", $"started for {challenge.Origin}");
        _showPairing(challenge);
        return Results.Json(new
        {
            ok = true,
            pairingId = challenge.PairingId,
            expiresInSec = (int)PairingManager.ChallengeLifetime.TotalSeconds,
        });
    }

    private async Task<IResult> PairCompleteAsync(HttpContext ctx)
    {
        var body = await ReadBody<PairCompleteBody>(ctx);
        var origin = ctx.Request.Headers.Origin.ToString();
        var (token, error) = _pairing.Complete(body?.PairingId, origin, body?.Code);
        if (token is null)
        {
            AgentLog.Write("pairing", $"failed {error}");
            return error switch
            {
                PairingCompleteError.WrongCode => Fail(400, "WRONG_CODE", "Code incorrect"),
                PairingCompleteError.TooManyAttempts => Fail(429, "TOO_MANY_ATTEMPTS", "Trop d'essais — recommencez l'appairage"),
                PairingCompleteError.Expired => Fail(410, "PAIRING_EXPIRED", "Code expiré — recommencez l'appairage"),
                PairingCompleteError.OriginMismatch => Fail(403, PrintErrorCodes.OriginNotAllowed, "Origine différente de la demande"),
                _ => Fail(404, "PAIRING_UNKNOWN", "Aucune demande d'appairage active"),
            };
        }
        var o = OriginPolicy.Normalize(origin)!;
        AgentLog.Write("pairing", $"paired {o}");
        _notify($"Oilix appairé : {o}");
        return Results.Json(new { ok = true, token, origin = o });
    }

    private IResult Printers()
    {
        try
        {
            var printers = PrinterCatalog.List();
            return Results.Json(new
            {
                ok = true,
                defaultPrinter = printers.FirstOrDefault(p => p.IsDefault)?.Name,
                printers = printers.Select(p => new
                {
                    name = p.Name,
                    isDefault = p.IsDefault,
                    offline = p.Offline,
                    status = p.Status,
                    driver = p.Driver,
                }),
            });
        }
        catch (Exception ex)
        {
            AgentLog.Write("printers", $"enumeration failed {ex.GetType().Name}");
            return Fail(500, "PRINTERS_UNAVAILABLE", "Impossible de lister les imprimantes");
        }
    }

    private async Task<IResult> PrintAsync(HttpContext ctx)
    {
        var cfg = _store.Snapshot();
        PrintJobRequest? request;
        try
        {
            request = await ctx.Request.ReadFromJsonAsync<PrintJobRequest>(ctx.RequestAborted);
        }
        catch (Exception ex) when (ex is JsonException or BadHttpRequestException)
        {
            return ex is BadHttpRequestException { StatusCode: 413 }
                ? Fail(413, PrintErrorCodes.JobTooLarge, "Document trop volumineux")
                : Fail(400, PrintErrorCodes.InvalidJob, "JSON invalide");
        }

        var (job, invalid) = PrintJobValidator.Validate(request, cfg.MaxJobBytes, cfg.MaxCopies);
        if (job is null)
        {
            var status = invalid!.Code == PrintErrorCodes.JobTooLarge ? 413 : 400;
            return Fail(status, invalid.Code, invalid.Message);
        }

        var printer = PrinterCatalog.Find(job.Printer);
        if (printer is null)
        {
            AgentLog.Write("print", $"job {job.JobId} printer not found '{job.Printer}'");
            return Fail(404, PrintErrorCodes.PrinterNotFound, $"Imprimante « {job.Printer} » introuvable sur ce poste");
        }
        job = job with { Printer = printer.Name };

        switch (_dedupe.TryBegin(job.JobId, out var previous))
        {
            case DedupeDecision.AlreadySubmitted:
                return Results.Json(previous);
            case DedupeDecision.InFlight:
                return Fail(409, PrintErrorCodes.JobInProgress, "Impression déjà en cours");
        }

        PrintJobResult result;
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(60));
        try
        {
            result = await _engine.PrintAsync(job, timeout.Token);
        }
        catch (OperationCanceledException)
        {
            result = PrintJobResult.Failed(job.JobId.ToString(), job.Printer, job.Copies, PrintErrorCodes.Timeout, "Délai d'impression dépassé");
        }
        _dedupe.Complete(job.JobId, result);

        AgentLog.Write("print",
            $"job {job.JobId} printer='{job.Printer}' kind={(job.Layout.IsReceipt ? "receipt" : "document")} " +
            $"copies={job.Copies} status={result.Status} code={result.Code} ms={result.DurationMs}");

        if (result.Ok) return Results.Json(result);
        var http = result.Code switch
        {
            PrintErrorCodes.PrinterNotFound => 404,
            PrintErrorCodes.Timeout => 504,
            _ => 502,
        };
        return Results.Json(result, statusCode: http);
    }

    private static async Task<T?> ReadBody<T>(HttpContext ctx) where T : class
    {
        try
        {
            if (ctx.Request.ContentLength is null or 0) return null;
            return await ctx.Request.ReadFromJsonAsync<T>(ctx.RequestAborted);
        }
        catch (Exception ex) when (ex is JsonException or BadHttpRequestException)
        {
            return null;
        }
    }

    private static IResult Fail(int status, string code, string message) =>
        Results.Json(new { ok = false, code, message }, statusCode: status);

    private static Task WriteJson(HttpContext ctx, int status, object body)
    {
        ctx.Response.StatusCode = status;
        return ctx.Response.WriteAsJsonAsync(body);
    }

    public async ValueTask DisposeAsync()
    {
        if (_app is not null)
        {
            await _app.StopAsync();
            await _app.DisposeAsync();
        }
    }
}

using System.Text;

namespace Oilix.PrintAgent.Core;

/// <summary>JSON body of POST /v1/print. The agent never receives URLs or file paths — only static HTML.</summary>
public sealed class PrintJobRequest
{
    public string? JobId { get; set; }
    public string? Printer { get; set; }
    /// <summary>"receipt" (thermal roll) or "document" (A4/A5 sheet).</summary>
    public string? Kind { get; set; }
    public int? PaperWidthMm { get; set; }
    public string? PaperFormat { get; set; }
    public string? Orientation { get; set; }
    public int? Copies { get; set; }
    public string? Html { get; set; }
    public string? Title { get; set; }
    /// <summary>Rendered height measured by the browser (receipts only, a hint).</summary>
    public double? ContentHeightMm { get; set; }
}

public static class PrintErrorCodes
{
    public const string InvalidJob = "INVALID_JOB";
    public const string JobTooLarge = "JOB_TOO_LARGE";
    public const string PrinterNotFound = "PRINTER_NOT_FOUND";
    public const string PrinterUnavailable = "PRINTER_UNAVAILABLE";
    public const string PrintFailed = "PRINT_FAILED";
    public const string JobInProgress = "JOB_IN_PROGRESS";
    public const string NotPaired = "NOT_PAIRED";
    public const string OriginNotAllowed = "ORIGIN_NOT_ALLOWED";
    public const string Timeout = "PRINT_TIMEOUT";
}

public sealed record PrintJobResult(
    bool Ok,
    string JobId,
    string Status,
    string? Printer,
    int Copies,
    string? Code = null,
    string? Message = null,
    long DurationMs = 0,
    bool Duplicate = false)
{
    public static PrintJobResult Submitted(string jobId, string printer, int copies, long ms) =>
        new(true, jobId, "SUBMITTED", printer, copies, DurationMs: ms);

    public static PrintJobResult Failed(string jobId, string? printer, int copies, string code, string message) =>
        new(false, jobId, "FAILED", printer, copies, code, message);
}

public sealed record ValidatedPrintJob(
    Guid JobId,
    string Printer,
    PageLayout Layout,
    int Copies,
    string Html,
    string Title);

public sealed record ValidationFailure(string Code, string Message);

public static class PrintJobValidator
{
    public static (ValidatedPrintJob? Job, ValidationFailure? Error) Validate(
        PrintJobRequest? req,
        int maxBytes,
        int maxCopies)
    {
        if (req is null) return Fail("Corps de requête manquant");
        if (!Guid.TryParse(req.JobId, out var jobId)) return Fail("jobId invalide");

        var printer = SanitizePrinterName(req.Printer);
        if (printer is null) return Fail("Nom d'imprimante invalide");

        var copies = req.Copies ?? 1;
        if (copies < 1 || copies > maxCopies) return Fail($"Nombre de copies entre 1 et {maxCopies}");

        PageLayout layout;
        switch (req.Kind)
        {
            case "receipt":
                if (req.PaperWidthMm is not (58 or 80)) return Fail("Largeur thermique 58 ou 80 mm");
                if (req.ContentHeightMm is { } h && (double.IsNaN(h) || h < 0 || h > 5000))
                    return Fail("Hauteur de contenu invalide");
                layout = PageLayout.Receipt(req.PaperWidthMm.Value, req.ContentHeightMm);
                break;
            case "document":
                var landscape = req.Orientation switch
                {
                    null or "portrait" => false,
                    "landscape" => true,
                    _ => (bool?)null,
                };
                if (landscape is null) return Fail("Orientation invalide");
                if (req.PaperFormat is not ("A4" or "A5")) return Fail("Format A4 ou A5");
                layout = PageLayout.Sheet(req.PaperFormat, landscape.Value);
                break;
            default:
                return Fail("Type de document inconnu");
        }

        var html = req.Html ?? "";
        if (Encoding.UTF8.GetByteCount(html) > maxBytes)
            return (null, new ValidationFailure(PrintErrorCodes.JobTooLarge, "Document trop volumineux"));
        var head = html.TrimStart();
        if (!(head.StartsWith("<!doctype html", StringComparison.OrdinalIgnoreCase)
              || head.StartsWith("<html", StringComparison.OrdinalIgnoreCase)))
            return Fail("Le document doit être un HTML complet");

        var title = AgentLog.Sanitize(req.Title);
        if (title.Length > 120) title = title[..120];

        return (new ValidatedPrintJob(jobId, printer, layout, copies, html, title), null);
    }

    /// <summary>Printable characters only, 1–200 chars. Windows printer names never contain control chars.</summary>
    public static string? SanitizePrinterName(string? name)
    {
        if (string.IsNullOrWhiteSpace(name)) return null;
        var n = name.Trim();
        if (n.Length > 200 || n.Any(char.IsControl)) return null;
        return n;
    }

    private static (ValidatedPrintJob?, ValidationFailure?) Fail(string message) =>
        (null, new ValidationFailure(PrintErrorCodes.InvalidJob, message));
}

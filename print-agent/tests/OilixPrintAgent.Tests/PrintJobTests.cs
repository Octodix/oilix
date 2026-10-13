using Oilix.PrintAgent.Core;
using Xunit;

namespace Oilix.PrintAgent.Tests;

public class PrintJobValidatorTests
{
    private const string Html = "<!doctype html><html><body>Oilix</body></html>";

    private static PrintJobRequest Receipt(Action<PrintJobRequest>? tweak = null)
    {
        var r = new PrintJobRequest
        {
            JobId = Guid.NewGuid().ToString(),
            Printer = "XPrinter XP-Q200",
            Kind = "receipt",
            PaperWidthMm = 80,
            Copies = 1,
            Html = Html,
            Title = "VT0000123",
        };
        tweak?.Invoke(r);
        return r;
    }

    [Fact]
    public void Accepts_a_thermal_receipt()
    {
        var (job, err) = PrintJobValidator.Validate(Receipt(), 1_000_000, 5);
        Assert.Null(err);
        Assert.True(job!.Layout.IsReceipt);
        Assert.Equal(80, job.Layout.WidthMm);
        Assert.Equal("XPrinter XP-Q200", job.Printer);
    }

    [Fact]
    public void Accepts_a_58mm_receipt_and_an_A5_landscape_document()
    {
        Assert.Null(PrintJobValidator.Validate(Receipt(r => r.PaperWidthMm = 58), 1_000_000, 5).Error);
        var (doc, err) = PrintJobValidator.Validate(Receipt(r =>
        {
            r.Kind = "document";
            r.PaperWidthMm = null;
            r.PaperFormat = "A5";
            r.Orientation = "landscape";
        }), 1_000_000, 5);
        Assert.Null(err);
        Assert.False(doc!.Layout.IsReceipt);
        Assert.Equal(210, doc.Layout.WidthMm);
        Assert.Equal(148, doc.Layout.HeightMm);
    }

    [Theory]
    [InlineData("not-a-guid")]
    [InlineData(null)]
    public void Rejects_invalid_job_ids(string? id) =>
        Assert.Equal(PrintErrorCodes.InvalidJob, PrintJobValidator.Validate(Receipt(r => r.JobId = id), 1_000_000, 5).Error!.Code);

    [Theory]
    [InlineData("")]
    [InlineData("XP\r\nQ200")]
    [InlineData("\u0000")]
    public void Rejects_unsafe_printer_names(string name) =>
        Assert.NotNull(PrintJobValidator.Validate(Receipt(r => r.Printer = name), 1_000_000, 5).Error);

    [Fact]
    public void Rejects_unknown_paper_sizes_formats_and_kinds()
    {
        Assert.NotNull(PrintJobValidator.Validate(Receipt(r => r.PaperWidthMm = 72), 1_000_000, 5).Error);
        Assert.NotNull(PrintJobValidator.Validate(Receipt(r => { r.Kind = "document"; r.PaperFormat = "A3"; }), 1_000_000, 5).Error);
        Assert.NotNull(PrintJobValidator.Validate(Receipt(r => r.Kind = "shell"), 1_000_000, 5).Error);
    }

    [Fact]
    public void Limits_copies() =>
        Assert.NotNull(PrintJobValidator.Validate(Receipt(r => r.Copies = 99), 1_000_000, 5).Error);

    [Fact]
    public void Rejects_oversized_documents()
    {
        var big = "<!doctype html>" + new string('x', 2000);
        var (_, err) = PrintJobValidator.Validate(Receipt(r => r.Html = big), 1000, 5);
        Assert.Equal(PrintErrorCodes.JobTooLarge, err!.Code);
    }

    [Theory]
    [InlineData("C:\\Users\\Public\\secret.pdf")]
    [InlineData("https://evil.test/doc.html")]
    [InlineData("file:///C:/Windows/win.ini")]
    [InlineData("")]
    public void Only_full_html_documents_are_printable(string content) =>
        Assert.NotNull(PrintJobValidator.Validate(Receipt(r => r.Html = content), 1_000_000, 5).Error);
}

public class PageLayoutTests
{
    [Fact]
    public void Receipt_height_follows_content_plus_cutter_feed()
    {
        var l = PageLayout.Receipt(80, 120);
        Assert.Equal(80, l.WidthMm);
        Assert.Equal(126, l.HeightMm);
        Assert.Equal(0, l.MarginMm);
    }

    [Fact]
    public void Receipt_height_is_clamped()
    {
        Assert.Equal(PageLayout.MinReceiptHeightMm, PageLayout.Receipt(58, 5).HeightMm);
        Assert.Equal(PageLayout.MaxReceiptHeightMm, PageLayout.Receipt(58, 4000).HeightMm);
        Assert.Equal(PageLayout.DefaultReceiptHeightMm + PageLayout.ReceiptFeedMm, PageLayout.Receipt(80, null).HeightMm);
    }

    [Fact]
    public void Measured_height_only_changes_receipts()
    {
        Assert.Equal(306, PageLayout.Receipt(80, null).WithMeasuredHeight(300).HeightMm);
        var a4 = PageLayout.Sheet("A4", false);
        Assert.Same(a4, a4.WithMeasuredHeight(50));
        Assert.Equal((210.0, 297.0), (a4.WidthMm, a4.HeightMm));
    }

    [Fact]
    public void Content_width_matches_css_pixels() =>
        Assert.Equal(302, PageLayout.Receipt(80, null).ContentWidthPx);
}

public class JobDeduplicatorTests
{
    [Fact]
    public void A_double_click_with_the_same_job_id_prints_once()
    {
        var d = new JobDeduplicator();
        var id = Guid.NewGuid();
        Assert.Equal(DedupeDecision.Proceed, d.TryBegin(id, out _));
        Assert.Equal(DedupeDecision.InFlight, d.TryBegin(id, out _));
        d.Complete(id, PrintJobResult.Submitted(id.ToString(), "XP", 1, 20));
        Assert.Equal(DedupeDecision.AlreadySubmitted, d.TryBegin(id, out var prev));
        Assert.True(prev!.Duplicate);
    }

    [Fact]
    public void A_failed_job_can_be_retried_with_the_same_id()
    {
        var d = new JobDeduplicator();
        var id = Guid.NewGuid();
        d.TryBegin(id, out _);
        d.Complete(id, PrintJobResult.Failed(id.ToString(), "XP", 1, PrintErrorCodes.PrinterUnavailable, "offline"));
        Assert.Equal(DedupeDecision.Proceed, d.TryBegin(id, out _));
    }

    [Fact]
    public void A_reprint_uses_a_new_id_and_is_not_blocked()
    {
        var d = new JobDeduplicator();
        var first = Guid.NewGuid();
        d.TryBegin(first, out _);
        d.Complete(first, PrintJobResult.Submitted(first.ToString(), "XP", 1, 10));
        Assert.Equal(DedupeDecision.Proceed, d.TryBegin(Guid.NewGuid(), out _));
    }

    [Fact]
    public void Remembered_jobs_expire()
    {
        var now = DateTimeOffset.UtcNow;
        var d = new JobDeduplicator(TimeSpan.FromMinutes(1), () => now);
        var id = Guid.NewGuid();
        d.TryBegin(id, out _);
        d.Complete(id, PrintJobResult.Submitted(id.ToString(), "XP", 1, 10));
        now += TimeSpan.FromMinutes(2);
        Assert.Equal(DedupeDecision.Proceed, d.TryBegin(id, out _));
    }
}

namespace Oilix.PrintAgent.Core;

/// <summary>Physical page geometry handed to the print engine (millimetres).</summary>
public sealed record PageLayout(
    bool IsReceipt,
    double WidthMm,
    double HeightMm,
    double MarginMm,
    bool Landscape)
{
    public const double MinReceiptHeightMm = 40;
    public const double MaxReceiptHeightMm = 3000;
    public const double DefaultReceiptHeightMm = 200;
    /// <summary>Blank feed after the last line so the cutter does not cut through text.</summary>
    public const double ReceiptFeedMm = 6;
    public const double SheetMarginMm = 8;

    public static PageLayout Receipt(int paperWidthMm, double? contentHeightMm) =>
        new(true, paperWidthMm, ReceiptHeight(contentHeightMm), 0, false);

    public static double ReceiptHeight(double? contentHeightMm)
    {
        var h = contentHeightMm is { } v && v > 0 ? v : DefaultReceiptHeightMm;
        return Math.Clamp(Math.Ceiling(h + ReceiptFeedMm), MinReceiptHeightMm, MaxReceiptHeightMm);
    }

    public static PageLayout Sheet(string format, bool landscape)
    {
        var (w, h) = format switch
        {
            "A5" => (148.0, 210.0),
            _ => (210.0, 297.0),
        };
        return landscape
            ? new PageLayout(false, h, w, SheetMarginMm, true)
            : new PageLayout(false, w, h, SheetMarginMm, false);
    }

    /// <summary>Receipt with the height measured by the agent's own renderer.</summary>
    public PageLayout WithMeasuredHeight(double contentHeightMm) =>
        IsReceipt ? this with { HeightMm = ReceiptHeight(contentHeightMm) } : this;

    public static double ToInches(double mm) => Math.Round(mm / 25.4, 4);

    /// <summary>CSS pixels (96 dpi) available for content across the page width.</summary>
    public int ContentWidthPx => (int)Math.Round((WidthMm - 2 * MarginMm) / 25.4 * 96);
}

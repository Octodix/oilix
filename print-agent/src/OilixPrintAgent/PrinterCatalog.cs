using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;

namespace Oilix.PrintAgent;

public sealed record PrinterInfo(string Name, bool IsDefault, bool Offline, string Status, string? Driver, string? Port);

/// <summary>Installed Windows printers via the spooler API (local + network connections).</summary>
public static class PrinterCatalog
{
    private const uint PRINTER_ENUM_LOCAL = 0x2;
    private const uint PRINTER_ENUM_CONNECTIONS = 0x4;
    private const uint PRINTER_ATTRIBUTE_WORK_OFFLINE = 0x400;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct PRINTER_INFO_2
    {
        public string? pServerName;
        public string pPrinterName;
        public string? pShareName;
        public string? pPortName;
        public string? pDriverName;
        public string? pComment;
        public string? pLocation;
        public IntPtr pDevMode;
        public string? pSepFile;
        public string? pPrintProcessor;
        public string? pDatatype;
        public string? pParameters;
        public IntPtr pSecurityDescriptor;
        public uint Attributes;
        public uint Priority;
        public uint DefaultPriority;
        public uint StartTime;
        public uint UntilTime;
        public uint Status;
        public uint cJobs;
        public uint AveragePPM;
    }

    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool EnumPrinters(uint flags, string? name, uint level, IntPtr buffer, uint cbBuf, out uint needed, out uint returned);

    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool GetDefaultPrinter(StringBuilder? buffer, ref uint size);

    public static string? DefaultPrinterName()
    {
        uint size = 0;
        GetDefaultPrinter(null, ref size);
        if (size == 0) return null;
        var sb = new StringBuilder((int)size);
        return GetDefaultPrinter(sb, ref size) ? sb.ToString() : null;
    }

    public static IReadOnlyList<PrinterInfo> List()
    {
        const uint flags = PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS;
        EnumPrinters(flags, null, 2, IntPtr.Zero, 0, out var needed, out _);
        if (needed == 0) return Array.Empty<PrinterInfo>();

        var buffer = Marshal.AllocHGlobal((int)needed);
        try
        {
            if (!EnumPrinters(flags, null, 2, buffer, needed, out _, out var returned))
                throw new Win32Exception(Marshal.GetLastWin32Error());

            var def = DefaultPrinterName();
            var size = Marshal.SizeOf<PRINTER_INFO_2>();
            var list = new List<PrinterInfo>((int)returned);
            for (var i = 0; i < returned; i++)
            {
                var info = Marshal.PtrToStructure<PRINTER_INFO_2>(buffer + i * size);
                var offline = (info.Attributes & PRINTER_ATTRIBUTE_WORK_OFFLINE) != 0 || (info.Status & 0x80) != 0;
                list.Add(new PrinterInfo(
                    info.pPrinterName,
                    string.Equals(info.pPrinterName, def, StringComparison.OrdinalIgnoreCase),
                    offline,
                    DescribeStatus(info.Status, offline),
                    info.pDriverName,
                    info.pPortName));
            }
            return list.OrderByDescending(p => p.IsDefault).ThenBy(p => p.Name, StringComparer.OrdinalIgnoreCase).ToList();
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
    }

    /// <summary>Exact installed name (case-insensitive lookup) — prevents printing to an arbitrary target.</summary>
    public static PrinterInfo? Find(string name) =>
        List().FirstOrDefault(p => string.Equals(p.Name, name, StringComparison.OrdinalIgnoreCase));

    /// <summary>
    /// Spooler status bits. Many USB thermal drivers report "ready" even when switched off,
    /// so this is informative only.
    /// </summary>
    public static string DescribeStatus(uint status, bool offline)
    {
        if (offline) return "offline";
        if ((status & 0x1) != 0) return "paused";
        if ((status & 0x8) != 0) return "paper_jam";
        if ((status & 0x10) != 0) return "paper_out";
        if ((status & 0x400000) != 0) return "door_open";
        if ((status & 0x2) != 0 || (status & 0x100000) != 0) return "error";
        if ((status & 0x1000) != 0) return "not_available";
        return "ready";
    }
}

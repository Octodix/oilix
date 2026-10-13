namespace Oilix.PrintAgent.Core;

public enum DedupeDecision { Proceed, InFlight, AlreadySubmitted }

/// <summary>
/// Guards against double submission of the same jobId (double click, network retry).
/// Only successful submissions are remembered, so a failed job can be retried with the same id.
/// A deliberate reprint uses a new jobId.
/// </summary>
public sealed class JobDeduplicator
{
    private readonly TimeSpan _retention;
    private readonly Func<DateTimeOffset> _now;
    private readonly object _gate = new();
    private readonly HashSet<Guid> _inFlight = new();
    private readonly Dictionary<Guid, (PrintJobResult Result, DateTimeOffset At)> _done = new();

    public JobDeduplicator(TimeSpan? retention = null, Func<DateTimeOffset>? now = null)
    {
        _retention = retention ?? TimeSpan.FromMinutes(15);
        _now = now ?? (() => DateTimeOffset.UtcNow);
    }

    public DedupeDecision TryBegin(Guid jobId, out PrintJobResult? previous)
    {
        lock (_gate)
        {
            Prune();
            previous = null;
            if (_done.TryGetValue(jobId, out var done))
            {
                previous = done.Result with { Duplicate = true };
                return DedupeDecision.AlreadySubmitted;
            }
            if (!_inFlight.Add(jobId)) return DedupeDecision.InFlight;
            return DedupeDecision.Proceed;
        }
    }

    public void Complete(Guid jobId, PrintJobResult result)
    {
        lock (_gate)
        {
            _inFlight.Remove(jobId);
            if (result.Ok) _done[jobId] = (result, _now());
        }
    }

    private void Prune()
    {
        var cutoff = _now() - _retention;
        foreach (var key in _done.Where(kv => kv.Value.At < cutoff).Select(kv => kv.Key).ToList())
            _done.Remove(key);
    }
}

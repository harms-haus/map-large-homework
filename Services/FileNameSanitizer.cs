namespace TestProject.Services;

/// <summary>
/// Validates and sanitizes untrusted uploaded file names so that any name
/// accepted on Linux is guaranteed to be acceptable on Windows too. Leading
/// directory components are stripped (closing the cross-platform
/// path-traversal gap — a backslash is a separator on Windows but a literal
/// character on Linux), and the resulting segment is rejected when it is
/// empty, contains a character illegal on Windows, or matches a reserved
/// Windows device name.
/// </summary>
internal static class FileNameSanitizer
{
    /// <summary>
    /// Characters disallowed in a stored file name on any supported platform.
    /// This is the union of <see cref="Path.GetInvalidFileNameChars"/> (which
    /// is platform-specific — on Linux it returns only NUL and '/') with the
    /// Windows-only separators and metacharacters, so a name accepted on Linux
    /// is guaranteed to be acceptable on Windows too. Without this, an upload
    /// like <c>report:2024.txt</c> succeeds on Linux but throws on Windows.
    /// </summary>
    private static readonly char[] s_invalidFileNameChars = Path.GetInvalidFileNameChars()
        .Concat(new[] { '\\', '/', ':', '*', '?', '"', '<', '>', '|' })
        .Distinct()
        .ToArray();

    /// <summary>
    /// File-name stems that Windows reserves regardless of extension (e.g.
    /// <c>CON.txt</c> is reserved just like <c>CON</c>). Rejected on every
    /// platform so an upload accepted on Linux cannot fail on Windows.
    /// </summary>
    private static readonly HashSet<string> s_reservedWindowsDeviceNames = new(StringComparer.OrdinalIgnoreCase)
    {
        "CON", "PRN", "AUX", "NUL",
        "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
        "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    };

    /// <summary>
    /// Reduces an untrusted uploaded file name to its final, safe segment and
    /// validates it. Leading directory components are stripped by treating
    /// both '/' and '\' as separators, and the resulting name is rejected when
    /// it is empty, contains a character invalid on Windows, or matches a
    /// reserved Windows device name. The returned name contains no separators
    /// and is therefore safe to combine with an already-sandboxed directory.
    /// </summary>
    public static string PrepareUploadedFileName(string? rawFileName)
    {
        var segment = (rawFileName ?? string.Empty)
            .Replace('\\', '/')
            .Split('/')
            .LastOrDefault(s => s.Length > 0 && s != "." && s != "..")
            ?? string.Empty;

        // Trim surrounding whitespace. Windows strips leading/trailing spaces
        // (and dots) from file names at the filesystem layer, so a name that is
        // only whitespace cannot exist there; trimming everywhere keeps Linux
        // consistent and reduces a whitespace-only name to the empty string,
        // which is rejected below.
        segment = segment.Trim();

        if (segment.Length == 0)
        {
            throw new ArgumentException("Invalid file name");
        }

        if (segment.IndexOfAny(s_invalidFileNameChars) >= 0)
        {
            throw new ArgumentException("File name contains invalid characters");
        }

        // Windows reserves device names like "CON" even with an extension
        // ("CON.txt"), so test the stem before the first dot.
        var dot = segment.IndexOf('.');
        var stem = dot < 0 ? segment : segment[..dot];
        if (s_reservedWindowsDeviceNames.Contains(stem))
        {
            throw new ArgumentException("File name is reserved");
        }

        return segment;
    }
}

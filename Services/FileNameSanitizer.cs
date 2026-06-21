namespace TestProject.Services;

/// <summary>
/// Validates and sanitizes untrusted uploaded file names so that any name
/// accepted on Linux is also acceptable on Windows. Leading directory
/// components are stripped (closing the cross-platform traversal gap — a
/// backslash is a separator on Windows but a literal on Linux), and the
/// resulting segment is rejected when empty, when it contains a character
/// illegal on Windows, or when it matches a reserved Windows device name.
/// </summary>
internal static class FileNameSanitizer
{
    /// <summary>
    /// Characters disallowed in a stored file name on any supported platform.
    /// The union of <see cref="Path.GetInvalidFileNameChars"/> (platform-specific
    /// — only NUL and '/' on Linux) with the Windows-only separators and
    /// metacharacters, so a name accepted on Linux is acceptable on Windows.
    /// </summary>
    private static readonly char[] s_invalidFileNameChars = Path.GetInvalidFileNameChars()
        .Concat(new[] { '\\', '/', ':', '*', '?', '"', '<', '>', '|' })
        .Distinct()
        .ToArray();

    /// <summary>Windows-reserved device-name stems regardless of extension
    /// (e.g. <c>CON.txt</c> is reserved just like <c>CON</c>).</summary>
    private static readonly HashSet<string> s_reservedWindowsDeviceNames = new(StringComparer.OrdinalIgnoreCase)
    {
        "CON", "PRN", "AUX", "NUL",
        "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
        "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    };

    /// <summary>
    /// Reduces an untrusted uploaded file name to its final, safe segment and
    /// validates it. Leading directory components are stripped by treating
    /// both '/' and '\' as separators, and the result is rejected when empty,
    /// when it contains a Windows-invalid character, or when it matches a
    /// reserved Windows device name. The returned name has no separators and
    /// is safe to combine with an already-sandboxed directory.
    /// </summary>
    public static string PrepareUploadedFileName(string? rawFileName)
    {
        var segment = (rawFileName ?? string.Empty)
            .Replace('\\', '/')
            .Split('/')
            .LastOrDefault(s => s.Length > 0 && s != "." && s != "..")
            ?? string.Empty;

        segment = segment.Trim();

        if (segment.Length == 0)
        {
            throw new ArgumentException("Invalid file name");
        }

        if (segment.IndexOfAny(s_invalidFileNameChars) >= 0)
        {
            throw new ArgumentException("File name contains invalid characters");
        }

        var dot = segment.IndexOf('.');
        var stem = dot < 0 ? segment : segment[..dot];
        if (s_reservedWindowsDeviceNames.Contains(stem))
        {
            throw new ArgumentException("File name is reserved");
        }

        return segment;
    }
}

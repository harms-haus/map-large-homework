using Microsoft.AspNetCore.Hosting;
using TestProject.Configuration;

namespace TestProject.Services;

/// <summary>
/// Encapsulates the home-directory root and the path-sandboxing logic that
/// confines every file-system operation to it. The root path is computed at
/// construction time, but the directory itself is created lazily on first
/// access of <see cref="Root"/> so that disk I/O (and any failure it might
/// raise) is decoupled from DI resolution: a misconfigured path surfaces on
/// the first request rather than at startup. Any relative path that
/// normalizes to a location outside the home root causes an
/// <see cref="ArgumentException"/> to be thrown before any disk access.
/// </summary>
internal sealed class HomeRoot
{
    private readonly Lazy<string> _rootLazy;

    /// <summary>
    /// Captures the resolved-path computation without executing it. Creating
    /// the directory (and surfacing any I/O failure) is deferred to first use
    /// via the <see cref="Lazy{T}"/>, which is constructed with
    /// <see cref="LazyThreadSafetyMode.ExecutionAndPublication"/> so the
    /// directory is materialized exactly once even under concurrent
    /// first-access.
    /// </summary>
    public HomeRoot(IWebHostEnvironment env, FileServiceOptions options)
    {
        _rootLazy = new Lazy<string>(
            () =>
            {
                var root = Path.GetFullPath(Path.Combine(
                    env.ContentRootPath,
                    options.HomeDirectory ?? "Home"));
                Directory.CreateDirectory(root);
                return root;
            },
            LazyThreadSafetyMode.ExecutionAndPublication);
    }

    /// <summary>
    /// The resolved home root, materializing it (creating the directory on
    /// disk) on first access.
    /// </summary>
    public string Root => _rootLazy.Value;

    /// <summary>
    /// Combines the home root with <paramref name="relativePath"/>, normalizes
    /// the result, and verifies it stays within the root. A null, empty, or
    /// whitespace path resolves to the root itself. Anything that escapes the
    /// root throws <see cref="ArgumentException"/>.
    /// </summary>
    public string SafeResolve(string relativePath)
    {
        var root = Root;

        if (string.IsNullOrWhiteSpace(relativePath))
        {
            return root;
        }

        var full = Path.GetFullPath(Path.Combine(root, relativePath));

        var isRoot = string.Equals(full, root, StringComparison.Ordinal);
        var isInsideRoot = full.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.Ordinal);

        if (!isRoot && !isInsideRoot)
        {
            throw new ArgumentException("Invalid path");
        }

        return full;
    }

    /// <summary>
    /// Converts an absolute path inside the root to a forward-slash relative
    /// path. The root itself becomes the empty string.
    /// </summary>
    public string ToRelative(string full)
    {
        var root = Root;
        return full
            .Substring(root.Length)
            .TrimStart(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
            .Replace('\\', '/');
    }

    /// <summary>
    /// Computes the normalized (forward-slash) parent of a relative path.
    /// Returns <c>null</c> when <paramref name="relative"/> is the root (empty),
    /// or the empty string when the path is a direct child of the root.
    /// </summary>
    public static string? ComputeParent(string relative)
    {
        if (string.IsNullOrEmpty(relative))
        {
            return null;
        }

        return Path.GetDirectoryName(relative)?.Replace('\\', '/') ?? string.Empty;
    }
}

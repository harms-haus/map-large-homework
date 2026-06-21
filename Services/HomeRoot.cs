using Microsoft.AspNetCore.Hosting;
using TestProject.Configuration;

namespace TestProject.Services;

/// <summary>
/// Encapsulates the home-directory root and the path-sandboxing logic that
/// confines every file-system operation to it. The root path is computed at
/// construction, but the directory is created lazily on first access of
/// <see cref="Root"/>, so disk I/O (and any failure it raises) is decoupled
/// from DI resolution: a misconfigured path surfaces on the first request
/// rather than at startup. Any path that normalizes outside the root throws
/// <see cref="ArgumentException"/> before any disk access.
/// </summary>
internal sealed class HomeRoot
{
    private readonly Lazy<string> _rootLazy;

    public HomeRoot(IWebHostEnvironment env, FileServiceOptions options)
    {
        // Lazy with ExecutionAndPublication materializes the directory exactly
        // once even under concurrent first-access.
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

    /// <summary>The resolved home root, creating the directory on first access.</summary>
    public string Root => _rootLazy.Value;

    /// <summary>
    /// Combines the root with <paramref name="relativePath"/>, normalizes the
    /// result, and verifies it stays within the root. A null/empty/whitespace
    /// path resolves to the root itself; anything escaping throws
    /// <see cref="ArgumentException"/>.
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
    /// path; the root itself becomes the empty string.
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
    /// Normalized (forward-slash) parent of a relative path: <c>null</c> when
    /// <paramref name="relative"/> is the root (empty), or the empty string
    /// when the path is a direct child of the root.
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

using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Options;
using TestProject.Configuration;
using TestProject.Models;

namespace TestProject.Services;

/// <summary>
/// Path-safe implementation of <see cref="IFileService"/> that confines every
/// operation to a single home directory. The root path is computed at
/// construction time, but the directory itself is created lazily on first use
/// so that disk I/O (and any failure it might raise) is decoupled from DI
/// resolution. Any relative path that normalizes to a location outside the
/// home root causes an <see cref="ArgumentException"/> to be thrown before any
/// disk access.
/// </summary>
public sealed class FileService : IFileService
{
    private const int MaxSearchResults = 500;

    /// <summary>
    /// Maximum recursion depth permitted for <see cref="CopyDirectory"/>. A
    /// copy that recurses this many levels deep is treated as a pathological or
    /// self-referential tree and aborted with <see cref="IOException"/> to
    /// guard against stack overflow.
    /// </summary>
    private const int MaxCopyDepth = 32;

    private readonly Lazy<string> _rootLazy;

    public FileService(IOptions<FileServiceOptions> options, IWebHostEnvironment env)
    {
        // Only compute the resolved path here. Creating the directory (and
        // surfacing any I/O failure) is deferred to first use via the Lazy,
        // which is thread-safe so the directory is materialized exactly once
        // even under concurrent first-access.
        _rootLazy = new Lazy<string>(
            () =>
            {
                var root = Path.GetFullPath(Path.Combine(
                    env.ContentRootPath,
                    options.Value.HomeDirectory ?? "Home"));
                Directory.CreateDirectory(root);
                return root;
            },
            LazyThreadSafetyMode.ExecutionAndPublication);
    }

    /// <summary>
    /// The resolved home root, materializing it on first access.
    /// </summary>
    private string Root => _rootLazy.Value;

    // =====================================================================
    // IFileService
    // =====================================================================

    /// <inheritdoc />
    public BrowseResultDto Browse(string relativePath)
    {
        var full = SafeResolve(relativePath);
        var relative = ToRelative(full);

        // Enumerate files and directories in a single pass, avoiding the
        // double traversal (and double array allocation) of separate
        // GetDirectories/GetFiles calls. Name, FullName, and LastWriteTimeUtc
        // are exposed by the shared FileSystemInfo base; only the file size
        // requires the FileInfo cast.
        var entries = new List<FileEntryDto>();

        foreach (var info in new DirectoryInfo(full).EnumerateFileSystemInfos())
        {
            if (info is DirectoryInfo directoryInfo)
            {
                entries.Add(new FileEntryDto(
                    Name: directoryInfo.Name,
                    Path: ToRelative(directoryInfo.FullName),
                    IsDirectory: true,
                    Size: 0,
                    LastModified: directoryInfo.LastWriteTimeUtc));
            }
            else
            {
                var fileInfo = (FileInfo)info;
                entries.Add(new FileEntryDto(
                    Name: fileInfo.Name,
                    Path: ToRelative(fileInfo.FullName),
                    IsDirectory: false,
                    Size: fileInfo.Length,
                    LastModified: fileInfo.LastWriteTimeUtc));
            }
        }

        // Directories first, then files, each group sorted by name (OrdinalIgnoreCase).
        entries.Sort(CompareEntries);

        var folderCount = 0;
        var fileCount = 0;
        var totalSize = 0L;
        foreach (var entry in entries)
        {
            if (entry.IsDirectory)
            {
                folderCount++;
            }
            else
            {
                fileCount++;
                totalSize += entry.Size;
            }
        }

        var parent = ComputeParent(relative);

        return new BrowseResultDto(relative, parent, entries, folderCount, fileCount, totalSize);
    }

    /// <inheritdoc />
    public SearchResultDto Search(string query, string relativePath)
    {
        var full = SafeResolve(relativePath);
        var relative = ToRelative(full);

        var results = new List<FileEntryDto>(MaxSearchResults);

        var stack = new Stack<string>();
        stack.Push(full);

        while (stack.Count > 0 && results.Count < MaxSearchResults)
        {
            var current = stack.Pop();

            string[] subdirectories;
            string[] files;
            try
            {
                subdirectories = Directory.GetDirectories(current);
                files = Directory.GetFiles(current);
            }
            catch (UnauthorizedAccessException)
            {
                continue;
            }
            catch (DirectoryNotFoundException)
            {
                continue;
            }

            foreach (var dir in subdirectories)
            {
                if (results.Count >= MaxSearchResults)
                {
                    break;
                }

                var info = new DirectoryInfo(dir);
                if (info.Name.Contains(query, StringComparison.OrdinalIgnoreCase))
                {
                    results.Add(new FileEntryDto(
                        Name: info.Name,
                        Path: ToRelative(dir),
                        IsDirectory: true,
                        Size: 0,
                        LastModified: info.LastWriteTimeUtc));
                }

                stack.Push(dir);
            }

            foreach (var file in files)
            {
                if (results.Count >= MaxSearchResults)
                {
                    break;
                }

                var info = new FileInfo(file);
                if (info.Name.Contains(query, StringComparison.OrdinalIgnoreCase))
                {
                    results.Add(new FileEntryDto(
                        Name: info.Name,
                        Path: ToRelative(file),
                        IsDirectory: false,
                        Size: info.Length,
                        LastModified: info.LastWriteTimeUtc));
                }
            }
        }

        return new SearchResultDto(query, relative, results);
    }

    /// <inheritdoc />
    public string ResolveFullPath(string relativePath) => SafeResolve(relativePath);

    /// <inheritdoc />
    public async Task UploadAsync(string relativeDirPath, IFormFile file)
    {
        var dir = SafeResolve(relativeDirPath);
        Directory.CreateDirectory(dir);

        var path = Path.Combine(dir, file.FileName);
        await using var fs = File.Create(path);
        await file.CopyToAsync(fs);
    }

    /// <summary>
    /// Deletes the file or directory (recursively) at <paramref name="relativePath"/>.
    /// Deleting a non-existent path succeeds silently — the post-condition
    /// (entry gone) is already met. This is achieved without an up-front
    /// <c>Exists</c> check, eliminating the check-then-act (TOCTOU) window in
    /// which a concurrent delete could cause a spurious
    /// <see cref="DirectoryNotFoundException"/>: the delete is attempted, and
    /// a missing-path outcome is treated as success rather than a failure.
    /// </summary>
    public void Delete(string relativePath)
    {
        var path = SafeResolve(relativePath);

        try
        {
            try
            {
                // Attempt the directory delete first. On a real file (or a
                // missing path) this throws DirectoryNotFoundException, which
                // is the signal to fall through to the file form.
                Directory.Delete(path, recursive: true);
            }
            catch (DirectoryNotFoundException)
            {
                // Not a directory (or already gone). File.Delete is itself a
                // no-op when the target file is absent.
                File.Delete(path);
            }
        }
        catch (DirectoryNotFoundException)
        {
            // Both the directory and file forms reported the path (or an
            // ancestor) as absent. The post-condition — the entry no longer
            // exists — is satisfied, so treat this as success.
        }
    }

    /// <inheritdoc />
    public void Move(MoveRequest request)
    {
        var source = SafeResolve(request.SourcePath);
        var destination = SafeResolve(request.DestinationPath);

        // Path.GetDirectoryName returns null when the destination is a
        // filesystem root (e.g. the home root itself). Moving an entry onto a
        // filesystem root is nonsensical within the home-directory sandbox, so
        // surface a clear error rather than letting
        // Directory.CreateDirectory(null) crash with an opaque
        // ArgumentNullException.
        var parent = Path.GetDirectoryName(destination);
        if (string.IsNullOrEmpty(parent))
        {
            throw new ArgumentException("Invalid destination path", nameof(request));
        }

        Directory.CreateDirectory(parent);

        if (Directory.Exists(source))
        {
            Directory.Move(source, destination);
        }
        else
        {
            File.Move(source, destination);
        }
    }

    /// <inheritdoc />
    public void Copy(CopyRequest request)
    {
        var source = SafeResolve(request.SourcePath);
        var destination = SafeResolve(request.DestinationPath);

        if (Directory.Exists(source))
        {
            CopyDirectory(source, destination, depth: 0);
        }
        else
        {
            File.Copy(source, destination, overwrite: false);
        }
    }

    // =====================================================================
    // Helpers
    // =====================================================================

    /// <summary>
    /// Combines the home root with <paramref name="relativePath"/>, normalizes
    /// the result, and verifies it stays within the root. A null, empty, or
    /// whitespace path resolves to the root itself. Anything that escapes the
    /// root throws <see cref="ArgumentException"/>.
    /// </summary>
    private string SafeResolve(string relativePath)
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
    private string ToRelative(string full)
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
    private static string? ComputeParent(string relative)
    {
        if (string.IsNullOrEmpty(relative))
        {
            return null;
        }

        return Path.GetDirectoryName(relative)?.Replace('\\', '/') ?? string.Empty;
    }

    /// <summary>
    /// Sorts directories before files, ordering each group by name using
    /// <see cref="StringComparison.OrdinalIgnoreCase"/>.
    /// </summary>
    private static int CompareEntries(FileEntryDto a, FileEntryDto b)
    {
        if (a.IsDirectory != b.IsDirectory)
        {
            return a.IsDirectory ? -1 : 1;
        }

        return string.Compare(a.Name, b.Name, StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// Recursively copies a directory tree, preserving structure. Existing
    /// files are not overwritten, matching the no-overwrite contract of
    /// <see cref="File.Copy(string, string, bool)"/>. The recursion is bounded
    /// by <see cref="MaxCopyDepth"/>: each nested directory increments
    /// <paramref name="depth"/> by one, and once it reaches the limit the copy
    /// is aborted with <see cref="IOException"/> to prevent stack overflow on
    /// pathological or self-referential trees.
    /// </summary>
    /// <param name="source">Absolute path to the directory to copy from.</param>
    /// <param name="destination">Absolute path to the directory to copy into.</param>
    /// <param name="depth">Current recursion depth, seeded at zero by
    /// <see cref="Copy"/>.</param>
    private static void CopyDirectory(string source, string destination, int depth)
    {
        if (depth >= MaxCopyDepth)
        {
            throw new IOException("Directory copy depth limit exceeded (possible cycle)");
        }

        Directory.CreateDirectory(destination);

        foreach (var file in Directory.GetFiles(source))
        {
            File.Copy(file, Path.Combine(destination, Path.GetFileName(file)), overwrite: false);
        }

        foreach (var directory in Directory.GetDirectories(source))
        {
            CopyDirectory(directory, Path.Combine(destination, Path.GetFileName(directory)), depth + 1);
        }
    }
}

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

                // Do not descend into reparse points (symbolic links on
                // Linux/macOS, directory junctions/symlinks on Windows): they
                // may target a location outside the home sandbox, and following
                // them would let Search enumerate content beyond the root. The
                // link is still eligible to appear as a match above.
                if (!IsReparsePoint(info))
                {
                    stack.Push(dir);
                }
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

        // The uploaded file name is untrusted client input. Reduce it to its
        // final, safe segment and validate it (see PrepareUploadedFileName)
        // before it is combined with the sandboxed directory. This blocks path
        // traversal ("../x", "..\x") on both platforms and rejects names that
        // are illegal on Windows, so an upload accepted on Linux cannot fail
        // when the app is deployed to Windows.
        var fileName = PrepareUploadedFileName(file.FileName);
        var path = Path.Combine(dir, fileName);

        await using var fs = File.Create(path);
        await file.CopyToAsync(fs);
    }

    /// <summary>
    /// Deletes the file or directory (recursively) at <paramref name="relativePath"/>.
    /// Deleting a non-existent path succeeds silently — the post-condition
    /// (entry gone) is already met.
    /// </summary>
    /// <remarks>
    /// Dispatch is driven by existence checks rather than by the exception
    /// type thrown by <see cref="Directory.Delete(string, bool)"/>, because
    /// that type is platform-dependent: on Linux deleting a path that is a
    /// file (or missing) throws <see cref="DirectoryNotFoundException"/>, but
    /// on Windows deleting an existing file throws <see cref="IOException"/>
    /// ("A file with the same name and location specified by path exists").
    /// A narrow race remains — a directory removed between
    /// <see cref="Directory.Exists(string)"/> and the delete call — but it is
    /// swallowed, so the worst case is a benign no-op rather than a spurious
    /// error.
    /// </remarks>
    public void Delete(string relativePath)
    {
        var path = SafeResolve(relativePath);

        if (Directory.Exists(path))
        {
            try
            {
                Directory.Delete(path, recursive: true);
            }
            catch (DirectoryNotFoundException)
            {
                // Vanished between the existence check and the delete (a
                // concurrent removal). The post-condition — the entry is
                // gone — already holds, so swallow the race.
            }
            return;
        }

        if (File.Exists(path))
        {
            // File.Delete is a documented no-op when the target is
            // concurrently removed, so no equivalent race guard is needed.
            File.Delete(path);
        }
        // else: neither a directory nor a file — already absent (including
        // the case where the parent directory never existed), which satisfies
        // the idempotent "entry gone" post-condition without touching disk.
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

    /// <inheritdoc />
    /// <remarks>
    /// <see cref="Directory.CreateDirectory(string)"/> is idempotent (a no-op
    /// when the directory already exists) and creates every missing parent, so
    /// a multi-segment relative path materializes the whole chain. The path is
    /// sandboxed by <see cref="SafeResolve"/> before any disk access, so a path
    /// that escapes the home root throws <see cref="ArgumentException"/>
    /// unchanged (translated to 400 by the controller). Creating over an
    /// existing <em>file</em> path would throw <see cref="IOException"/>, which
    /// the controller likewise translates to 400.
    /// </remarks>
    public void CreateDirectory(string relativePath)
    {
        Directory.CreateDirectory(SafeResolve(relativePath));
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
    /// Reduces an untrusted uploaded file name to its final, safe segment and
    /// validates it. Leading directory components are stripped by treating
    /// both '/' and '\' as separators (a backslash is a separator on Windows
    /// but a literal character on Linux, so handling both closes the
    /// cross-platform traversal gap), and the resulting name is rejected when
    /// it is empty, contains a character invalid on Windows, or matches a
    /// reserved Windows device name. The returned name contains no separators
    /// and is therefore safe to combine with an already-sandboxed directory.
    /// </summary>
    private static string PrepareUploadedFileName(string? rawFileName)
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

    /// <summary>
    /// Determines whether the given file-system entry is a reparse point (a
    /// symbolic link on Linux/macOS, a symbolic link or directory junction on
    /// Windows). The attributes of the entry itself are inspected — not those
    /// of its target — so the link is never followed.
    /// </summary>
    private static bool IsReparsePoint(FileSystemInfo info)
        => (info.Attributes & FileAttributes.ReparsePoint) != 0;

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
            // Skip reparse points (e.g. symlinked files): File.Copy follows
            // the link and would copy the target's contents, which may live
            // outside the home sandbox. Such entries are not reproduced.
            if (IsReparsePoint(new FileInfo(file)))
            {
                continue;
            }

            File.Copy(file, Path.Combine(destination, Path.GetFileName(file)), overwrite: false);
        }

        foreach (var directory in Directory.GetDirectories(source))
        {
            // Skip reparse points (symbolic links / junctions to
            // directories): recursing into them would follow the link and copy
            // content from outside the home sandbox. The link entry itself is
            // not reproduced in the destination.
            if (IsReparsePoint(new DirectoryInfo(directory)))
            {
                continue;
            }

            CopyDirectory(directory, Path.Combine(destination, Path.GetFileName(directory)), depth + 1);
        }
    }
}

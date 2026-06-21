using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Options;
using TestProject.Configuration;
using TestProject.Models;

namespace TestProject.Services;

/// <summary>
/// Path-safe implementation of <see cref="IFileService"/> that confines every
/// operation to a single home directory. This class is a thin orchestrator:
/// path sandboxing and the lazily-created root live in <see cref="HomeRoot"/>,
/// uploaded-file-name validation in <see cref="FileNameSanitizer"/>,
/// recursion-bounded directory copying in <see cref="DirectoryCopy"/>, and the
/// recursive search traversal in <see cref="FileSearch"/>. Any relative path
/// that normalizes to a location outside the home root causes an
/// <see cref="ArgumentException"/> to be thrown before any disk access.
/// </summary>
public sealed class FileService : IFileService
{
    private readonly HomeRoot _root;
    private readonly FileSearch _search;

    public FileService(IOptions<FileServiceOptions> options, IWebHostEnvironment env)
    {
        // Constructing the collaborators has no filesystem side effects: the
        // home directory is created lazily on first use inside HomeRoot, and
        // FileSearch only stores the root reference.
        _root = new HomeRoot(env, options.Value);
        _search = new FileSearch(_root);
    }

    // =====================================================================
    // IFileService
    // =====================================================================

    /// <inheritdoc />
    public BrowseResultDto Browse(string relativePath)
    {
        var full = _root.SafeResolve(relativePath);
        var relative = _root.ToRelative(full);

        // Enumerate files and directories in a single pass, avoiding the
        // double traversal (and double array allocation) of separate
        // GetDirectories/GetFiles calls.
        var entries = new List<FileEntryDto>();
        foreach (var info in new DirectoryInfo(full).EnumerateFileSystemInfos())
        {
            entries.Add(FileSystemHelpers.BuildEntry(info, _root));
        }

        // Directories first, then files, each group sorted by name (OrdinalIgnoreCase).
        entries.Sort(CompareEntries);

        var (folderCount, fileCount, totalSize) = SummarizeEntries(entries);
        var parent = HomeRoot.ComputeParent(relative);

        return new BrowseResultDto(relative, parent, entries, folderCount, fileCount, totalSize);
    }

    /// <inheritdoc />
    public SearchResultDto Search(string query, string relativePath)
        => _search.Search(query, relativePath);

    /// <inheritdoc />
    public string ResolveFullPath(string relativePath) => _root.SafeResolve(relativePath);

    /// <inheritdoc />
    public async Task<string> UploadAsync(string relativeDirPath, IFormFile file)
    {
        var dir = _root.SafeResolve(relativeDirPath);
        Directory.CreateDirectory(dir);

        // The uploaded file name is untrusted client input. Reduce it to its
        // final, safe segment and validate it (see
        // FileNameSanitizer.PrepareUploadedFileName) before it is combined with
        // the sandboxed directory. This blocks path traversal ("../x", "..\x")
        // on both platforms and rejects names that are illegal on Windows, so
        // an upload accepted on Linux cannot fail when the app is deployed to
        // Windows.
        var fileName = FileNameSanitizer.PrepareUploadedFileName(file.FileName);
        var path = Path.Combine(dir, fileName);

        await using var fs = File.Create(path);
        await file.CopyToAsync(fs);

        // Report the actual stored location as a normalized relative path. The
        // service is the single source of truth for this value — using
        // ToRelative on the absolute path just written guarantees the response
        // reflects the sanitized file name rather than the raw, possibly
        // traversal-laden input.
        return _root.ToRelative(path);
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
        var path = _root.SafeResolve(relativePath);

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
        var source = _root.SafeResolve(request.SourcePath);
        var destination = _root.SafeResolve(request.DestinationPath);

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
        var source = _root.SafeResolve(request.SourcePath);
        var destination = _root.SafeResolve(request.DestinationPath);

        if (Directory.Exists(source))
        {
            DirectoryCopy.CopyDirectory(source, destination, depth: 0);
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
    /// sandboxed by <see cref="HomeRoot.SafeResolve"/> before any disk access,
    /// so a path that escapes the home root throws <see cref="ArgumentException"/>
    /// unchanged (translated to 400 by the controller). Creating over an
    /// existing <em>file</em> path would throw <see cref="IOException"/>, which
    /// the controller likewise translates to 400.
    /// </remarks>
    public void CreateDirectory(string relativePath)
    {
        Directory.CreateDirectory(_root.SafeResolve(relativePath));
    }

    // =====================================================================
    // Browse helpers
    // =====================================================================

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
    /// Aggregates the folder count, file count, and total file size across a
    /// browse listing. Directories contribute to the folder count only; files
    /// contribute to the file count and their size to the total.
    /// </summary>
    private static (int FolderCount, int FileCount, long TotalSize) SummarizeEntries(
        IReadOnlyList<FileEntryDto> entries)
    {
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

        return (folderCount, fileCount, totalSize);
    }
}

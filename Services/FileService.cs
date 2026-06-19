using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Options;
using TestProject.Models;

namespace TestProject.Services;

/// <summary>
/// Path-safe implementation of <see cref="IFileService"/> that confines every
/// operation to a single home directory computed once at construction time.
/// Any relative path that normalizes to a location outside the home root causes
/// an <see cref="ArgumentException"/> to be thrown before any disk access.
/// </summary>
public sealed class FileService : IFileService
{
    private const int MaxSearchResults = 500;

    private readonly string _root;

    public FileService(IOptions<FileServiceOptions> options, IWebHostEnvironment env)
    {
        var root = Path.GetFullPath(Path.Combine(env.ContentRootPath, options.Value.HomeDirectory ?? "Home"));
        Directory.CreateDirectory(root);
        _root = root;
    }

    // =====================================================================
    // IFileService
    // =====================================================================

    /// <inheritdoc />
    public BrowseResultDto Browse(string relativePath)
    {
        var full = SafeResolve(relativePath);
        var relative = ToRelative(full);

        var directoryPaths = Directory.GetDirectories(full);
        var filePaths = Directory.GetFiles(full);

        var entries = new List<FileEntryDto>(directoryPaths.Length + filePaths.Length);

        foreach (var dir in directoryPaths)
        {
            var info = new DirectoryInfo(dir);
            entries.Add(new FileEntryDto(
                Name: info.Name,
                Path: ToRelative(dir),
                IsDirectory: true,
                Size: 0,
                LastModified: info.LastWriteTimeUtc));
        }

        foreach (var file in filePaths)
        {
            var info = new FileInfo(file);
            entries.Add(new FileEntryDto(
                Name: info.Name,
                Path: ToRelative(file),
                IsDirectory: false,
                Size: info.Length,
                LastModified: info.LastWriteTimeUtc));
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

    /// <inheritdoc />
    public void Delete(string relativePath)
    {
        var path = SafeResolve(relativePath);

        if (Directory.Exists(path))
        {
            Directory.Delete(path, recursive: true);
        }
        else
        {
            File.Delete(path);
        }
    }

    /// <inheritdoc />
    public void Move(MoveRequest request)
    {
        var source = SafeResolve(request.SourcePath);
        var destination = SafeResolve(request.DestinationPath);

        Directory.CreateDirectory(Path.GetDirectoryName(destination)!);

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
            CopyDirectory(source, destination);
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
        if (string.IsNullOrWhiteSpace(relativePath))
        {
            return _root;
        }

        var full = Path.GetFullPath(Path.Combine(_root, relativePath));

        var isRoot = string.Equals(full, _root, StringComparison.Ordinal);
        var isInsideRoot = full.StartsWith(_root + Path.DirectorySeparatorChar, StringComparison.Ordinal);

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
        return full
            .Substring(_root.Length)
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

        var separatorIndex = relative.LastIndexOf('/');
        if (separatorIndex < 0)
        {
            return string.Empty;
        }

        return relative.Substring(0, separatorIndex);
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
    /// <see cref="File.Copy(string, string, bool)"/>.
    /// </summary>
    private static void CopyDirectory(string source, string destination)
    {
        Directory.CreateDirectory(destination);

        foreach (var file in Directory.GetFiles(source))
        {
            File.Copy(file, Path.Combine(destination, Path.GetFileName(file)), overwrite: false);
        }

        foreach (var directory in Directory.GetDirectories(source))
        {
            CopyDirectory(directory, Path.Combine(destination, Path.GetFileName(directory)));
        }
    }
}

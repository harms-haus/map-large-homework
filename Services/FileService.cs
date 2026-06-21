using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Options;
using TestProject.Configuration;
using TestProject.Models;

namespace TestProject.Services;

/// <summary>
/// Path-safe <see cref="IFileService"/> that confines every operation to a
/// single home directory. A thin orchestrator: sandboxing lives in
/// <see cref="HomeRoot"/>, name validation in <see cref="FileNameSanitizer"/>,
/// directory copying in <see cref="DirectoryCopy"/>, and search traversal in
/// <see cref="FileSearch"/>. Any path that normalizes outside the home root
/// throws <see cref="ArgumentException"/> before any disk access.
/// </summary>
public sealed class FileService : IFileService
{
    private readonly HomeRoot _root;
    private readonly FileSearch _search;

    public FileService(IOptions<FileServiceOptions> options, IWebHostEnvironment env)
    {
        _root = new HomeRoot(env, options.Value);
        _search = new FileSearch(_root);
    }

    /// <inheritdoc />
    public BrowseResultDto Browse(string relativePath)
    {
        var full = _root.SafeResolve(relativePath);
        var relative = _root.ToRelative(full);

        // Single pass avoids the double traversal and double allocation of
        // separate GetDirectories/GetFiles calls.
        var entries = new List<FileEntryDto>();
        foreach (var info in new DirectoryInfo(full).EnumerateFileSystemInfos())
        {
            entries.Add(FileSystemHelpers.BuildEntry(info, _root));
        }

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

        // The uploaded name is untrusted client input: reduce it to a safe
        // segment and validate it (see FileNameSanitizer) before combining it
        // with the sandboxed directory. This blocks path traversal on both
        // platforms and rejects names illegal on Windows, so an upload
        // accepted on Linux cannot fail when deployed to Windows.
        var fileName = FileNameSanitizer.PrepareUploadedFileName(file.FileName);
        var path = Path.Combine(dir, fileName);

        await using var fs = File.Create(path);
        await file.CopyToAsync(fs);

        return _root.ToRelative(path);
    }

    /// <summary>
    /// Deletes the file or directory (recursively) at <paramref name="relativePath"/>.
    /// Deleting a non-existent path succeeds silently.
    /// </summary>
    /// <remarks>
    /// Dispatch is by existence checks rather than by the exception type thrown
    /// by <see cref="Directory.Delete(string, bool)"/>, which is
    /// platform-dependent: on Linux deleting a file/missing path throws
    /// <see cref="DirectoryNotFoundException"/>, on Windows deleting an
    /// existing file throws <see cref="IOException"/>. A directory removed
    /// between the existence check and the delete throws
    /// <see cref="DirectoryNotFoundException"/>, which is swallowed so the
    /// benign no-op satisfies the "entry gone" post-condition.
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
                // Vanished between the existence check and the delete.
            }
            return;
        }

        if (File.Exists(path))
        {
            File.Delete(path);
        }
    }

    /// <inheritdoc />
    public void Move(MoveRequest request)
    {
        var source = _root.SafeResolve(request.SourcePath);
        var destination = _root.SafeResolve(request.DestinationPath);

        // Moving onto the filesystem root is nonsensical; reject rather than
        // letting Directory.CreateDirectory(null) throw an opaque ArgumentNullException.
        var parent = Path.GetDirectoryName(destination);
        if (string.IsNullOrEmpty(parent))
        {
            throw new ArgumentException("Invalid destination path", nameof(request));
        }

        if (File.Exists(destination) || Directory.Exists(destination))
        {
            throw new ConflictException("Destination already exists");
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

        if (File.Exists(destination) || Directory.Exists(destination))
        {
            throw new ConflictException("Destination already exists");
        }

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
    /// <see cref="Directory.CreateDirectory(string)"/> is idempotent and creates
    /// parents, so an existing directory is a no-op. An escaping path throws
    /// <see cref="ArgumentException"/> (→ 400); creating over an existing file
    /// throws <see cref="ConflictException"/> (→ 409).
    /// </remarks>
    public void CreateDirectory(string relativePath)
    {
        var path = _root.SafeResolve(relativePath);
        if (File.Exists(path))
        {
            throw new ConflictException("A file with this name already exists");
        }
        Directory.CreateDirectory(path);
    }

    /// <summary>
    /// Sorts directories before files, each group by name
    /// (<see cref="StringComparison.OrdinalIgnoreCase"/>).
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
    /// Aggregates folder count, file count, and total file size across a
    /// listing. Directories count toward the folder count only; files toward
    /// the file count and total.
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

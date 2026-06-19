using Microsoft.AspNetCore.Http;
using TestProject.Models;

namespace TestProject.Services;

/// <summary>
/// Provides path-safe file system operations confined to a configurable
/// home directory. All relative paths are validated so they cannot escape
/// the sandboxed root before any disk access occurs.
/// </summary>
public interface IFileService
{
    /// <summary>
    /// Lists the immediate children of the directory at <paramref name="relativePath"/>,
    /// returning directories first (then files), each sorted by name.
    /// </summary>
    BrowseResultDto Browse(string relativePath);

    /// <summary>
    /// Recursively searches under <paramref name="relativePath"/> for entries
    /// whose name contains <paramref name="query"/> (case-insensitive).
    /// </summary>
    SearchResultDto Search(string query, string relativePath);

    /// <summary>
    /// Resolves a relative path to its absolute, normalized counterpart within
    /// the home root. Used by controllers to stream downloads.
    /// </summary>
    string ResolveFullPath(string relativePath);

    /// <summary>
    /// Writes the uploaded <paramref name="file"/> into the directory at
    /// <paramref name="relativeDirPath"/>, creating it if necessary.
    /// </summary>
    Task UploadAsync(string relativeDirPath, IFormFile file);

    /// <summary>
    /// Deletes the file or directory (recursively) at <paramref name="relativePath"/>.
    /// </summary>
    void Delete(string relativePath);

    /// <summary>
    /// Moves the file or directory at <paramref name="request.SourcePath"/> to
    /// <paramref name="request.DestinationPath"/>.
    /// </summary>
    void Move(MoveRequest request);

    /// <summary>
    /// Copies the file or directory at <paramref name="request.SourcePath"/> to
    /// <paramref name="request.DestinationPath"/>.
    /// </summary>
    void Copy(CopyRequest request);
}

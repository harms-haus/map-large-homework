using TestProject.Models;

namespace TestProject.Services;

/// <summary>
/// Recursive name-based search over the home directory tree. A stack-based
/// depth-first walk matches entry names case-insensitively, caps the result
/// list at <see cref="MaxSearchResults"/>, and never descends into reparse
/// points (symbolic links / junctions): such a link may target a location
/// outside the home sandbox, and following it would enumerate content beyond
/// the root. The link itself remains eligible to appear as a match.
/// </summary>
internal sealed class FileSearch
{
    /// <summary>Maximum entries a single search may return; traversal stops here.</summary>
    private const int MaxSearchResults = 500;

    private readonly HomeRoot _root;

    public FileSearch(HomeRoot root)
    {
        _root = root;
    }

    /// <summary>
    /// Recursively searches under <paramref name="relativePath"/> for entries
    /// whose name contains <paramref name="query"/> (case-insensitive), capped
    /// at <see cref="MaxSearchResults"/> matches.
    /// </summary>
    public SearchResultDto Search(string query, string relativePath)
    {
        var full = _root.SafeResolve(relativePath);
        var relative = _root.ToRelative(full);

        var results = new List<FileEntryDto>(MaxSearchResults);

        var stack = new Stack<string>();
        stack.Push(full);

        while (stack.Count > 0 && results.Count < MaxSearchResults)
        {
            var current = stack.Pop();

            var remainingCapacity = MaxSearchResults - results.Count;
            var (matches, descendInto) = EnumerateDirectory(current, query, remainingCapacity);
            results.AddRange(matches);

            foreach (var dir in descendInto)
            {
                stack.Push(dir);
            }
        }

        return new SearchResultDto(query, relative, results);
    }

    /// <summary>
    /// Enumerates one directory, returning the entries whose names match
    /// <paramref name="query"/> and the subdirectories safe to descend into.
    /// Matches are capped at <paramref name="remainingCapacity"/> so the caller
    /// can append them directly. Reparse points may still be reported as
    /// matches but are never returned for descent. An inaccessible directory
    /// (access denied, or removed between selection and enumeration) yields no
    /// matches and no descents rather than aborting the whole search.
    /// </summary>
    private (List<FileEntryDto> Matches, List<string> DescendInto) EnumerateDirectory(
        string current, string query, int remainingCapacity)
    {
        var matches = new List<FileEntryDto>();
        var descendInto = new List<string>();

        string[] subdirectories;
        string[] files;
        try
        {
            subdirectories = Directory.GetDirectories(current);
            files = Directory.GetFiles(current);
        }
        catch (UnauthorizedAccessException)
        {
            return (matches, descendInto);
        }
        catch (DirectoryNotFoundException)
        {
            return (matches, descendInto);
        }

        foreach (var dir in subdirectories)
        {
            if (matches.Count >= remainingCapacity)
            {
                break;
            }

            var info = new DirectoryInfo(dir);
            if (info.Name.Contains(query, StringComparison.OrdinalIgnoreCase))
            {
                matches.Add(FileSystemHelpers.BuildEntry(info, _root));
            }

            // Skip reparse points for descent (see class summary).
            if (!FileSystemHelpers.IsReparsePoint(info))
            {
                descendInto.Add(dir);
            }
        }

        foreach (var file in files)
        {
            if (matches.Count >= remainingCapacity)
            {
                break;
            }

            var info = new FileInfo(file);
            if (info.Name.Contains(query, StringComparison.OrdinalIgnoreCase))
            {
                matches.Add(FileSystemHelpers.BuildEntry(info, _root));
            }
        }

        return (matches, descendInto);
    }
}

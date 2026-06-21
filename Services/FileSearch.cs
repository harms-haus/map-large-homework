using TestProject.Models;

namespace TestProject.Services;

/// <summary>
/// Recursive name-based search over the home directory tree. Traversal is a
/// stack-based depth-first walk that matches entry names case-insensitively,
/// caps the result list at <see cref="MaxSearchResults"/>, and never descends
/// into reparse points (symbolic links / junctions): such a link may target a
/// location outside the home sandbox, and following it would let search
/// enumerate content beyond the root. The link itself remains eligible to
/// appear as a match.
/// </summary>
internal sealed class FileSearch
{
    /// <summary>
    /// Maximum number of entries a single search may return. The traversal
    /// stops as soon as this many matches have accumulated.
    /// </summary>
    private const int MaxSearchResults = 500;

    private readonly HomeRoot _root;

    /// <summary>
    /// Binds the searcher to the <see cref="HomeRoot"/> used to resolve and
    /// normalize paths. The root is not accessed at construction time, so
    /// building the searcher has no filesystem side effects.
    /// </summary>
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

            // EnumerateDirectory appends this directory's matches (honoring the
            // remaining capacity) and returns the subdirectories still safe to
            // descend into. The cap is enforced inside the helper so the
            // caller never exceeds MaxSearchResults.
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
    /// Enumerates a single directory, collecting the entries whose names match
    /// <paramref name="query"/> and the subdirectories that should be descended
    /// into. The match list is capped at <paramref name="remainingCapacity"/>
    /// (the number of slots left before <see cref="MaxSearchResults"/> is
    /// reached) so the caller can append it directly. Subdirectories that are
    /// reparse points are still reported as matches when their name fits the
    /// query, but are never returned for descent. An inaccessible directory
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

            // Do not descend into reparse points (symbolic links on
            // Linux/macOS, directory junctions/symlinks on Windows): they may
            // target a location outside the home sandbox, and following them
            // would let search enumerate content beyond the root. The link is
            // still eligible to appear as a match above.
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

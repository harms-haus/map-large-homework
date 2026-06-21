using System.Text.RegularExpressions;
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

    private static readonly char[] Wildcards = { '*', '?' };

    private readonly HomeRoot _root;

    public FileSearch(HomeRoot root)
    {
        _root = root;
    }

    /// <summary>
    /// Recursively searches under <paramref name="relativePath"/> for entries
    /// whose name matches <paramref name="query"/> (case-insensitive), capped
    /// at <see cref="MaxSearchResults"/> matches. A plain query matches as a
    /// substring; one containing <c>*</c> or <c>?</c> is matched as an
    /// anchored glob.
    /// </summary>
    public SearchResultDto Search(string query, string relativePath)
    {
        var full = _root.SafeResolve(relativePath);
        var relative = _root.ToRelative(full);
        var matchesName = BuildNameMatcher(query);

        var results = new List<FileEntryDto>(MaxSearchResults);

        var stack = new Stack<string>();
        stack.Push(full);

        while (stack.Count > 0 && results.Count < MaxSearchResults)
        {
            var current = stack.Pop();

            var remainingCapacity = MaxSearchResults - results.Count;
            var (matches, descendInto) = EnumerateDirectory(current, matchesName, remainingCapacity);
            results.AddRange(matches);

            foreach (var dir in descendInto)
            {
                stack.Push(dir);
            }
        }

        return new SearchResultDto(query, relative, results);
    }

    /// <summary>
    /// A query without wildcards matches as a case-insensitive substring so
    /// plain search-as-you-type keeps working. With <c>*</c>/<c>?</c> present
    /// the whole query is an anchored glob: <c>*</c> spans any characters,
    /// <c>?</c> exactly one. Built once so the regex is not recompiled per entry.
    /// </summary>
    private static Func<string, bool> BuildNameMatcher(string query)
    {
        if (query.IndexOfAny(Wildcards) < 0)
        {
            return name => name.Contains(query, StringComparison.OrdinalIgnoreCase);
        }

        var pattern = "^" + Regex.Escape(query).Replace("\\*", ".*").Replace("\\?", ".") + "$";
        var regex = new Regex(pattern, RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        return regex.IsMatch;
    }

    /// <summary>
    /// Enumerates one directory, returning the entries whose names match via
    /// <paramref name="matchesName"/> and the subdirectories safe to descend into.
    /// Matches are capped at <paramref name="remainingCapacity"/> so the caller
    /// can append them directly. Reparse points may still be reported as
    /// matches but are never returned for descent. An inaccessible directory
    /// (access denied, or removed between selection and enumeration) yields no
    /// matches and no descents rather than aborting the whole search.
    /// </summary>
    private (List<FileEntryDto> Matches, List<string> DescendInto) EnumerateDirectory(
        string current, Func<string, bool> matchesName, int remainingCapacity)
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
            if (matchesName(info.Name))
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
            if (matchesName(info.Name))
            {
                matches.Add(FileSystemHelpers.BuildEntry(info, _root));
            }
        }

        return (matches, descendInto);
    }
}

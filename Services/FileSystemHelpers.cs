using TestProject.Models;

namespace TestProject.Services;

/// <summary>
/// Shared, stateless file-system utilities used across browse, search, and
/// copy operations. Centralizing these keeps the reparse-point semantics and
/// directory-entry construction consistent wherever file-system entries are
/// inspected or reported.
/// </summary>
internal static class FileSystemHelpers
{
    /// <summary>
    /// Determines whether the given file-system entry is a reparse point (a
    /// symbolic link on Linux/macOS, a symbolic link or directory junction on
    /// Windows). The attributes of the entry itself are inspected — not those
    /// of its target — so the link is never followed.
    /// </summary>
    public static bool IsReparsePoint(FileSystemInfo info)
        => (info.Attributes & FileAttributes.ReparsePoint) != 0;

    /// <summary>
    /// Counts the immediate children (files + subdirectories) of a directory,
    /// used to populate a directory entry's
    /// <see cref="FileEntryDto.ItemCount"/> for display in the Size column.
    /// Only direct children are counted — nested contents below a subdirectory
    /// are NOT included. Returns 0 for an empty or inaccessible directory, and
    /// for a reparse point (symbolic link / junction): following such a link
    /// would enumerate content outside the home sandbox, so it is reported as
    /// having no visible children rather than descending into its (possibly
    /// external) target. Enumeration errors (access denied, directory removed
    /// between the listing and the count) are swallowed and reported as 0 so
    /// one unreadable folder cannot abort a browse/search response.
    /// </summary>
    public static int CountImmediateItems(DirectoryInfo directoryInfo)
    {
        if (IsReparsePoint(directoryInfo))
        {
            return 0;
        }

        try
        {
            var count = 0;
            foreach (var _ in directoryInfo.EnumerateFileSystemInfos())
            {
                count++;
            }
            return count;
        }
        catch (UnauthorizedAccessException)
        {
            return 0;
        }
        catch (DirectoryNotFoundException)
        {
            return 0;
        }
    }

    /// <summary>
    /// Builds a <see cref="FileEntryDto"/> from a file-system entry, using
    /// <paramref name="root"/> to convert its absolute path to a normalized
    /// forward-slash relative path. Directory entries carry the count of their
    /// immediate children (via <see cref="CountImmediateItems"/>); file entries
    /// report their length and an item count of zero.
    /// </summary>
    public static FileEntryDto BuildEntry(FileSystemInfo info, HomeRoot root)
    {
        if (info is DirectoryInfo directoryInfo)
        {
            return new FileEntryDto(
                Name: directoryInfo.Name,
                Path: root.ToRelative(directoryInfo.FullName),
                IsDirectory: true,
                Size: 0,
                LastModified: directoryInfo.LastWriteTimeUtc,
                ItemCount: CountImmediateItems(directoryInfo));
        }

        var fileInfo = (FileInfo)info;
        return new FileEntryDto(
            Name: fileInfo.Name,
            Path: root.ToRelative(fileInfo.FullName),
            IsDirectory: false,
            Size: fileInfo.Length,
            LastModified: fileInfo.LastWriteTimeUtc,
            ItemCount: 0);
    }
}

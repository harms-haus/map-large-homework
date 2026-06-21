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
    /// Determines whether the entry is a reparse point (a symbolic link on
    /// Linux/macOS, a symlink or directory junction on Windows). The entry's
    /// own attributes are inspected — not the target's — so the link is never
    /// followed.
    /// </summary>
    public static bool IsReparsePoint(FileSystemInfo info)
        => (info.Attributes & FileAttributes.ReparsePoint) != 0;

    /// <summary>
    /// Counts the immediate children (files + subdirectories) of a directory,
    /// used to populate a directory entry's
    /// <see cref="FileEntryDto.ItemCount"/> for the Size column. Nested
    /// contents below a subdirectory are not included. Returns 0 for an empty
    /// or inaccessible directory, and for a reparse point (following such a
    /// link would enumerate content outside the home sandbox). Enumeration
    /// errors (access denied, directory removed mid-count) are swallowed and
    /// reported as 0 so one unreadable folder cannot abort a response.
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
    /// Builds a <see cref="FileEntryDto"/> from a file-system entry, converting
    /// its absolute path to a normalized forward-slash relative path via
    /// <paramref name="root"/>. Directory entries carry their immediate-child
    /// count; file entries report their length.
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

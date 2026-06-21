namespace TestProject.Services;

/// <summary>
/// Recursion-bounded directory tree copying. Existing files are never
/// overwritten (matching the no-overwrite contract of
/// <see cref="File.Copy(string, string, bool)"/>), and reparse points
/// (symbolic links / junctions) are skipped rather than followed, so external
/// content is never pulled into a copy. The recursion depth is capped to
/// prevent stack overflow on pathological or self-referential trees.
/// </summary>
internal static class DirectoryCopy
{
    /// <summary>
    /// Maximum recursion depth permitted for <see cref="CopyDirectory"/>. A
    /// copy that recurses this many levels deep is treated as a pathological or
    /// self-referential tree and aborted with <see cref="IOException"/> to
    /// guard against stack overflow.
    /// </summary>
    private const int MaxCopyDepth = 32;

    /// <summary>
    /// Recursively copies a directory tree, preserving structure. Existing
    /// files are not overwritten. The recursion is bounded by
    /// <see cref="MaxCopyDepth"/>: each nested directory increments
    /// <paramref name="depth"/> by one, and once it reaches the limit the copy
    /// is aborted with <see cref="IOException"/> to prevent stack overflow on
    /// pathological or self-referential trees. Reparse points among the source
    /// files and subdirectories are skipped: a link may target a location
    /// outside the home sandbox, and following it would copy content from
    /// beyond the root. Such entries are not reproduced in the destination.
    /// </summary>
    /// <param name="source">Absolute path to the directory to copy from.</param>
    /// <param name="destination">Absolute path to the directory to copy into.</param>
    /// <param name="depth">Current recursion depth, seeded at zero by the
    /// caller that initiates a copy.</param>
    public static void CopyDirectory(string source, string destination, int depth)
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
            if (FileSystemHelpers.IsReparsePoint(new FileInfo(file)))
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
            if (FileSystemHelpers.IsReparsePoint(new DirectoryInfo(directory)))
            {
                continue;
            }

            CopyDirectory(directory, Path.Combine(destination, Path.GetFileName(directory)), depth + 1);
        }
    }
}

namespace TestProject.Services;

/// <summary>
/// Recursion-bounded directory tree copying. Existing files are never
/// overwritten (matching <see cref="File.Copy(string, string, bool)"/>), and
/// reparse points (symbolic links / junctions) are skipped rather than
/// followed, so external content is never pulled into a copy (a link may
/// target a location outside the home sandbox). Recursion depth is capped to
/// prevent stack overflow on self-referential trees.
/// </summary>
internal static class DirectoryCopy
{
    /// <summary>Maximum recursion depth; exceeding it aborts with
    /// <see cref="IOException"/> to guard against pathological or cyclic trees.</summary>
    private const int MaxCopyDepth = 32;

    /// <summary>
    /// Recursively copies a directory tree, preserving structure without
    /// overwriting existing files. Each nested directory increments
    /// <paramref name="depth"/>; at <see cref="MaxCopyDepth"/> the copy aborts
    /// with <see cref="IOException"/>. Reparse points among the source files
    /// and subdirectories are skipped (see class summary) and not reproduced in
    /// the destination.
    /// </summary>
    /// <param name="source">Absolute path to copy from.</param>
    /// <param name="destination">Absolute path to copy into.</param>
    /// <param name="depth">Current recursion depth, seeded at zero by the caller.</param>
    public static void CopyDirectory(string source, string destination, int depth)
    {
        if (depth >= MaxCopyDepth)
        {
            throw new IOException("Directory copy depth limit exceeded (possible cycle)");
        }

        Directory.CreateDirectory(destination);

        foreach (var file in Directory.GetFiles(source))
        {
            if (FileSystemHelpers.IsReparsePoint(new FileInfo(file)))
            {
                continue;
            }

            File.Copy(file, Path.Combine(destination, Path.GetFileName(file)), overwrite: false);
        }

        foreach (var directory in Directory.GetDirectories(source))
        {
            if (FileSystemHelpers.IsReparsePoint(new DirectoryInfo(directory)))
            {
                continue;
            }

            CopyDirectory(directory, Path.Combine(destination, Path.GetFileName(directory)), depth + 1);
        }
    }
}

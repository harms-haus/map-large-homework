using System.IO;
using System.Reflection;

namespace TestProject.Tests.TestHelpers;

/// <summary>
/// Locates and reads source files that live next to the application project
/// (e.g. <c>Program.cs</c>, <c>Controllers/FilesController.cs</c>,
/// <c>README.md</c>) from within a test running out of the compiled
/// <c>bin/Debug/...</c> output directory.
///
/// <para>
/// The root is discovered by walking up from
/// <see cref="AppContext.BaseDirectory"/> until a directory containing
/// <c>TestProject.csproj</c> is found. A relative path is then resolved
/// against that root. This mirrors the approach already used by
/// <c>ProgramWiringTests.LoadProgramSource</c> but is shared/reusable so
/// security wiring tests, controller doc-comment tests and README tests do
/// not each reimplement the directory walk.
/// </para>
/// </summary>
public static class SourceFileLoader
{
    /// <summary>
    /// Returns the directory containing <c>TestProject.csproj</c>, found by
    /// walking up from the test assembly's output directory. Throws if it
    /// cannot be located.
    /// </summary>
    public static string FindProjectRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            if (File.Exists(Path.Combine(dir.FullName, "TestProject.csproj")))
            {
                return dir.FullName;
            }

            dir = dir.Parent;
        }

        throw new FileNotFoundException(
            "Could not locate the project root (folder containing TestProject.csproj) " +
            "by walking up from the test output directory (" + AppContext.BaseDirectory + ").");
    }

    /// <summary>
    /// Loads the source file at <paramref name="relativeSegments"/> relative
    /// to the project root (the folder containing <c>TestProject.csproj</c>).
    /// Throws with a descriptive message if the file is not found.
    /// </summary>
    /// <param name="relativeSegments">
    /// The path parts under the project root, e.g.
    /// <c>("Controllers", "FilesController.cs")</c> or
    /// <c>("Program.cs",)</c> or <c>("README.md",)</c>.</param>
    public static string LoadAdjacent(params string[] relativeSegments)
    {
        var root = FindProjectRoot();
        var fullPath = Path.Combine(root, Path.Combine(relativeSegments));

        if (!File.Exists(fullPath))
        {
            throw new FileNotFoundException(
                $"Expected source file not found at '{fullPath}' (resolved from project " +
                $"root '{root}').", fullPath);
        }

        return File.ReadAllText(fullPath);
    }
}

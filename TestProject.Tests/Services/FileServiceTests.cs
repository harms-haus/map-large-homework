using System.Collections.Concurrent;
using System.Text;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Options;
using TestProject.Configuration;
using TestProject.Models;
using TestProject.Services;
using TestProject.Tests.TestHelpers;
using Xunit;

namespace TestProject.Tests.Services;

/// <summary>
/// Functional tests for <see cref="FileService"/>. Each test runs against a
/// unique temporary content root so that tests are fully independent and
/// never touch the real file system outside a scratch directory.
///
/// The service computes its home root once, at construction time, as
/// <c>Path.GetFullPath(Path.Combine(env.ContentRootPath, options.HomeDirectory))</c>.
/// Directory creation is deferred (lazy) until first use, so these tests
/// trigger an operation before asserting the directory exists on disk. Every
/// operation must funnel inputs through a path-safety check so that paths
/// escaping the home root throw <see cref="ArgumentException"/>.
/// </summary>
public class FileServiceTests : IDisposable
{
    private readonly string _contentRoot;

    public FileServiceTests()
    {
        _contentRoot = Directory.CreateTempSubdirectory("fs_test_").FullName;
    }

    public void Dispose()
    {
        try
        {
            Directory.Delete(_contentRoot, recursive: true);
        }
        catch
        {
            // Best effort cleanup; temp dirs may already be gone.
        }
    }

    // Builds a fresh service whose home directory lives under the per-test
    // content root. Returns the absolute, normalized root the service should
    // be treating as its sandbox.
    private (FileService service, string root) CreateService(string homeDirectory = "Home")
    {
        var env = new FakeWebHostEnvironment
        {
            ContentRootPath = _contentRoot
        };
        var options = Options.Create(new FileServiceOptions
        {
            HomeDirectory = homeDirectory
        });

        var service = new FileService(options, env);
        var root = Path.GetFullPath(Path.Combine(_contentRoot, homeDirectory));
        return (service, root);
    }

    // Builds the directory chain {baseDir}/d1/d2/.../d{levels}, creating every
    // intermediate directory along the way, and returns the deepest directory
    // path. `levels` is the number of nested directories beneath baseDir, so a
    // copy of baseDir recurses to depth == levels.
    private static string CreateNestedChain(string baseDir, int levels)
    {
        var current = baseDir;
        for (var i = 1; i <= levels; i++)
        {
            current = Path.Combine(current, $"d{i}");
        }
        Directory.CreateDirectory(current);
        return current;
    }

    // Creates a directory symbolic link, returning false when the host cannot
    // create one (e.g. Windows without the SeCreateSymbolicLinkPrivilege), so
    // the reparse-point-skipping tests can opt out cleanly instead of failing.
    private static bool TryCreateDirectorySymlink(string linkPath, string target)
    {
        try
        {
            return Directory.CreateSymbolicLink(linkPath, target) is not null;
        }
        catch (IOException) { return false; }
        catch (UnauthorizedAccessException) { return false; }
        catch (PlatformNotSupportedException) { return false; }
    }

    // File-symlink counterpart of TryCreateDirectorySymlink.
    private static bool TryCreateFileSymlink(string linkPath, string target)
    {
        try
        {
            return File.CreateSymbolicLink(linkPath, target) is not null;
        }
        catch (IOException) { return false; }
        catch (UnauthorizedAccessException) { return false; }
        catch (PlatformNotSupportedException) { return false; }
    }

    // =====================================================================
    // Constructor / root computation
    // =====================================================================

    [Fact]
    public void Constructor_CreatesRootDirectory_WhenItDoesNotExist()
    {
        var home = "BrandNewHome";
        var expectedRoot = Path.GetFullPath(Path.Combine(_contentRoot, home));

        Assert.False(Directory.Exists(expectedRoot));

        var (service, root) = CreateService(home);

        // Root creation is lazy: it happens on first use, not in the
        // constructor. Trigger initialization before asserting existence.
        service.ResolveFullPath("");

        Assert.True(Directory.Exists(root));
        Assert.Equal(expectedRoot, root);
    }

    [Fact]
    public void Constructor_SupportsNestedHomeDirectoryPath()
    {
        var home = "Data/Files";
        var expectedRoot = Path.GetFullPath(Path.Combine(_contentRoot, home));

        Assert.False(Directory.Exists(expectedRoot));

        var (service, root) = CreateService(home);

        // Root creation is lazy: trigger initialization (which must create
        // the full nested path) before asserting existence.
        service.ResolveFullPath("");

        Assert.Equal(expectedRoot, root);
        Assert.True(Directory.Exists(root));
    }

    [Fact]
    public void Constructor_NullHomeDirectory_DefaultsToHome()
    {
        var env = new FakeWebHostEnvironment { ContentRootPath = _contentRoot };
        var options = Options.Create(new FileServiceOptions { HomeDirectory = null! });

        var service = new FileService(options, env);

        var expected = Path.GetFullPath(Path.Combine(_contentRoot, "Home"));
        // ResolveFullPath triggers lazy initialization, materializing the
        // default "Home" directory before we assert its existence.
        Assert.Equal(expected, service.ResolveFullPath(""));
        Assert.True(Directory.Exists(expected));
    }

    // =====================================================================
    // Lazy initialization of the home root
    //
    // Two complementary flavors of test live here:
    //   1. The *negative* (lazy-specific) characterization below — the home
    //      directory must NOT exist on disk immediately after construction.
    //      Root creation is deferred to first use via the lazy value factory,
    //      matching the README's Configuration section ("created automatically
    //      on first use (lazily), ... so a misconfigured path surfaces on the
    //      first request rather than at startup").
    //   2. The *positive* (agnostic) characterization further down — the
    //      directory MUST exist after the first operation.
    // =====================================================================

    /// <summary>
    /// The home directory must NOT be materialized by the constructor. Root
    /// creation is deferred to first use via the lazy value factory, so
    /// constructing the service — equivalent to DI resolution at startup —
    /// has no filesystem side effects. This is the negative half of the lazy
    /// contract.
    /// </summary>
    [Fact]
    public void Constructor_DoesNotCreateRootDirectory_BeforeFirstUse()
    {
        var home = "EagerCheckFlat";
        var expectedRoot = Path.GetFullPath(Path.Combine(_contentRoot, home));

        Assert.False(Directory.Exists(expectedRoot));

        var (service, _) = CreateService(home);

        // No file-system operation has been invoked yet, so the home root
        // must not exist on disk. Constructing the service alone must not
        // touch the disk.
        Assert.False(Directory.Exists(expectedRoot));

        // Sanity check that the same root DOES get created on first use, so
        // this test cannot pass vacuously (e.g. due to an uncreatable path).
        service.ResolveFullPath("");
        Assert.True(Directory.Exists(expectedRoot));
    }

    /// <summary>
    /// A nested home directory (e.g. <c>"Data/Files"</c>) must not have any of
    /// its ancestor segments created by the constructor either. Lazy
    /// creation means neither the intermediate <c>Data</c> directory nor the
    /// leaf <c>Data/Files</c> exists until the first operation targets the
    /// root.
    /// </summary>
    [Fact]
    public void Constructor_DoesNotCreateNestedHomeDirectory_BeforeFirstUse()
    {
        var home = "EagerCheckNested/Deep";
        var parentSegment = Path.GetFullPath(Path.Combine(_contentRoot, "EagerCheckNested"));
        var expectedRoot = Path.GetFullPath(Path.Combine(_contentRoot, home));

        Assert.False(Directory.Exists(parentSegment));
        Assert.False(Directory.Exists(expectedRoot));

        var (service, _) = CreateService(home);

        // Neither the intermediate nor the leaf directory should exist yet.
        Assert.False(Directory.Exists(parentSegment));
        Assert.False(Directory.Exists(expectedRoot));

        // First use materializes the entire nested chain in one step.
        service.ResolveFullPath("");
        Assert.True(Directory.Exists(parentSegment));
        Assert.True(Directory.Exists(expectedRoot));
    }

    /// <summary>
    /// A misconfigured home directory (here, one containing an illegal null
    /// character) must NOT surface at construction time. The path is only
    /// resolved inside the lazy value factory, so the error is deferred to
    /// the first file-system operation that touches <c>Root</c>. The null
    /// byte is the only invalid-path character that
    /// <see cref="Path.GetFullPath"/> rejects on every platform (on Linux,
    /// characters like <c>&lt;&gt;</c> and <c>:</c> are legal), so it is used
    /// for cross-platform determinism.
    /// </summary>
    [Fact]
    public void Constructor_MisconfiguredHomeDirectory_DoesNotThrowUntilFirstUse()
    {
        var env = new FakeWebHostEnvironment { ContentRootPath = _contentRoot };
        var options = Options.Create(new FileServiceOptions { HomeDirectory = "bad\0path" });

        // Construction must succeed: the bad path has not been resolved yet.
        var service = new FileService(options, env);
        Assert.NotNull(service);

        // The misconfiguration surfaces on first use, not at startup / DI
        // resolution.
        Assert.Throws<ArgumentException>(() => service.ResolveFullPath(""));
    }

    /// <summary>
    /// With lazy initialization, every public entry point that resolves a
    /// path must materialize the home directory on first use.
    /// </summary>
    [Theory]
    [InlineData("Resolve")]
    [InlineData("Browse")]
    [InlineData("Search")]
    public void LazyInit_CreatesRootDirectory_OnFirstMethodCall(string entryPoint)
    {
        var (service, root) = CreateService($"LazyHome_{entryPoint}");

        switch (entryPoint)
        {
            case "Resolve":
                service.ResolveFullPath("");
                break;
            case "Browse":
                service.Browse("");
                break;
            case "Search":
                service.Search("anything", "");
                break;
            default:
                throw new ArgumentException($"Unknown entry point: {entryPoint}");
        }

        Assert.True(Directory.Exists(root));
    }

    [Fact]
    public void LazyInit_IsSafe_UnderConcurrentFirstAccess()
    {
        var (service, root) = CreateService();

        // Hammer the first-access path from many threads at once. With
        // LazyThreadSafetyMode.ExecutionAndPublication the value factory must
        // run exactly once and no caller should observe an exception.
        var exceptions = new ConcurrentQueue<Exception>();

        Parallel.For(0, 32, _ =>
        {
            try
            {
                service.Browse("");
            }
            catch (Exception ex)
            {
                exceptions.Enqueue(ex);
            }
        });

        Assert.Empty(exceptions);
        Assert.True(Directory.Exists(root));
    }

    [Fact]
    public void Constructor_NormalizesHomeDirectory_ToFullPath()
    {
        // A home directory containing a redundant "." segment must normalize
        // (via Path.GetFullPath) to the same root as the clean path.
        var (service, _) = CreateService("Data/./Files");
        var expected = Path.GetFullPath(Path.Combine(_contentRoot, "Data", "Files"));

        Assert.Equal(expected, service.ResolveFullPath(""));
    }

    // =====================================================================
    // ResolveFullPath
    // =====================================================================

    [Fact]
    public void ResolveFullPath_Empty_ReturnsRoot()
    {
        var (service, root) = CreateService();

        Assert.Equal(root, service.ResolveFullPath(""));
    }

    [Fact]
    public void ResolveFullPath_Null_ReturnsRoot()
    {
        var (service, root) = CreateService();

        Assert.Equal(root, service.ResolveFullPath(null!));
    }

    [Fact]
    public void ResolveFullPath_Whitespace_ReturnsRoot()
    {
        var (service, root) = CreateService();

        Assert.Equal(root, service.ResolveFullPath("   "));
    }

    [Fact]
    public void ResolveFullPath_RelativePath_CombinesWithRoot()
    {
        var (service, root) = CreateService();

        var resolved = service.ResolveFullPath(Path.Combine("docs", "a.txt"));

        Assert.Equal(Path.GetFullPath(Path.Combine(root, "docs", "a.txt")), resolved);
        Assert.StartsWith(root + Path.DirectorySeparatorChar, resolved);
    }

    [Theory]
    [InlineData("../escape")]
    [InlineData("../../escape")]
    [InlineData("/etc/passwd")]
    public void ResolveFullPath_PathOutsideRoot_ThrowsArgumentException(string path)
    {
        var (service, _) = CreateService();

        var ex = Assert.Throws<ArgumentException>(() => service.ResolveFullPath(path));
        Assert.Equal("Invalid path", ex.Message);
    }

    [Fact]
    public void ResolveFullPath_DotDotThatStaysInsideRoot_Resolves()
    {
        var (service, root) = CreateService();
        Directory.CreateDirectory(Path.Combine(root, "docs"));

        // "docs/../a.txt" normalizes back inside the root and must be allowed.
        var resolved = service.ResolveFullPath("docs/../a.txt");

        Assert.Equal(Path.GetFullPath(Path.Combine(root, "a.txt")), resolved);
    }

    // =====================================================================
    // Browse
    // =====================================================================

    [Fact]
    public async Task Browse_Root_ReturnsDirectoriesFirstThenFiles_SortedOrdinalIgnoreCase()
    {
        var (service, root) = CreateService();
        Directory.CreateDirectory(Path.Combine(root, "images"));
        Directory.CreateDirectory(Path.Combine(root, "docs"));
        await File.WriteAllTextAsync(Path.Combine(root, "z.txt"), "ZZ");
        await File.WriteAllTextAsync(Path.Combine(root, "a.txt"), "AAA");

        var result = service.Browse("");

        Assert.Equal("", result.Path);
        Assert.Null(result.Parent);
        Assert.Equal(2, result.FolderCount);
        Assert.Equal(2, result.FileCount);
        Assert.Equal(5L, result.TotalSize);

        Assert.Equal(new[] { "docs", "images", "a.txt", "z.txt" },
            result.Entries.Select(e => e.Name).ToArray());
        Assert.Equal(new[] { true, true, false, false },
            result.Entries.Select(e => e.IsDirectory).ToArray());
    }

    [Fact]
    public async Task Browse_EntryPaths_UseForwardSlashes_AndCorrectMetadata()
    {
        var (service, root) = CreateService();
        Directory.CreateDirectory(Path.Combine(root, "docs"));
        var filePath = Path.Combine(root, "a.txt");
        await File.WriteAllTextAsync(filePath, "hello");

        var result = service.Browse("");

        var file = result.Entries.Single(e => e.Name == "a.txt");
        Assert.Equal("a.txt", file.Path);
        Assert.False(file.IsDirectory);
        Assert.Equal(5L, file.Size);
        Assert.Equal(new FileInfo(filePath).LastWriteTimeUtc, file.LastModified);

        var dir = result.Entries.Single(e => e.Name == "docs");
        Assert.Equal("docs", dir.Path);
        Assert.True(dir.IsDirectory);
        Assert.Equal(0L, dir.Size);
    }

    [Fact]
    public async Task Browse_Subdirectory_ReturnsRelativePathAndEmptyParent()
    {
        var (service, root) = CreateService();
        Directory.CreateDirectory(Path.Combine(root, "docs", "deep"));
        await File.WriteAllTextAsync(Path.Combine(root, "docs", "a.txt"), "x");

        var result = service.Browse("docs");

        Assert.Equal("docs", result.Path);
        Assert.Equal("", result.Parent); // parent of "docs" is root -> ""
        Assert.Equal("docs/deep", result.Entries.Single(e => e.Name == "deep").Path);
        Assert.Equal("docs/a.txt", result.Entries.Single(e => e.Name == "a.txt").Path);
    }

    [Fact]
    public void Browse_DeepSubdirectory_ParentIsRelativeParentPath()
    {
        var (service, root) = CreateService();
        Directory.CreateDirectory(Path.Combine(root, "docs", "deep"));

        var result = service.Browse("docs/deep");

        Assert.Equal("docs/deep", result.Path);
        Assert.Equal("docs", result.Parent);
    }

    [Fact]
    public async Task Browse_CountsAndSize_AreFromCurrentDirectoryOnly()
    {
        var (service, root) = CreateService();
        Directory.CreateDirectory(Path.Combine(root, "sub", "nested")); // nested must not count
        await File.WriteAllTextAsync(Path.Combine(root, "a.txt"), "12"); // size 2
        await File.WriteAllTextAsync(Path.Combine(root, "sub", "b.txt"), "xxxxx"); // excluded

        var result = service.Browse("");

        Assert.Equal(1, result.FolderCount);
        Assert.Equal(1, result.FileCount);
        Assert.Equal(2L, result.TotalSize);
    }

    [Fact]
    public void Browse_NonExistentDirectory_ThrowsDirectoryNotFoundException()
    {
        var (service, _) = CreateService();

        Assert.Throws<DirectoryNotFoundException>(() => service.Browse("does-not-exist"));
    }

    [Fact]
    public void Browse_PathEscapingRoot_ThrowsArgumentException()
    {
        var (service, _) = CreateService();

        Assert.Throws<ArgumentException>(() => service.Browse("../escape"));
    }

    // ---------------------------------------------------------------------
    // Additional characterization tests for Browse. These pin down the exact
    // observable output contract of the directory enumeration: ordering,
    // per-entry metadata, and aggregations.
    // ---------------------------------------------------------------------

    [Fact]
    public void Browse_EmptyDirectory_ReturnsNoEntries_AndZeroAggregates()
    {
        var (service, _) = CreateService();

        // The home root is materialized lazily by Browse itself and contains
        // nothing. A single-pass enumerator over an empty directory must
        // yield zero entries, not throw, and leave all aggregates at zero.
        var result = service.Browse("");

        Assert.Empty(result.Entries);
        Assert.Equal(0, result.FolderCount);
        Assert.Equal(0, result.FileCount);
        Assert.Equal(0L, result.TotalSize);
        Assert.Equal("", result.Path);
        Assert.Null(result.Parent);
    }

    [Fact]
    public async Task Browse_DirectoryWithOnlyFiles_SortsByName_WithZeroFolderCount()
    {
        var (service, root) = CreateService();
        service.ResolveFullPath(""); // materialize the lazily-created home root
        await File.WriteAllTextAsync(Path.Combine(root, "c.txt"), "c");
        await File.WriteAllTextAsync(Path.Combine(root, "a.txt"), "aaa");
        await File.WriteAllTextAsync(Path.Combine(root, "b.txt"), "bb");

        var result = service.Browse("");

        Assert.Equal(0, result.FolderCount);
        Assert.Equal(3, result.FileCount);
        Assert.Equal(6L, result.TotalSize); // 1 + 3 + 2
        Assert.Equal(new[] { "a.txt", "b.txt", "c.txt" },
            result.Entries.Select(e => e.Name).ToArray());
        Assert.All(result.Entries, e => Assert.False(e.IsDirectory));
    }

    [Fact]
    public void Browse_DirectoryWithOnlySubdirectories_SortsByName_WithZeroFileCountAndSize()
    {
        var (service, root) = CreateService();
        Directory.CreateDirectory(Path.Combine(root, "beta"));
        Directory.CreateDirectory(Path.Combine(root, "Gamma"));
        Directory.CreateDirectory(Path.Combine(root, "alpha"));

        var result = service.Browse("");

        Assert.Equal(3, result.FolderCount);
        Assert.Equal(0, result.FileCount);
        Assert.Equal(0L, result.TotalSize);
        // OrdinalIgnoreCase: 'a' (97) < 'b' (98) < 'G'->'g' (103).
        Assert.Equal(new[] { "alpha", "beta", "Gamma" },
            result.Entries.Select(e => e.Name).ToArray());
        Assert.All(result.Entries, e => Assert.True(e.IsDirectory));
        Assert.All(result.Entries, e => Assert.Equal(0L, e.Size));
    }

    [Fact]
    public async Task Browse_SortsEntries_OrdinalIgnoreCase_MixedCaseNames()
    {
        var (service, root) = CreateService();
        service.ResolveFullPath(""); // materialize the lazily-created home root
        await File.WriteAllTextAsync(Path.Combine(root, "C.txt"), "x");
        await File.WriteAllTextAsync(Path.Combine(root, "a.txt"), "x");
        await File.WriteAllTextAsync(Path.Combine(root, "B.txt"), "x");

        var result = service.Browse("");

        // All files; OrdinalIgnoreCase treats uppercase and lowercase as
        // equal, so the order is a.txt, B.txt, C.txt regardless of input
        // casing.
        Assert.Equal(new[] { "a.txt", "B.txt", "C.txt" },
            result.Entries.Select(e => e.Name).ToArray());
    }

    [Fact]
    public async Task Browse_ZeroByteFile_ReportsSizeZero()
    {
        var (service, root) = CreateService();
        service.ResolveFullPath(""); // materialize the lazily-created home root
        await File.WriteAllTextAsync(Path.Combine(root, "empty.txt"), "");

        var result = service.Browse("");

        var file = result.Entries.Single(e => e.Name == "empty.txt");
        Assert.False(file.IsDirectory);
        Assert.Equal(0L, file.Size);
        Assert.Equal(1, result.FileCount);
        Assert.Equal(0L, result.TotalSize);
    }

    [Fact]
    public async Task Browse_PreservesEntryNames_AndPaths_ForSpacesDotsAndNoExtension()
    {
        var (service, root) = CreateService();
        service.ResolveFullPath(""); // materialize the lazily-created home root
        await File.WriteAllTextAsync(Path.Combine(root, "file.with.dots.txt"), "x");
        await File.WriteAllTextAsync(Path.Combine(root, "file with spaces.txt"), "x");
        await File.WriteAllTextAsync(Path.Combine(root, "no_extension"), "x");

        var result = service.Browse("");

        // space (32) sorts before '.' (46); both start with 'f' which sorts
        // before 'n' (110).
        Assert.Equal(
            new[] { "file with spaces.txt", "file.with.dots.txt", "no_extension" },
            result.Entries.Select(e => e.Name).ToArray());
        Assert.Equal("file.with.dots.txt",
            result.Entries.Single(e => e.Name == "file.with.dots.txt").Path);
        Assert.Equal("file with spaces.txt",
            result.Entries.Single(e => e.Name == "file with spaces.txt").Path);
        Assert.Equal("no_extension",
            result.Entries.Single(e => e.Name == "no_extension").Path);
    }

    [Fact]
    public async Task Browse_TotalSize_SumsAllCurrentDirectoryFileSizes()
    {
        var (service, root) = CreateService();
        Directory.CreateDirectory(Path.Combine(root, "subdir")); // contributes 0 to size
        await File.WriteAllTextAsync(Path.Combine(root, "a.txt"), new string('a', 100));
        await File.WriteAllTextAsync(Path.Combine(root, "b.txt"), new string('b', 50));
        await File.WriteAllTextAsync(Path.Combine(root, "c.txt"), new string('c', 25));

        var result = service.Browse("");

        // Confirms the sum is computed across every file in the directory,
        // not just the first/last, and that directories contribute nothing.
        Assert.Equal(175L, result.TotalSize);
        Assert.Equal(3, result.FileCount);
        Assert.Equal(1, result.FolderCount);
    }

    [Fact]
    public async Task Browse_WhitespacePath_ResolvesToRootListing()
    {
        var (service, root) = CreateService();
        Directory.CreateDirectory(Path.Combine(root, "docs"));
        await File.WriteAllTextAsync(Path.Combine(root, "a.txt"), "x");

        var result = service.Browse("   ");

        Assert.Equal("", result.Path);
        Assert.Null(result.Parent);
        Assert.Equal(1, result.FolderCount);
        Assert.Equal(1, result.FileCount);
        Assert.Equal(new[] { "docs", "a.txt" },
            result.Entries.Select(e => e.Name).ToArray());
    }

    [Fact]
    public async Task Browse_MixedDirsAndFiles_AlwaysPlacesAllDirectoriesBeforeAllFiles()
    {
        var (service, root) = CreateService();
        // Names chosen so that an alphabetical (name-only) sort would
        // interleave files and directories; the contract requires dirs first.
        Directory.CreateDirectory(Path.Combine(root, "z_dir"));
        Directory.CreateDirectory(Path.Combine(root, "a_dir"));
        await File.WriteAllTextAsync(Path.Combine(root, "m_file.txt"), "x");
        await File.WriteAllTextAsync(Path.Combine(root, "b_file.txt"), "x");

        var result = service.Browse("");

        Assert.Equal(
            new[] { "a_dir", "z_dir", "b_file.txt", "m_file.txt" },
            result.Entries.Select(e => e.Name).ToArray());
        Assert.Equal(new[] { true, true, false, false },
            result.Entries.Select(e => e.IsDirectory).ToArray());
        Assert.Equal(2, result.FolderCount);
        Assert.Equal(2, result.FileCount);
    }

    // ---------------------------------------------------------------------
    // Directory ItemCount (Size column): each directory entry carries the
    // count of its IMMEDIATE children (files + folders). Nested contents
    // below a subdirectory are NOT counted, files always report 0, and an
    // empty directory reports 0. This drives the directory Size column.
    // ---------------------------------------------------------------------

    [Fact]
    public async Task Browse_DirectoryItemCount_CountsImmediateFilesAndFolders_ExcludingNested()
    {
        var (service, root) = CreateService();
        // 'parent' will contain 2 files + 1 subfolder = 3 immediate children.
        Directory.CreateDirectory(Path.Combine(root, "parent", "child"));
        await File.WriteAllTextAsync(Path.Combine(root, "parent", "a.txt"), "x");
        await File.WriteAllTextAsync(Path.Combine(root, "parent", "b.txt"), "x");
        // Files inside the subfolder must NOT contribute to parent's count.
        await File.WriteAllTextAsync(Path.Combine(root, "parent", "child", "deep.txt"), "x");

        var result = service.Browse("");

        var parent = result.Entries.Single(e => e.Name == "parent");
        Assert.True(parent.IsDirectory);
        Assert.Equal(3, parent.ItemCount); // 2 files + 1 folder; nested file excluded
    }

    [Fact]
    public void Browse_EmptyDirectory_ItemCountIsZero()
    {
        var (service, root) = CreateService();
        Directory.CreateDirectory(Path.Combine(root, "empty"));

        var result = service.Browse("");

        var empty = result.Entries.Single(e => e.Name == "empty");
        Assert.True(empty.IsDirectory);
        Assert.Equal(0, empty.ItemCount);
    }

    [Fact]
    public async Task Browse_FileEntries_ItemCountIsAlwaysZero()
    {
        var (service, root) = CreateService();
        // Materialize the lazily-created home root so the file can be written.
        service.ResolveFullPath("");
        await File.WriteAllTextAsync(Path.Combine(root, "a.txt"), "x");

        var result = service.Browse("");

        var file = result.Entries.Single(e => e.Name == "a.txt");
        Assert.False(file.IsDirectory);
        Assert.Equal(0, file.ItemCount);
    }

    // ---------------------------------------------------------------------
    // Characterization tests for parent-path computation (the private static
    // ComputeParent helper, reachable only through Browse). These pin down
    // the Parent field across every path depth:
    //   - root (empty/whitespace)            -> null
    //   - single segment ("docs")            -> ""   (direct child of root)
    //   - two segments ("docs/reports")      -> "docs"
    //   - three+ segments ("a/b/c")          -> "a/b"
    // The 3+ segment cases and the special-character segment cases below are
    // the most sensitive to how ComputeParent splits the path.
    // ---------------------------------------------------------------------

    [Fact]
    public void Browse_ThreeSegmentPath_ParentIsTwoSegmentPath()
    {
        var (service, root) = CreateService();
        Directory.CreateDirectory(Path.Combine(root, "docs", "reports", "2024"));

        var result = service.Browse("docs/reports/2024");

        Assert.Equal("docs/reports/2024", result.Path);
        Assert.Equal("docs/reports", result.Parent);
    }

    [Fact]
    public async Task Browse_FourSegmentPath_ParentIsThreeSegmentPath()
    {
        var (service, root) = CreateService();
        Directory.CreateDirectory(Path.Combine(root, "a", "b", "c", "d"));
        await File.WriteAllTextAsync(Path.Combine(root, "a", "b", "c", "d", "file.txt"), "x");

        var result = service.Browse("a/b/c/d");

        Assert.Equal("a/b/c/d", result.Path);
        Assert.Equal("a/b/c", result.Parent);
    }

    [Fact]
    public void Browse_ParentSegmentContainingDots_IsPreservedVerbatim()
    {
        // Segment names may legitimately contain dots (e.g. version
        // directories). The parent computation must return the whole leading
        // segment, not truncate at a "." as if it were a file extension.
        var (service, root) = CreateService();
        Directory.CreateDirectory(Path.Combine(root, "v1.2", "release"));

        var result = service.Browse("v1.2/release");

        Assert.Equal("v1.2/release", result.Path);
        Assert.Equal("v1.2", result.Parent);
    }

    [Fact]
    public void Browse_ParentSegmentContainingSpaces_IsPreservedVerbatim()
    {
        // Whitespace inside a segment name must not be treated as a delimiter
        // or trimmed; the leading segment is returned verbatim.
        var (service, root) = CreateService();
        Directory.CreateDirectory(Path.Combine(root, "my docs", "notes"));

        var result = service.Browse("my docs/notes");

        Assert.Equal("my docs/notes", result.Path);
        Assert.Equal("my docs", result.Parent);
    }

    // =====================================================================
    // Search
    // =====================================================================

    [Fact]
    public async Task Search_FindsMatchingEntriesByName_OrdinalIgnoreCase_AndRecursively()
    {
        var (service, root) = CreateService();
        Directory.CreateDirectory(Path.Combine(root, "docs"));
        await File.WriteAllTextAsync(Path.Combine(root, "Report.txt"), "x");
        await File.WriteAllTextAsync(Path.Combine(root, "docs", "weekly-report.md"), "x");
        await File.WriteAllTextAsync(Path.Combine(root, "notes.txt"), "x");

        var result = service.Search("report", "");

        Assert.Equal("report", result.Query);
        Assert.Equal("", result.Path);
        Assert.Equal(2, result.Results.Count);
        Assert.Contains(result.Results, r => r.Path == "Report.txt");
        Assert.Contains(result.Results, r => r.Path == "docs/weekly-report.md");
        Assert.DoesNotContain(result.Results, r => r.Name == "notes.txt");
    }

    [Fact]
    public async Task Search_DirectoryResult_ItemCountReflectsImmediateChildren()
    {
        // A directory that matches the query carries the count of its
        // immediate children (files + folders), exactly like Browse entries —
        // the Size column contract is shared across browse and search rows.
        var (service, root) = CreateService();
        // 'matchdir' holds 2 files + 1 subfolder = 3 immediate children.
        Directory.CreateDirectory(Path.Combine(root, "matchdir", "inner"));
        await File.WriteAllTextAsync(Path.Combine(root, "matchdir", "a.txt"), "x");
        await File.WriteAllTextAsync(Path.Combine(root, "matchdir", "b.txt"), "x");
        await File.WriteAllTextAsync(Path.Combine(root, "matchdir", "inner", "deep.txt"), "x");

        var result = service.Search("matchdir", "");

        var dir = result.Results.Single(r => r.Name == "matchdir");
        Assert.True(dir.IsDirectory);
        Assert.Equal(3, dir.ItemCount); // nested file excluded
    }

    [Fact]
    public async Task Search_LimitsResults_ToGivenRelativePath()
    {
        var (service, root) = CreateService();
        Directory.CreateDirectory(Path.Combine(root, "a"));
        Directory.CreateDirectory(Path.Combine(root, "b"));
        await File.WriteAllTextAsync(Path.Combine(root, "a", "target.txt"), "x");
        await File.WriteAllTextAsync(Path.Combine(root, "b", "target.txt"), "x");

        var result = service.Search("target", "a");

        Assert.Equal("a", result.Path);
        Assert.Single(result.Results);
        Assert.Equal("a/target.txt", result.Results[0].Path);
    }

    [Fact]
    public async Task Search_CapsResultsAtFiveHundred()
    {
        var (service, root) = CreateService();
        // Materialize the lazily-created home root so fixtures can be written into it.
        service.ResolveFullPath("");
        for (var i = 0; i < 550; i++)
        {
            await File.WriteAllTextAsync(Path.Combine(root, $"match-{i:D3}.txt"), "");
        }
        await File.WriteAllTextAsync(Path.Combine(root, "nomatch.txt"), "");

        var result = service.Search("match", "");

        Assert.Equal(500, result.Results.Count);
        Assert.All(result.Results, r => Assert.Contains("match", r.Name));
    }

    [Fact]
    public void Search_PathEscapingRoot_ThrowsArgumentException()
    {
        var (service, _) = CreateService();

        Assert.Throws<ArgumentException>(() => service.Search("x", "../escape"));
    }

    [Fact]
    public async Task Search_DoesNotDescendIntoDirectorySymlinks()
    {
        var (service, root) = CreateService();
        service.ResolveFullPath("");

        // A directory that lives inside the content root but OUTSIDE the home
        // sandbox root. If Search followed the symlink it would find this file
        // (a sandbox escape); the reparse-point guard must prevent that.
        var externalDir = Path.Combine(_contentRoot, "external_" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(externalDir);
        await File.WriteAllTextAsync(Path.Combine(externalDir, "leakmatch.txt"), "x");

        var linkPath = Path.Combine(root, "link");
        if (!TryCreateDirectorySymlink(linkPath, externalDir))
        {
            return; // symbolic links unavailable on this host
        }

        var result = service.Search("leakmatch", "");

        Assert.DoesNotContain(result.Results, r => r.Name == "leakmatch.txt");
    }

    // =====================================================================
    // UploadAsync
    // =====================================================================

    [Fact]
    public async Task UploadAsync_WritesFileContent_ToResolvedDirectory()
    {
        var (service, root) = CreateService();
        var file = FormFileFactory.CreateFormFile("upload.txt", "file-content");

        await service.UploadAsync("", file);

        var written = await File.ReadAllTextAsync(Path.Combine(root, "upload.txt"));
        Assert.Equal("file-content", written);
    }

    [Fact]
    public async Task UploadAsync_CreatesTargetDirectory_WhenMissing()
    {
        var (service, root) = CreateService();
        var file = FormFileFactory.CreateFormFile("file.txt", "data");

        await service.UploadAsync("newdir", file);

        Assert.True(File.Exists(Path.Combine(root, "newdir", "file.txt")));
        Assert.Equal("data", await File.ReadAllTextAsync(Path.Combine(root, "newdir", "file.txt")));
    }

    [Fact]
    public async Task UploadAsync_PathEscapingRoot_ThrowsArgumentException()
    {
        var (service, _) = CreateService();
        var file = FormFileFactory.CreateFormFile("a.txt", "x");

        await Assert.ThrowsAsync<ArgumentException>(() => service.UploadAsync("../escape", file));
    }

    // ---------------------------------------------------------------------
    // File-name sanitization and validation. The uploaded file name is
    // untrusted input: it must be reduced to a safe final segment (blocking
    // path traversal on both platforms) and rejected when it contains
    // characters illegal on Windows or matches a reserved Windows device
    // name, so an upload accepted on Linux cannot break when deployed to
    // Windows.
    // ---------------------------------------------------------------------

    [Theory]
    [InlineData("../pwned.txt")]
    [InlineData("../../pwned.txt")]
    [InlineData("/pwned.txt")]
    [InlineData("sub/../pwned.txt")]
    [InlineData("sub/../../pwned.txt")]
    [InlineData("..\\pwned.txt")]      // backslash traversal (separator on Windows)
    [InlineData("..\\..\\pwned.txt")]
    [InlineData("docs\\sub\\pwned.txt")]
    public async Task UploadAsync_StripsDirectoryTraversal_FromFileName(string fileName)
    {
        var (service, root) = CreateService();
        var file = FormFileFactory.CreateFormFile(fileName, "payload");

        await service.UploadAsync("", file);

        // Only the final safe segment is stored, inside the root.
        var stored = Path.Combine(root, "pwned.txt");
        Assert.True(File.Exists(stored));
        Assert.Equal("payload", await File.ReadAllTextAsync(stored));

        // And nothing escaped above the root.
        Assert.False(File.Exists(Path.Combine(Directory.GetParent(root)!.FullName, "pwned.txt")));
    }

    [Fact]
    public async Task UploadAsync_PreservesFileName_WhenAlreadySafe()
    {
        var (service, root) = CreateService();
        var file = FormFileFactory.CreateFormFile("report (final)-v2.txt", "x");

        await service.UploadAsync("docs", file);

        Assert.True(File.Exists(Path.Combine(root, "docs", "report (final)-v2.txt")));
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData(".")]
    [InlineData("..")]
    [InlineData("/")]
    [InlineData("\\")]
    [InlineData("///")]
    [InlineData("./")]
    [InlineData("../..")]
    public async Task UploadAsync_RejectsFileName_ThatReducesToEmpty(string fileName)
    {
        var (service, _) = CreateService();
        var file = FormFileFactory.CreateFormFile(fileName, "payload");

        await Assert.ThrowsAsync<ArgumentException>(() => service.UploadAsync("", file));
    }

    [Theory]
    [InlineData("a:b.txt")]     // colon: legal on Linux, illegal on Windows
    [InlineData("a*b.txt")]
    [InlineData("a?b.txt")]
    [InlineData("a\"b.txt")]
    [InlineData("a<b.txt")]
    [InlineData("a>b.txt")]
    [InlineData("a|b.txt")]
    public async Task UploadAsync_RejectsFileName_WithWindowsInvalidCharacters(string fileName)
    {
        var (service, _) = CreateService();
        var file = FormFileFactory.CreateFormFile(fileName, "payload");

        await Assert.ThrowsAsync<ArgumentException>(() => service.UploadAsync("", file));
    }

    [Theory]
    [InlineData("CON")]
    [InlineData("CON.txt")]
    [InlineData("nul.log")]
    [InlineData("PRN")]
    [InlineData("com1.dat")]
    [InlineData("LPT9")]
    public async Task UploadAsync_RejectsReservedWindowsDeviceNames(string fileName)
    {
        var (service, _) = CreateService();
        var file = FormFileFactory.CreateFormFile(fileName, "payload");

        await Assert.ThrowsAsync<ArgumentException>(() => service.UploadAsync("", file));
    }

    // ---------------------------------------------------------------------
    // UploadAsync return value (stored relative path).
    //
    // UploadAsync returns the normalized, forward-slash relative path of the
    // file it actually stored — sourced from the service's own ToRelative
    // helper so the controller no longer needs to reconstruct (and
    // re-normalize) the path client-side. The returned path reflects the
    // SANITIZED file name (traversal stripped, Windows-illegal names rejected)
    // and the real on-disk location, never the raw request input. These tests
    // pin that contract and the round-trip invariant (the returned path
    // resolves back to the file that was just written).
    // ---------------------------------------------------------------------

    [Theory]
    [InlineData("", "report.txt", "report.txt")]
    [InlineData("docs", "report.txt", "docs/report.txt")]
    [InlineData("docs/sub", "report.txt", "docs/sub/report.txt")]
    [InlineData("a/b/c", "report.txt", "a/b/c/report.txt")]
    public async Task UploadAsync_ReturnsStoredRelativePath(string dir, string fileName, string expected)
    {
        var (service, _) = CreateService();
        var file = FormFileFactory.CreateFormFile(fileName, "payload");

        var returned = await service.UploadAsync(dir, file);

        Assert.Equal(expected, returned);
    }

    [Theory]
    [InlineData("docs/", "docs/report.txt")]          // trailing slash collapsed
    [InlineData("docs/./sub", "docs/sub/report.txt")]   // redundant '.' removed
    [InlineData("docs/sub/..", "docs/report.txt")]      // '..' resolved back inside root
    [InlineData("docs/sub/.", "docs/sub/report.txt")]   // trailing '.' removed
    public async Task UploadAsync_ReturnsNormalizedDirectoryPath_WhenAlreadyInsideRoot(string dir, string expected)
    {
        // The directory portion is normalized by SafeResolve (via
        // Path.GetFullPath) before storage, so the returned path is canonical
        // even when the request path carries redundant '.', '..', or trailing
        // slashes — provided the path stays inside the sandbox. (This replaces
        // the controller-side directory normalization that was removed.)
        var (service, _) = CreateService();
        var file = FormFileFactory.CreateFormFile("report.txt", "payload");

        var returned = await service.UploadAsync(dir, file);

        Assert.Equal(expected, returned);
    }

    [Theory]
    [InlineData("../report.txt", "report.txt")]      // traversal stripped to last safe segment
    [InlineData("../../report.txt", "report.txt")]
    [InlineData("/report.txt", "report.txt")]         // leading separator stripped
    public async Task UploadAsync_ReturnedPath_ReflectsSanitizedFileName_NotRawInput(
        string fileName, string expectedFileName)
    {
        // The returned path must carry only the safe final segment the service
        // stored, never the raw (possibly traversal-laden) file name the
        // client submitted. This is the service-side replacement for the old
        // controller-level "strip traversal from file name" contract.
        var (service, _) = CreateService();
        var file = FormFileFactory.CreateFormFile(fileName, "payload");

        var returned = await service.UploadAsync("", file);

        Assert.Equal(expectedFileName, returned);
    }

    [Fact]
    public async Task UploadAsync_ReturnedPath_PreservesSafeFileName()
    {
        var (service, _) = CreateService();
        var file = FormFileFactory.CreateFormFile("report (final)-v2.txt", "x");

        var returned = await service.UploadAsync("docs", file);

        Assert.Equal("docs/report (final)-v2.txt", returned);
    }

    [Fact]
    public async Task UploadAsync_ReturnedPath_StripsTraversalFromFileName_ButKeepsDirectory()
    {
        // A file name containing an embedded traversal collapses to its final
        // safe segment, which is then joined under the requested directory —
        // the traversal never escapes into the directory portion of the path.
        var (service, _) = CreateService();
        var file = FormFileFactory.CreateFormFile("sub/../pwned.txt", "payload");

        var returned = await service.UploadAsync("docs", file);

        Assert.Equal("docs/pwned.txt", returned);
    }

    [Fact]
    public async Task UploadAsync_ReturnsForwardSlashRelativePath_RegardlessOfPlatform()
    {
        // ToRelative always emits forward slashes and trims the leading
        // separator, so the returned path is a clean relative path on every
        // platform (the OS may store it with '\' on Windows, but the API
        // contract is forward-slash).
        var (service, _) = CreateService();
        var file = FormFileFactory.CreateFormFile("report.txt", "x");

        var returned = await service.UploadAsync("deep/nested/dir", file);

        Assert.DoesNotContain('\\', returned);
        Assert.False(Path.IsPathRooted(returned));
        Assert.Equal("deep/nested/dir/report.txt", returned);
    }

    [Fact]
    public async Task UploadAsync_ReturnedPath_ResolvesBackToStoredFile_WithExpectedContent()
    {
        // Round-trip invariant: the returned relative path must resolve (via
        // ResolveFullPath) to the exact file that was just written, carrying
        // the expected content. Ties the return value to real on-disk storage.
        var (service, root) = CreateService();
        var file = FormFileFactory.CreateFormFile("report.txt", "the-content");

        var returned = await service.UploadAsync("docs/sub", file);

        var resolved = service.ResolveFullPath(returned);
        var expected = Path.GetFullPath(Path.Combine(root, "docs", "sub", "report.txt"));
        Assert.Equal(expected, resolved);
        Assert.True(File.Exists(resolved));
        Assert.Equal("the-content", await File.ReadAllTextAsync(resolved));
    }

    // =====================================================================
    // Delete
    // =====================================================================

    [Fact]
    public async Task Delete_RemovesFile()
    {
        var (service, root) = CreateService();
        // Materialize the lazily-created home root so fixtures can be written into it.
        service.ResolveFullPath("");
        var path = Path.Combine(root, "a.txt");
        await File.WriteAllTextAsync(path, "x");

        service.Delete("a.txt");

        Assert.False(File.Exists(path));
    }

    [Fact]
    public async Task Delete_RemovesDirectory_Recursively()
    {
        var (service, root) = CreateService();
        var dir = Path.Combine(root, "dir");
        Directory.CreateDirectory(Path.Combine(dir, "nested"));
        await File.WriteAllTextAsync(Path.Combine(dir, "a.txt"), "x");
        await File.WriteAllTextAsync(Path.Combine(dir, "nested", "b.txt"), "x");

        service.Delete("dir");

        Assert.False(Directory.Exists(dir));
    }

    [Fact]
    public void Delete_PathEscapingRoot_ThrowsArgumentException()
    {
        var (service, _) = CreateService();

        Assert.Throws<ArgumentException>(() => service.Delete("../escape"));
    }

    [Fact]
    public void Delete_EmptyDirectory_Succeeds()
    {
        var (service, root) = CreateService();
        var dir = Path.Combine(root, "empty");
        Directory.CreateDirectory(dir);

        // An empty directory is a distinct case from a populated one: the
        // recursive flag is a no-op but the branch selection must still
        // target Directory.Delete rather than File.Delete.
        service.Delete("empty");

        Assert.False(Directory.Exists(dir));
    }

    [Fact]
    public void Delete_NonExistentFile_SucceedsSilently()
    {
        var (service, root) = CreateService();
        // Materialize the lazily-created home root so the parent of the
        // target path exists on disk.
        service.ResolveFullPath("");
        var path = Path.Combine(root, "ghost.txt");

        Assert.False(File.Exists(path));

        // Deleting a path that is already gone must satisfy the post-condition
        // (entry absent) without throwing — Delete is idempotent for files.
        var ex = Record.Exception(() => service.Delete("ghost.txt"));

        Assert.Null(ex);
        Assert.False(File.Exists(path));
    }

    /// <summary>
    /// Deleting a path whose parent directory does not exist must succeed
    /// silently. Under the existence-based dispatch in <c>Delete</c>, such a
    /// path is neither <see cref="Directory.Exists(string)"/> nor
    /// <see cref="File.Exists(string)"/>, so the method is an idempotent
    /// no-op and never touches the disk — the "entry gone" post-condition
    /// already holds.
    /// </summary>
    [Fact]
    public void Delete_NonExistentNestedPath_SucceedsSilently()
    {
        var (service, root) = CreateService();
        // Materialize the lazily-created home root.
        service.ResolveFullPath("");
        var parentDir = Path.Combine(root, "nodir");
        var path = Path.Combine(parentDir, "ghost.txt");

        Assert.False(Directory.Exists(parentDir));
        Assert.False(File.Exists(path));

        var ex = Record.Exception(() => service.Delete("nodir/ghost.txt"));

        Assert.Null(ex);
        Assert.False(File.Exists(path));
        Assert.False(Directory.Exists(parentDir));
    }

    // =====================================================================
    // CreateDirectory
    // =====================================================================

    [Fact]
    public void CreateDirectory_CreatesDirectory_AtRelativePath()
    {
        var (service, root) = CreateService();
        var dir = Path.Combine(root, "newfolder");

        Assert.False(Directory.Exists(dir));

        service.CreateDirectory("newfolder");

        Assert.True(Directory.Exists(dir));
    }

    [Fact]
    public void CreateDirectory_CreatesMissingParentDirectories()
    {
        // Directory.CreateDirectory materializes every missing parent, so a
        // multi-segment relative path produces the whole chain — the same
        // behavior Move relies on for its destination parent.
        var (service, root) = CreateService();
        var leaf = Path.Combine(root, "a", "b", "c");

        service.CreateDirectory("a/b/c");

        Assert.True(Directory.Exists(leaf));
        Assert.True(Directory.Exists(Path.Combine(root, "a")));
        Assert.True(Directory.Exists(Path.Combine(root, "a", "b")));
    }
    [Fact]
    public void CreateDirectory_IsIdempotent_WhenDirectoryAlreadyExists()
    {
        var (service, root) = CreateService();
        var dir = Path.Combine(root, "exists");
        Directory.CreateDirectory(dir);

        // Creating an already-present directory is a documented no-op of
        // Directory.CreateDirectory; it must not throw.
        var ex = Record.Exception(() => service.CreateDirectory("exists"));

        Assert.Null(ex);
        Assert.True(Directory.Exists(dir));
    }

    [Fact]
    public void CreateDirectory_EmptyPath_MaterializesHomeRootWithoutThrowing()
    {
        // An empty/whitespace path resolves to the home root itself; creating
        // it must succeed (and materialize the lazily-created root).
        var (service, root) = CreateService();

        var ex = Record.Exception(() => service.CreateDirectory(string.Empty));

        Assert.Null(ex);
        Assert.True(Directory.Exists(root));
    }

    [Fact]
    public void CreateDirectory_PathEscapingRoot_ThrowsArgumentException()
    {
        var (service, _) = CreateService();

        Assert.Throws<ArgumentException>(() => service.CreateDirectory("../escape"));
    }

    /// <summary>
    /// Creating a directory over an existing *file* throws
    /// <see cref="ConflictException"/> (→ 409); the file is untouched. An
    /// existing *directory* remains an idempotent no-op.
    /// </summary>
    [Fact]
    public async Task CreateDirectory_OverExistingFile_ThrowsConflictException()
    {
        var (service, root) = CreateService();
        service.ResolveFullPath("");
        var file = Path.Combine(root, "conflict");
        await File.WriteAllTextAsync(file, "keep-me");

        var ex = Assert.Throws<ConflictException>(() => service.CreateDirectory("conflict"));
        Assert.Equal("A file with this name already exists", ex.Message);

        // The pre-existing file is untouched.
        Assert.Equal("keep-me", await File.ReadAllTextAsync(file));
    }

    // =====================================================================
    // Move
    // =====================================================================

    [Fact]
    public async Task Move_RelocatesFile_ToResolvedDestination()
    {
        var (service, root) = CreateService();
        // Materialize the lazily-created home root so fixtures can be written into it.
        service.ResolveFullPath("");
        await File.WriteAllTextAsync(Path.Combine(root, "src.txt"), "content");

        service.Move(new MoveRequest("src.txt", "dst.txt"));

        Assert.False(File.Exists(Path.Combine(root, "src.txt")));
        Assert.Equal("content", await File.ReadAllTextAsync(Path.Combine(root, "dst.txt")));
    }

    [Fact]
    public async Task Move_CreatesDestinationParentDirectory()
    {
        var (service, root) = CreateService();
        // Materialize the lazily-created home root so fixtures can be written into it.
        service.ResolveFullPath("");
        await File.WriteAllTextAsync(Path.Combine(root, "src.txt"), "content");

        service.Move(new MoveRequest("src.txt", "archive/dst.txt"));

        Assert.True(File.Exists(Path.Combine(root, "archive", "dst.txt")));
        Assert.False(File.Exists(Path.Combine(root, "src.txt")));
    }

    [Fact]
    public async Task Move_RelocatesDirectory_WithContents()
    {
        var (service, root) = CreateService();
        Directory.CreateDirectory(Path.Combine(root, "dir1", "sub"));
        await File.WriteAllTextAsync(Path.Combine(root, "dir1", "a.txt"), "x");
        await File.WriteAllTextAsync(Path.Combine(root, "dir1", "sub", "b.txt"), "y");

        service.Move(new MoveRequest("dir1", "dir2"));

        Assert.False(Directory.Exists(Path.Combine(root, "dir1")));
        Assert.True(File.Exists(Path.Combine(root, "dir2", "a.txt")));
        Assert.True(File.Exists(Path.Combine(root, "dir2", "sub", "b.txt")));
        Assert.Equal("y", await File.ReadAllTextAsync(Path.Combine(root, "dir2", "sub", "b.txt")));
    }

    /// <summary>
    /// The destination parent-creation step must materialize the full parent
    /// chain when the destination lives several levels deep.
    /// </summary>
    [Fact]
    public async Task Move_CreatesDeeplyNestedDestinationParentDirectories()
    {
        var (service, root) = CreateService();
        // Materialize the lazily-created home root so fixtures can be written into it.
        service.ResolveFullPath("");
        await File.WriteAllTextAsync(Path.Combine(root, "src.txt"), "deep");

        service.Move(new MoveRequest("src.txt", "a/b/c/dst.txt"));

        Assert.False(File.Exists(Path.Combine(root, "src.txt")));
        Assert.True(File.Exists(Path.Combine(root, "a", "b", "c", "dst.txt")));
        Assert.Equal("deep", await File.ReadAllTextAsync(Path.Combine(root, "a", "b", "c", "dst.txt")));
    }

    /// <summary>
    /// Moving a directory into a destination whose parent does not yet exist
    /// must create that parent (the same code path used for file moves) and
    /// then relocate the whole tree intact.
    /// </summary>
    [Fact]
    public async Task Move_Directory_IntoMissingParent_CreatesParentAndRelocates()
    {
        var (service, root) = CreateService();
        Directory.CreateDirectory(Path.Combine(root, "src", "sub"));
        await File.WriteAllTextAsync(Path.Combine(root, "src", "a.txt"), "x");
        await File.WriteAllTextAsync(Path.Combine(root, "src", "sub", "b.txt"), "y");

        service.Move(new MoveRequest("src", "archive/dir2"));

        Assert.False(Directory.Exists(Path.Combine(root, "src")));
        Assert.True(Directory.Exists(Path.Combine(root, "archive", "dir2")));
        Assert.True(File.Exists(Path.Combine(root, "archive", "dir2", "a.txt")));
        Assert.Equal("y", await File.ReadAllTextAsync(Path.Combine(root, "archive", "dir2", "sub", "b.txt")));
    }

    /// <summary>
    /// Creating the destination parent is idempotent: moving into a path whose
    /// parent already exists must not throw even though
    /// <see cref="Directory.CreateDirectory"/> is invoked unconditionally.
    /// </summary>
    [Fact]
    public async Task Move_DestinationParentAlreadyExists_DoesNotThrow()
    {
        var (service, root) = CreateService();
        Directory.CreateDirectory(Path.Combine(root, "existing"));
        await File.WriteAllTextAsync(Path.Combine(root, "src.txt"), "x");

        service.Move(new MoveRequest("src.txt", "existing/dst.txt"));

        Assert.False(File.Exists(Path.Combine(root, "src.txt")));
        Assert.True(File.Exists(Path.Combine(root, "existing", "dst.txt")));
    }

    /// <summary>
    /// Moving onto an existing destination throws <see cref="ConflictException"/>
    /// (→ 409). Checked before the parent is created or the move runs, so
    /// neither file is altered.
    /// </summary>
    [Fact]
    public async Task Move_DestinationAlreadyExists_ThrowsConflictException()
    {
        var (service, root) = CreateService();
        // Materialize the lazily-created home root so fixtures can be written into it.
        service.ResolveFullPath("");
        await File.WriteAllTextAsync(Path.Combine(root, "src.txt"), "1");
        await File.WriteAllTextAsync(Path.Combine(root, "dst.txt"), "2");

        var ex = Assert.Throws<ConflictException>(() => service.Move(new MoveRequest("src.txt", "dst.txt")));
        Assert.Equal("Destination already exists", ex.Message);

        // Neither file is altered.
        Assert.Equal("1", await File.ReadAllTextAsync(Path.Combine(root, "src.txt")));
        Assert.Equal("2", await File.ReadAllTextAsync(Path.Combine(root, "dst.txt")));
    }

    /// <summary>
    /// When the destination's parent directory cannot be computed — here both
    /// source and destination resolve to the home root, which is configured as
    /// the filesystem root so <see cref="Path.GetDirectoryName"/> returns null
    /// — <see cref="FileService.Move"/> must throw a clear
    /// <see cref="ArgumentException"/> rather than an opaque
    /// <see cref="ArgumentNullException"/> from
    /// <c>Directory.CreateDirectory(null!)</c>.
    /// </summary>
    /// <remarks>
    /// Specification test: the thrown exception must be a plain
    /// <see cref="ArgumentException"/>, not an <see cref="ArgumentNullException"/>
    /// (a subclass), hence the strict type check below.
    /// </remarks>
    [Fact]
    public void Move_DestinationParentIsFileSystemRoot_ThrowsArgumentExceptionNotArgumentNull()
    {
        // Misconfigure the home directory to be the filesystem root itself. An
        // empty relative path then resolves to that root, and
        // Path.GetDirectoryName of a filesystem root is null. Creating the
        // filesystem root is a no-op (it already exists), so this does not
        // touch the real file system.
        var fsRoot = Path.GetPathRoot(Directory.GetCurrentDirectory())!;
        var env = new FakeWebHostEnvironment { ContentRootPath = _contentRoot };
        var options = Options.Create(new FileServiceOptions { HomeDirectory = fsRoot });

        var service = new FileService(options, env);

        var ex = Assert.Throws<ArgumentException>(() =>
            service.Move(new MoveRequest("", "")));

        // Must be a plain ArgumentException with a clear message — not an
        // ArgumentNullException that Directory.CreateDirectory(null!) would raise.
        Assert.IsNotType<ArgumentNullException>(ex);
        Assert.DoesNotContain("Value cannot be null", ex.Message, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("destination", ex.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Move_SourceEscapingRoot_ThrowsArgumentException()
    {
        var (service, _) = CreateService();

        Assert.Throws<ArgumentException>(() =>
            service.Move(new MoveRequest("../escape", "x.txt")));
    }

    [Fact]
    public void Move_DestinationEscapingRoot_ThrowsArgumentException()
    {
        var (service, _) = CreateService();

        Assert.Throws<ArgumentException>(() =>
            service.Move(new MoveRequest("a.txt", "../escape/x.txt")));
    }

    // =====================================================================
    // Copy
    // =====================================================================

    [Fact]
    public async Task Copy_DuplicatesFile_KeepingSource()
    {
        var (service, root) = CreateService();
        // Materialize the lazily-created home root so fixtures can be written into it.
        service.ResolveFullPath("");
        await File.WriteAllTextAsync(Path.Combine(root, "a.txt"), "content");

        service.Copy(new CopyRequest("a.txt", "b.txt"));

        Assert.True(File.Exists(Path.Combine(root, "a.txt")));
        Assert.Equal("content", await File.ReadAllTextAsync(Path.Combine(root, "b.txt")));
    }

    [Fact]
    public async Task Copy_DuplicatesDirectory_Recursively_KeepingSource()
    {
        var (service, root) = CreateService();
        Directory.CreateDirectory(Path.Combine(root, "src", "sub"));
        await File.WriteAllTextAsync(Path.Combine(root, "src", "a.txt"), "x");
        await File.WriteAllTextAsync(Path.Combine(root, "src", "sub", "b.txt"), "y");

        service.Copy(new CopyRequest("src", "dst"));

        Assert.True(Directory.Exists(Path.Combine(root, "src"))); // source remains
        Assert.True(File.Exists(Path.Combine(root, "dst", "a.txt")));
        Assert.True(File.Exists(Path.Combine(root, "dst", "sub", "b.txt")));
        Assert.Equal("y", await File.ReadAllTextAsync(Path.Combine(root, "dst", "sub", "b.txt")));
    }

    [Fact]
    public async Task Copy_DoesNotOverwriteExistingDestination_ThrowsConflictException()
    {
        var (service, root) = CreateService();
        // Materialize the lazily-created home root so fixtures can be written into it.
        service.ResolveFullPath("");
        await File.WriteAllTextAsync(Path.Combine(root, "a.txt"), "1");
        await File.WriteAllTextAsync(Path.Combine(root, "b.txt"), "2");

        var ex = Assert.Throws<ConflictException>(() => service.Copy(new CopyRequest("a.txt", "b.txt")));
        Assert.Equal("Destination already exists", ex.Message);

        // Source untouched, destination unchanged.
        Assert.Equal("1", await File.ReadAllTextAsync(Path.Combine(root, "a.txt")));
        Assert.Equal("2", await File.ReadAllTextAsync(Path.Combine(root, "b.txt")));
    }

    [Fact]
    public void Copy_SourceEscapingRoot_ThrowsArgumentException()
    {
        var (service, _) = CreateService();

        Assert.Throws<ArgumentException>(() =>
            service.Copy(new CopyRequest("../escape", "x.txt")));
    }

    [Fact]
    public void Copy_DestinationEscapingRoot_ThrowsArgumentException()
    {
        var (service, _) = CreateService();

        Assert.Throws<ArgumentException>(() =>
            service.Copy(new CopyRequest("a.txt", "../escape/x.txt")));
    }

    // =====================================================================
    // Copy — recursion depth limit
    //
    // CopyDirectory recurses with a bounded depth (MaxCopyDepth = 32) so that a
    // pathological or self-referential tree cannot overflow the stack. The
    // public Copy(CopyRequest) seeds the recursion at depth 0 and each nested
    // directory adds one; the guard throws IOException once depth reaches the
    // limit. The tests below pin both sides of that boundary as well as the
    // exact exception type/message.
    // =====================================================================

    [Theory]
    [InlineData(1)]    // trivial single-level nesting
    [InlineData(20)]   // comfortably inside the limit
    [InlineData(31)]   // the deepest level still permitted (depth 31 < 32)
    public async Task Copy_DirectoryChain_WithinDepthLimit_CopiesCompletely(int levels)
    {
        var (service, root) = CreateService();

        var sourceDir = Path.Combine(root, "src");
        var sourceLeaf = CreateNestedChain(sourceDir, levels);
        await File.WriteAllTextAsync(Path.Combine(sourceDir, "top.txt"), "top");
        await File.WriteAllTextAsync(Path.Combine(sourceLeaf, "leaf.txt"), "deep");

        service.Copy(new CopyRequest("src", "dst"));

        // The source is only ever read during a copy, so it must survive intact.
        Assert.True(File.Exists(Path.Combine(sourceDir, "top.txt")));
        Assert.True(File.Exists(Path.Combine(sourceLeaf, "leaf.txt")));

        // The destination must mirror the structure all the way to the leaf,
        // proving the depth guard does not reject legitimate deep-but-finite trees.
        var destLeaf = Path.Combine(root, "dst");
        for (var i = 1; i <= levels; i++)
        {
            destLeaf = Path.Combine(destLeaf, $"d{i}");
        }
        Assert.True(File.Exists(Path.Combine(root, "dst", "top.txt")));
        Assert.True(File.Exists(Path.Combine(destLeaf, "leaf.txt")));
    }

    [Theory]
    [InlineData(32)]   // first recursion depth that trips `depth >= MaxCopyDepth`
    [InlineData(33)]   // one level beyond the boundary
    [InlineData(50)]   // comfortably beyond the boundary
    public void Copy_DirectoryChain_AtOrBeyondDepthLimit_ThrowsIOException(int levels)
    {
        var (service, root) = CreateService();

        var sourceDir = Path.Combine(root, "src");
        CreateNestedChain(sourceDir, levels);

        var ex = Assert.Throws<IOException>(() =>
            service.Copy(new CopyRequest("src", "dst")));

        Assert.Equal(
            "Directory copy depth limit exceeded (possible cycle)",
            ex.Message);
    }

    [Fact]
    public async Task Copy_DeeplyNestedDirectory_BeyondLimit_LeavesSourceUntouched()
    {
        var (service, root) = CreateService();

        // A chain well beyond the limit: the copy must abort with IOException
        // but must never mutate the source directory it is reading from.
        var sourceDir = Path.Combine(root, "src");
        var sourceLeaf = CreateNestedChain(sourceDir, 50);
        await File.WriteAllTextAsync(Path.Combine(sourceLeaf, "leaf.txt"), "deep");
        await File.WriteAllTextAsync(Path.Combine(sourceDir, "top.txt"), "top");

        Assert.Throws<IOException>(() => service.Copy(new CopyRequest("src", "dst")));

        // Even the deep levels the recursion never reached remain present and
        // unchanged in the source tree.
        Assert.True(Directory.Exists(sourceLeaf));
        Assert.True(File.Exists(Path.Combine(sourceLeaf, "leaf.txt")));
        Assert.True(File.Exists(Path.Combine(sourceDir, "top.txt")));
        Assert.Equal("top", await File.ReadAllTextAsync(Path.Combine(sourceDir, "top.txt")));
    }

    // =====================================================================
    // Copy — reparse points (symbolic links / junctions)
    //
    // CopyDirectory must NOT follow reparse points: a symlink or junction may
    // target a location outside the home sandbox, and following it would pull
    // external content into the copy. Such entries are skipped (not
    // reproduced). These tests create a link whose target lives outside the
    // home root (but inside the per-test content root, so it is cleaned up by
    // Dispose) and assert the linked content is not copied.
    // =====================================================================

    [Fact]
    public async Task Copy_DoesNotFollowDirectorySymlinks()
    {
        var (service, root) = CreateService();
        Directory.CreateDirectory(Path.Combine(root, "src"));
        await File.WriteAllTextAsync(Path.Combine(root, "src", "kept.txt"), "x");

        // External content the symlink targets. If CopyDirectory followed the
        // link, leak.txt would be pulled into the destination.
        var externalDir = Path.Combine(_contentRoot, "external_" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(externalDir);
        await File.WriteAllTextAsync(Path.Combine(externalDir, "leak.txt"), "leaked");

        var linkPath = Path.Combine(root, "src", "link");
        if (!TryCreateDirectorySymlink(linkPath, externalDir))
        {
            return; // symbolic links unavailable on this host
        }

        service.Copy(new CopyRequest("src", "dst"));

        Assert.True(File.Exists(Path.Combine(root, "dst", "kept.txt")));
        // The linked external file was NOT pulled in...
        Assert.False(File.Exists(Path.Combine(root, "dst", "link", "leak.txt")));
        // ...and the reparse-point entry is not reproduced at all.
        Assert.False(Directory.Exists(Path.Combine(root, "dst", "link")));
    }

    [Fact]
    public async Task Copy_DoesNotFollowFileSymlinks()
    {
        var (service, root) = CreateService();
        Directory.CreateDirectory(Path.Combine(root, "src"));
        await File.WriteAllTextAsync(Path.Combine(root, "src", "kept.txt"), "x");

        var externalFile = Path.Combine(_contentRoot, "ext_" + Guid.NewGuid().ToString("N") + ".txt");
        await File.WriteAllTextAsync(externalFile, "leaked");

        var linkPath = Path.Combine(root, "src", "link.txt");
        if (!TryCreateFileSymlink(linkPath, externalFile))
        {
            return; // symbolic links unavailable on this host
        }

        service.Copy(new CopyRequest("src", "dst"));

        Assert.True(File.Exists(Path.Combine(root, "dst", "kept.txt")));
        // The symlinked external file was NOT followed/copied.
        Assert.False(File.Exists(Path.Combine(root, "dst", "link.txt")));
    }

    // =====================================================================
    // Fake host environment used to satisfy the IWebHostEnvironment dependency.
    // =====================================================================

    private sealed class FakeWebHostEnvironment : IWebHostEnvironment
    {
        public string EnvironmentName { get; set; } = "Development";
        public string ApplicationName { get; set; } = "TestProject.Tests";
        public string ContentRootPath { get; set; } = "";
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
        public string WebRootPath { get; set; } = "";
        public IFileProvider WebRootFileProvider { get; set; } = new NullFileProvider();
    }
}

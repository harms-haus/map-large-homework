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
/// Additional characterization tests for <see cref="FileService"/>.
///
/// These complement <see cref="FileServiceTests"/> by pinning down
/// observable behaviors that are sensitive to the internal split of
/// <c>FileService</c> into focused modules (<c>HomeRoot</c>,
/// <c>FileNameSanitizer</c>, <c>DirectoryCopy</c>, <c>FileSearch</c>) and
/// that were not previously covered. Every test exercises the public
/// <see cref="IFileService"/> surface — the same surface that must remain
/// unchanged after the restructuring — so a behavior-altering refactor will
/// fail here regardless of how the internals are reorganized.
///
/// Each test runs against its own unique temporary content root and is fully
/// independent of the others and of <see cref="FileServiceTests"/>.
/// </summary>
public class FileServiceCharacterizationTests : IDisposable
{
    private readonly string _contentRoot;

    public FileServiceCharacterizationTests()
    {
        _contentRoot = Directory.CreateTempSubdirectory("fs_char_").FullName;
    }

    public void Dispose()
    {
        try
        {
            Directory.Delete(_contentRoot, recursive: true);
        }
        catch
        {
            // Best-effort cleanup; temp directories may already be gone.
        }
    }

    // Builds a fresh service whose home directory lives under the per-test
    // content root and returns the absolute, normalized root it should treat
    // as its sandbox.
    private (FileService service, string root) CreateService(string homeDirectory = "Home")
    {
        var env = new FakeWebHostEnvironment { ContentRootPath = _contentRoot };
        var options = Options.Create(new FileServiceOptions { HomeDirectory = homeDirectory });

        var service = new FileService(options, env);
        var root = Path.GetFullPath(Path.Combine(_contentRoot, homeDirectory));
        return (service, root);
    }

    // Creates a directory symbolic link, returning false when the host cannot
    // create one (e.g. Windows without the SeCreateSymbolicLinkPrivilege) so a
    // reparse-point test can opt out cleanly instead of failing.
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

    // =====================================================================
    // Path sandboxing (HomeRoot / SafeResolve)
    //
    // The sandbox check must reject any relative path whose normalized form
    // lands outside the home root — including the subtle "prefix collision"
    // case where a sibling directory's name merely starts with the root's
    // name (e.g. "HomeShadow" next to "Home"). The check relies on appending
    // the platform separator to the root before the prefix test precisely so
    // such a sibling is NOT mistaken for an ancestor of an in-root path.
    // =====================================================================

    /// <summary>
    /// A sibling directory whose name is a prefix of the home root name
    /// (here <c>HomeShadow</c> beside root <c>Home</c>) must be rejected as
    /// outside the sandbox. This is the security-critical edge case the
    /// <c>root + separator</c> prefix test exists to catch: a naive
    /// <c>StartsWith(root)</c> would incorrectly admit it.
    /// </summary>
    [Fact]
    public void ResolveFullPath_SiblingWithNamePrefixedByRoot_ThrowsArgumentException()
    {
        var (service, _) = CreateService(homeDirectory: "Home");

        // "../HomeShadow" normalizes to <contentRoot>/HomeShadow — a sibling
        // of the root whose name merely starts with "Home".
        var ex = Assert.Throws<ArgumentException>(() => service.ResolveFullPath("../HomeShadow"));
        Assert.Equal("Invalid path", ex.Message);
    }

    /// <summary>
    /// A single-dot segment resolves (via <see cref="Path.GetFullPath"/>) to
    /// the root itself, which the sandbox accepts as the root case.
    /// </summary>
    [Fact]
    public void ResolveFullPath_SingleDotSegment_NormalizesToRoot()
    {
        var (service, root) = CreateService();

        Assert.Equal(root, service.ResolveFullPath("."));
    }

    /// <summary>
    /// A path that climbs back up to exactly the root via a trailing
    /// <c>..</c> must normalize to the root and be accepted (not treated as
    /// an escape). This is distinct from a path that climbs *past* the root.
    /// </summary>
    [Fact]
    public void ResolveFullPath_DotDotClimbingBackToExactlyRoot_ResolvesToRoot()
    {
        var (service, root) = CreateService();

        Assert.Equal(root, service.ResolveFullPath("sub/.."));
    }

    // =====================================================================
    // Search (FileSearch)
    //
    // The DFS traversal matches entry names case-insensitively and caps the
    // result list at <c>MaxSearchResults</c>. Two boundary inputs deserve
    // pinning: an empty query (which matches every name because every string
    // contains the empty string) and a query that matches nothing.
    // =====================================================================

    /// <summary>
    /// An empty query matches every entry, because
    /// <c>name.Contains("")</c> is <c>true</c> for any name. This is the
    /// de-facto "list everything" behavior of <see cref="IFileService.Search"/>
    /// and must survive the search extraction unchanged.
    /// </summary>
    [Fact]
    public async Task Search_EmptyQuery_MatchesEveryEntry()
    {
        var (service, root) = CreateService();
        Directory.CreateDirectory(Path.Combine(root, "docs"));
        await File.WriteAllTextAsync(Path.Combine(root, "a.txt"), "x");
        await File.WriteAllTextAsync(Path.Combine(root, "docs", "b.txt"), "x");

        var result = service.Search(string.Empty, "");

        Assert.Equal(string.Empty, result.Query);
        Assert.Equal(3, result.Results.Count);
        Assert.Contains(result.Results, r => r.Name == "docs");
        Assert.Contains(result.Results, r => r.Path == "a.txt");
        Assert.Contains(result.Results, r => r.Path == "docs/b.txt");
    }

    /// <summary>
    /// A query that matches no entry returns an empty result list while the
    /// <see cref="SearchResultDto.Query"/> and <see cref="SearchResultDto.Path"/>
    /// fields are still echoed back populated.
    /// </summary>
    [Fact]
    public async Task Search_NoMatches_ReturnsEmptyResults_WithQueryAndPathPopulated()
    {
        var (service, root) = CreateService();
        service.ResolveFullPath(""); // materialize the lazily-created home root
        await File.WriteAllTextAsync(Path.Combine(root, "a.txt"), "x");

        var result = service.Search("zzz-not-present", "");

        Assert.Equal("zzz-not-present", result.Query);
        Assert.Equal("", result.Path);
        Assert.Empty(result.Results);
    }

    /// <summary>
    /// When the query matches both a directory and a file nested inside that
    /// directory, both must appear as separate results — the descent into the
    /// matching directory is not short-circuited by the directory match.
    /// </summary>
    [Fact]
    public async Task Search_MatchesBothDirectoryAndFileNestedInsideIt()
    {
        var (service, root) = CreateService();
        Directory.CreateDirectory(Path.Combine(root, "matchdir"));
        await File.WriteAllTextAsync(Path.Combine(root, "matchdir", "matchfile.txt"), "x");
        // A non-matching sibling ensures the matcher is selective.
        await File.WriteAllTextAsync(Path.Combine(root, "other.txt"), "x");

        var result = service.Search("match", "");

        Assert.Equal(2, result.Results.Count);
        Assert.Contains(result.Results, r => r.Name == "matchdir" && r.IsDirectory);
        Assert.Contains(result.Results, r => r.Path == "matchdir/matchfile.txt" && !r.IsDirectory);
        Assert.DoesNotContain(result.Results, r => r.Name == "other.txt");
    }

    // =====================================================================
    // UploadAsync (FileNameSanitizer / PrepareUploadedFileName)
    //
    // The uploaded file name is untrusted and is reduced to its final safe
    // segment before being combined with the sandboxed directory. Both '/'
    // and '\' are treated as separators (closing the cross-platform
    // traversal gap), and surrounding whitespace is trimmed.
    // =====================================================================

    /// <summary>
    /// A file name mixing forward and back slashes collapses to its final
    /// non-trivial segment regardless of which separator precedes it. This
    /// pins the split-on-both-separators behavior that makes traversal
    /// stripping work identically on Linux and Windows.
    /// </summary>
    [Fact]
    public async Task UploadAsync_MixedSeparatorsInFileName_StripsToFinalSegment()
    {
        var (service, root) = CreateService();
        // "a\b/c\d.txt": the final safe segment is "d.txt".
        var file = FormFileFactory.CreateFormFile("a\\b/c\\d.txt", "payload");

        var returned = await service.UploadAsync("", file);

        Assert.Equal("d.txt", returned);
        Assert.True(File.Exists(Path.Combine(root, "d.txt")));
        Assert.Equal("payload", await File.ReadAllTextAsync(Path.Combine(root, "d.txt")));
        // Nothing was created in the intermediate-segment directories.
        Assert.False(Directory.Exists(Path.Combine(root, "a")));
    }

    /// <summary>
    /// Leading and trailing whitespace around the final segment is trimmed
    /// before storage, so a name like <c>"  report.txt  "</c> is stored as
    /// <c>report.txt</c>.
    /// </summary>
    [Fact]
    public async Task UploadAsync_TrimsLeadingAndTrailingWhitespace_FromFileName()
    {
        var (service, root) = CreateService();
        var file = FormFileFactory.CreateFormFile("   report.txt   ", "payload");

        var returned = await service.UploadAsync("docs", file);

        Assert.Equal("docs/report.txt", returned);
        Assert.True(File.Exists(Path.Combine(root, "docs", "report.txt")));
    }

    // =====================================================================
    // Browse — reparse-point handling in directory ItemCount
    //
    // A directory entry's <see cref="FileEntryDto.ItemCount"/> reflects its
    // immediate children, but a reparse point (symbolic link / junction) is
    // reported as having zero children rather than descending into its
    // (possibly external) target.
    // =====================================================================

    /// <summary>
    /// A symbolic-link directory appearing in a browse listing must report
    /// <see cref="FileEntryDto.ItemCount"/> of zero (the reparse-point guard
    /// in the child-count helper), and the linked target's contents must not
    /// leak into the listing.
    /// </summary>
    [Fact]
    public async Task Browse_SymlinkedDirectory_ReportsZeroItemCount_AndDoesNotLeakTargetContents()
    {
        var (service, root) = CreateService();
        service.ResolveFullPath(""); // materialize the lazily-created home root

        // External target the symlink points at — outside the home sandbox.
        var externalDir = Path.Combine(_contentRoot, "external_" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(externalDir);
        await File.WriteAllTextAsync(Path.Combine(externalDir, "secret.txt"), "top-secret");

        var linkPath = Path.Combine(root, "linkdir");
        if (!TryCreateDirectorySymlink(linkPath, externalDir))
        {
            return; // symbolic links unavailable on this host
        }

        var result = service.Browse("");

        var link = Assert.Single(result.Entries, e => e.Name == "linkdir");
        Assert.True(link.IsDirectory);
        Assert.Equal(0, link.ItemCount); // reparse point -> not descended into

        // The linked target's content is not enumerated into the listing.
        Assert.DoesNotContain(result.Entries, e => e.Name == "secret.txt");
    }

    // =====================================================================
    // Copy (DirectoryCopy)
    //
    // The recursion-bounded copy preserves structure, never overwrites an
    // existing destination file, skips reparse points, and surfaces a clear
    // error when the source is missing.
    // =====================================================================

    /// <summary>
    /// Copying an empty directory creates an empty destination directory and
    /// leaves the source intact.
    /// </summary>
    [Fact]
    public void Copy_EmptySourceDirectory_CreatesEmptyDestination_KeepingSource()
    {
        var (service, root) = CreateService();
        Directory.CreateDirectory(Path.Combine(root, "src"));

        service.Copy(new CopyRequest("src", "dst"));

        Assert.True(Directory.Exists(Path.Combine(root, "src")));
        Assert.True(Directory.Exists(Path.Combine(root, "dst")));
        Assert.Empty(Directory.GetFileSystemEntries(Path.Combine(root, "dst")));
    }

    /// <summary>
    /// Copying a source that exists as neither a directory nor a file
    /// surfaces the underlying <see cref="FileNotFoundException"/> from
    /// <see cref="File.Copy(string, string, bool)"/>; the orchestrator does
    /// not swallow missing-source errors.
    /// </summary>
    [Fact]
    public void Copy_NonExistentSource_ThrowsFileNotFoundException()
    {
        var (service, _) = CreateService();

        Assert.Throws<FileNotFoundException>(() =>
            service.Copy(new CopyRequest("ghost", "dst")));
    }

    /// <summary>
    /// Copying onto an existing destination throws <see cref="ConflictException"/>
    /// (→ 409). Checked before the recursive copy begins, so both source and
    /// the pre-existing destination file are unaltered.
    /// </summary>
    [Fact]
    public async Task Copy_DirectoryWithConflictingDestinationFile_ThrowsConflictException_AndDoesNotOverwrite()
    {
        var (service, root) = CreateService();
        Directory.CreateDirectory(Path.Combine(root, "src"));
        await File.WriteAllTextAsync(Path.Combine(root, "src", "shared.txt"), "new");
        // Pre-existing destination directory + conflicting file.
        Directory.CreateDirectory(Path.Combine(root, "dst"));
        await File.WriteAllTextAsync(Path.Combine(root, "dst", "shared.txt"), "old");

        Assert.Throws<ConflictException>(() =>
            service.Copy(new CopyRequest("src", "dst")));

        // Source untouched, destination file not overwritten.
        Assert.Equal("new", await File.ReadAllTextAsync(Path.Combine(root, "src", "shared.txt")));
        Assert.Equal("old", await File.ReadAllTextAsync(Path.Combine(root, "dst", "shared.txt")));
    }

    // =====================================================================
    // Delete — idempotency
    // =====================================================================

    /// <summary>
    /// <see cref="IFileService.Delete"/> is idempotent: deleting the same
    /// path twice must not throw on the second call (the entry is already
    /// gone, satisfying the post-condition).
    /// </summary>
    [Fact]
    public async Task Delete_CalledTwice_SecondCallIsSilentNoOp()
    {
        var (service, root) = CreateService();
        service.ResolveFullPath(""); // materialize the lazily-created home root
        var path = Path.Combine(root, "a.txt");
        await File.WriteAllTextAsync(path, "x");

        service.Delete("a.txt");
        var second = Record.Exception(() => service.Delete("a.txt"));

        Assert.Null(second);
        Assert.False(File.Exists(path));
    }

    // =====================================================================
    // Move — missing source
    // =====================================================================

    /// <summary>
    /// Moving a source that exists as neither a directory nor a file surfaces
    /// the underlying <see cref="FileNotFoundException"/> from
    /// <see cref="File.Move(string, string)"/>; the orchestrator does not
    /// swallow missing-source errors.
    /// </summary>
    [Fact]
    public void Move_NonExistentSource_ThrowsFileNotFoundException()
    {
        var (service, _) = CreateService();

        Assert.Throws<FileNotFoundException>(() =>
            service.Move(new MoveRequest("ghost", "dst")));
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

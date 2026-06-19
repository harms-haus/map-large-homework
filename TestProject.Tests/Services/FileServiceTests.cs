using System.Text;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Options;
using TestProject.Models;
using TestProject.Services;
using Xunit;

namespace TestProject.Tests.Services;

/// <summary>
/// Functional tests for <see cref="FileService"/>. Each test runs against a
/// unique temporary content root so that tests are fully independent and
/// never touch the real file system outside a scratch directory.
///
/// The service computes its home root once, at construction time, as
/// <c>Path.GetFullPath(Path.Combine(env.ContentRootPath, options.HomeDirectory))</c>
/// and is expected to create that directory if it does not yet exist. Every
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

    private static IFormFile CreateFormFile(string fileName, string content)
    {
        var bytes = Encoding.UTF8.GetBytes(content);
        var stream = new MemoryStream(bytes);
        return new FormFile(stream, 0, bytes.Length, "file", fileName);
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

        var (_, root) = CreateService(home);

        Assert.True(Directory.Exists(root));
        Assert.Equal(expectedRoot, root);
    }

    [Fact]
    public void Constructor_SupportsNestedHomeDirectoryPath()
    {
        var home = "Data/Files";
        var expectedRoot = Path.GetFullPath(Path.Combine(_contentRoot, home));

        Assert.False(Directory.Exists(expectedRoot));

        var (_, root) = CreateService(home);

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
        Assert.Equal(expected, service.ResolveFullPath(""));
        Assert.True(Directory.Exists(expected));
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

    // =====================================================================
    // UploadAsync
    // =====================================================================

    [Fact]
    public async Task UploadAsync_WritesFileContent_ToResolvedDirectory()
    {
        var (service, root) = CreateService();
        var file = CreateFormFile("upload.txt", "file-content");

        await service.UploadAsync("", file);

        var written = await File.ReadAllTextAsync(Path.Combine(root, "upload.txt"));
        Assert.Equal("file-content", written);
    }

    [Fact]
    public async Task UploadAsync_CreatesTargetDirectory_WhenMissing()
    {
        var (service, root) = CreateService();
        var file = CreateFormFile("file.txt", "data");

        await service.UploadAsync("newdir", file);

        Assert.True(File.Exists(Path.Combine(root, "newdir", "file.txt")));
        Assert.Equal("data", await File.ReadAllTextAsync(Path.Combine(root, "newdir", "file.txt")));
    }

    [Fact]
    public async Task UploadAsync_PathEscapingRoot_ThrowsArgumentException()
    {
        var (service, _) = CreateService();
        var file = CreateFormFile("a.txt", "x");

        await Assert.ThrowsAsync<ArgumentException>(() => service.UploadAsync("../escape", file));
    }

    // =====================================================================
    // Delete
    // =====================================================================

    [Fact]
    public async Task Delete_RemovesFile()
    {
        var (service, root) = CreateService();
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

    // =====================================================================
    // Move
    // =====================================================================

    [Fact]
    public async Task Move_RelocatesFile_ToResolvedDestination()
    {
        var (service, root) = CreateService();
        await File.WriteAllTextAsync(Path.Combine(root, "src.txt"), "content");

        service.Move(new MoveRequest("src.txt", "dst.txt"));

        Assert.False(File.Exists(Path.Combine(root, "src.txt")));
        Assert.Equal("content", await File.ReadAllTextAsync(Path.Combine(root, "dst.txt")));
    }

    [Fact]
    public async Task Move_CreatesDestinationParentDirectory()
    {
        var (service, root) = CreateService();
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
    public async Task Copy_DoesNotOverwriteExistingDestination_ThrowsIOException()
    {
        var (service, root) = CreateService();
        await File.WriteAllTextAsync(Path.Combine(root, "a.txt"), "1");
        await File.WriteAllTextAsync(Path.Combine(root, "b.txt"), "2");

        Assert.Throws<IOException>(() => service.Copy(new CopyRequest("a.txt", "b.txt")));

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

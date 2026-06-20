using System.Reflection;
using Microsoft.AspNetCore.Http;
using TestProject.Models;
using TestProject.Services;
using TestProject.Tests.TestHelpers;
using Xunit;

namespace TestProject.Tests.Controllers;

/// <summary>
/// Direct characterization tests for <see cref="FakeFileService"/>, the
/// recording/stub double for <see cref="IFileService"/> that today lives at
/// the bottom of <see cref="FilesControllerTests"/>. The existing controller
/// tests only exercise the double indirectly; these tests pin down its
/// standalone, observable behavior — its type shape, the exact set of public
/// fields and method signatures, the default values, the recorded-input
/// behavior, the configurable return values and faults, and the precedence
/// of recording over throwing — so the upcoming move of the class into its
/// own file (and the <c>internal</c> → <c>public</c> accessibility change)
/// can be verified not to alter any behavior.
/// </summary>
public class FakeFileServiceTests
{
    // =====================================================================
    // Type shape — the verbatim move must preserve all of these.
    // (Accessibility is intentionally changing internal → public, so it is
    //  deliberately not asserted here; only the stable attributes are.)
    // =====================================================================

    [Fact]
    public void Implements_IFileService()
    {
        Assert.True(typeof(IFileService).IsAssignableFrom(typeof(FakeFileService)));
    }

    [Fact]
    public void Is_Sealed()
    {
        Assert.True(typeof(FakeFileService).IsSealed);
    }

    [Fact]
    public void Lives_In_TestProject_Tests_Controllers_Namespace()
    {
        Assert.Equal("TestProject.Tests.Controllers", typeof(FakeFileService).Namespace);
    }

    [Fact]
    public void Can_Be_Constructed_With_A_Parameterless_Constructor()
    {
        var fake = new FakeFileService();

        Assert.NotNull(fake);
    }

    [Fact]
    public void Declares_Exactly_The_Expected_Public_Instance_Fields_With_Correct_Types()
    {
        var fields = typeof(FakeFileService)
            .GetFields(BindingFlags.Public | BindingFlags.Instance)
            .Select(f => (f.Name, f.FieldType))
            .ToArray();

        var expected = new (string Name, Type Type)[]
        {
            // ----- recorded inputs -----
            ("BrowsePath", typeof(string)),
            ("SearchQuery", typeof(string)),
            ("SearchPath", typeof(string)),
            ("ResolvePath", typeof(string)),
            ("UploadDirPath", typeof(string)),
            ("UploadFile", typeof(IFormFile)),
            ("DeletePath", typeof(string)),
            ("MoveRequest", typeof(MoveRequest)),
            ("CopyRequest", typeof(CopyRequest)),
            ("CreateDirectoryPath", typeof(string)),
            // ----- configurable outputs / faults -----
            ("BrowseResult", typeof(BrowseResultDto)),
            ("SearchResult", typeof(SearchResultDto)),
            ("ResolvedPath", typeof(string)),
            ("BrowseException", typeof(Exception)),
            ("SearchException", typeof(Exception)),
            ("ResolveException", typeof(Exception)),
            ("UploadException", typeof(Exception)),
            ("DeleteException", typeof(Exception)),
            ("MoveException", typeof(Exception)),
            ("CopyException", typeof(Exception)),
            ("CreateDirectoryException", typeof(Exception)),
        };

        // Exactly the documented set — catches dropped, renamed, or extra
        // fields introduced by the manual move.
        Assert.Equal(
            expected.Select(e => e.Name).OrderBy(n => n),
            fields.Select(f => f.Name).OrderBy(n => n));
        // …and each one keeps its declared element type (nullable reference
        // annotations like string? are not represented in FieldType).
        foreach (var (name, type) in expected)
        {
            var actual = fields.Single(f => f.Name == name);
            Assert.Equal(type, actual.FieldType);
        }
    }

    [Fact]
    public void Declares_Exactly_The_Eight_IFileService_Methods()
    {
        var methods = typeof(FakeFileService)
            .GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly)
            .Where(m => !m.IsSpecialName)
            .Select(m => m.Name)
            .ToArray();

        Assert.Equal(
            new[] { "Browse", "Copy", "CreateDirectory", "Delete", "Move", "ResolveFullPath", "Search", "UploadAsync" }
                .OrderBy(n => n),
            methods.OrderBy(n => n));
    }

    [Fact]
    public void Methods_Have_The_Documented_Signatures()
    {
        AssertMethod("Browse", typeof(BrowseResultDto), typeof(string));
        AssertMethod("Search", typeof(SearchResultDto), typeof(string), typeof(string));
        AssertMethod("ResolveFullPath", typeof(string), typeof(string));
        AssertMethod("UploadAsync", typeof(Task), typeof(string), typeof(IFormFile));
        AssertMethod("Delete", typeof(void), typeof(string));
        AssertMethod("Move", typeof(void), typeof(MoveRequest));
        AssertMethod("Copy", typeof(void), typeof(CopyRequest));
        AssertMethod("CreateDirectory", typeof(void), typeof(string));
    }

    // =====================================================================
    // Default field values on a fresh instance.
    // =====================================================================

    [Fact]
    public void Defaults_All_Recorded_Inputs_And_Faults_To_Null()
    {
        var fake = new FakeFileService();

        // recorded inputs start null
        Assert.Null(fake.BrowsePath);
        Assert.Null(fake.SearchQuery);
        Assert.Null(fake.SearchPath);
        Assert.Null(fake.ResolvePath);
        Assert.Null(fake.UploadDirPath);
        Assert.Null(fake.UploadFile);
        Assert.Null(fake.DeletePath);
        Assert.Null(fake.MoveRequest);
        Assert.Null(fake.CopyRequest);
        Assert.Null(fake.CreateDirectoryPath);

        // configurable faults start null
        Assert.Null(fake.BrowseException);
        Assert.Null(fake.SearchException);
        Assert.Null(fake.ResolveException);
        Assert.Null(fake.UploadException);
        Assert.Null(fake.DeleteException);
        Assert.Null(fake.MoveException);
        Assert.Null(fake.CopyException);
        Assert.Null(fake.CreateDirectoryException);
    }

    [Fact]
    public void Defaults_BrowseResult_To_An_Empty_NonNull_Dto()
    {
        var fake = new FakeFileService();

        Assert.NotNull(fake.BrowseResult);
        Assert.Equal(string.Empty, fake.BrowseResult.Path);
        Assert.Null(fake.BrowseResult.Parent);
        Assert.Empty(fake.BrowseResult.Entries);
        Assert.Equal(0, fake.BrowseResult.FolderCount);
        Assert.Equal(0, fake.BrowseResult.FileCount);
        Assert.Equal(0L, fake.BrowseResult.TotalSize);
    }

    [Fact]
    public void Defaults_SearchResult_To_An_Empty_NonNull_Dto()
    {
        var fake = new FakeFileService();

        Assert.NotNull(fake.SearchResult);
        Assert.Equal(string.Empty, fake.SearchResult.Query);
        Assert.Equal(string.Empty, fake.SearchResult.Path);
        Assert.Empty(fake.SearchResult.Results);
    }

    [Fact]
    public void Defaults_ResolvedPath_To_Empty_String()
    {
        var fake = new FakeFileService();

        Assert.Equal(string.Empty, fake.ResolvedPath);
    }

    // =====================================================================
    // Recorded-input behavior.
    // =====================================================================

    [Fact]
    public void Browse_Records_The_Provided_RelativePath()
    {
        var fake = new FakeFileService();

        fake.Browse("docs/sub");

        Assert.Equal("docs/sub", fake.BrowsePath);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("with space/and UPPER")]
    public void Browse_Records_The_Argument_Verbatim_Without_Normalizing(string? path)
    {
        // The double records exactly what it is handed; it does not normalize
        // null to "" (the controller does that before calling).
        var fake = new FakeFileService();

        fake.Browse(path!);

        Assert.Equal(path, fake.BrowsePath);
    }

    [Fact]
    public void Search_Records_Both_Query_And_Path()
    {
        var fake = new FakeFileService();

        fake.Search("report", "docs");

        Assert.Equal("report", fake.SearchQuery);
        Assert.Equal("docs", fake.SearchPath);
    }

    [Fact]
    public void Search_Records_Query_And_Path_Verbatim_Including_Null()
    {
        var fake = new FakeFileService();

        fake.Search(null!, null!);

        Assert.Null(fake.SearchQuery);
        Assert.Null(fake.SearchPath);
    }

    [Fact]
    public void ResolveFullPath_Records_The_Provided_RelativePath()
    {
        var fake = new FakeFileService();

        fake.ResolveFullPath("a/b.txt");

        Assert.Equal("a/b.txt", fake.ResolvePath);
    }

    [Fact]
    public async Task UploadAsync_Records_Both_Directory_And_File()
    {
        var fake = new FakeFileService();
        var file = FormFileFactory.CreateFormFile("upload.txt", "payload");

        await fake.UploadAsync("docs", file);

        Assert.Equal("docs", fake.UploadDirPath);
        Assert.Same(file, fake.UploadFile);
    }

    [Fact]
    public void Delete_Records_The_Provided_RelativePath()
    {
        var fake = new FakeFileService();

        fake.Delete("docs/file.txt");

        Assert.Equal("docs/file.txt", fake.DeletePath);
    }

    [Fact]
    public void Move_Records_The_Provided_Request_Instance()
    {
        var fake = new FakeFileService();
        var request = new MoveRequest("src/a.txt", "dst/a.txt");

        fake.Move(request);

        Assert.Same(request, fake.MoveRequest);
    }

    [Fact]
    public void Copy_Records_The_Provided_Request_Instance()
    {
        var fake = new FakeFileService();
        var request = new CopyRequest("src/a.txt", "backup/a.txt");

        fake.Copy(request);

        Assert.Same(request, fake.CopyRequest);
    }

    [Fact]
    public void CreateDirectory_Records_The_Provided_RelativePath()
    {
        var fake = new FakeFileService();

        fake.CreateDirectory("docs/new");

        Assert.Equal("docs/new", fake.CreateDirectoryPath);
    }

    // =====================================================================
    // Configurable return values.
    // =====================================================================

    [Fact]
    public void Browse_Returns_The_Configured_BrowseResult_Instance()
    {
        var dto = new BrowseResultDto("p", "parent", Array.Empty<FileEntryDto>(), 1, 2, 3L);
        var fake = new FakeFileService { BrowseResult = dto };

        Assert.Same(dto, fake.Browse("any"));
    }

    [Fact]
    public void Search_Returns_The_Configured_SearchResult_Instance()
    {
        var dto = new SearchResultDto("q", "p", Array.Empty<FileEntryDto>());
        var fake = new FakeFileService { SearchResult = dto };

        Assert.Same(dto, fake.Search("q", "p"));
    }

    [Fact]
    public void ResolveFullPath_Returns_The_Configured_ResolvedPath()
    {
        var fake = new FakeFileService { ResolvedPath = "/abs/resolved.txt" };

        Assert.Equal("/abs/resolved.txt", fake.ResolveFullPath("any"));
    }

    [Fact]
    public async Task UploadAsync_Returns_A_Successfully_Completed_Task_When_No_Fault()
    {
        var fake = new FakeFileService();
        var file = FormFileFactory.CreateFormFile("upload.txt", "payload");

        var task = fake.UploadAsync("docs", file);

        Assert.True(task.IsCompletedSuccessfully);
        await task; // awaiting must not throw or fault
    }

    // =====================================================================
    // Configurable faults.
    // =====================================================================

    [Fact]
    public void Browse_Throws_The_Configured_Exception_Instance()
    {
        var ex = new InvalidOperationException("browse-boom");
        var fake = new FakeFileService { BrowseException = ex };

        var thrown = Assert.Throws<InvalidOperationException>(() => fake.Browse("any"));
        Assert.Same(ex, thrown);
    }

    [Fact]
    public void Search_Throws_The_Configured_Exception_Instance()
    {
        var ex = new InvalidOperationException("search-boom");
        var fake = new FakeFileService { SearchException = ex };

        var thrown = Assert.Throws<InvalidOperationException>(() => fake.Search("q", "p"));
        Assert.Same(ex, thrown);
    }

    [Fact]
    public void ResolveFullPath_Throws_The_Configured_Exception_Instance()
    {
        var ex = new InvalidOperationException("resolve-boom");
        var fake = new FakeFileService { ResolveException = ex };

        var thrown = Assert.Throws<InvalidOperationException>(() => fake.ResolveFullPath("any"));
        Assert.Same(ex, thrown);
    }

    [Fact]
    public void UploadAsync_Throws_The_Configured_Exception_Synchronously()
    {
        // UploadAsync throws synchronously (it does not return a faulted task);
        // wrap the call in a void Action so xUnit's Throws(Action) overload —
        // not the obsolete Throws(Func<Task>) — asserts the synchronous throw.
        var ex = new InvalidOperationException("upload-boom");
        var fake = new FakeFileService { UploadException = ex };
        var file = FormFileFactory.CreateFormFile("upload.txt", "payload");

        var thrown = Assert.Throws<InvalidOperationException>(() =>
        {
            _ = fake.UploadAsync("docs", file);
        });
        Assert.Same(ex, thrown);
    }

    [Fact]
    public void Delete_Throws_The_Configured_Exception_Instance()
    {
        var ex = new InvalidOperationException("delete-boom");
        var fake = new FakeFileService { DeleteException = ex };

        var thrown = Assert.Throws<InvalidOperationException>(() => fake.Delete("any"));
        Assert.Same(ex, thrown);
    }

    [Fact]
    public void Move_Throws_The_Configured_Exception_Instance()
    {
        var ex = new InvalidOperationException("move-boom");
        var fake = new FakeFileService { MoveException = ex };

        var thrown = Assert.Throws<InvalidOperationException>(() => fake.Move(new MoveRequest("a", "b")));
        Assert.Same(ex, thrown);
    }

    [Fact]
    public void Copy_Throws_The_Configured_Exception_Instance()
    {
        var ex = new InvalidOperationException("copy-boom");
        var fake = new FakeFileService { CopyException = ex };

        var thrown = Assert.Throws<InvalidOperationException>(() => fake.Copy(new CopyRequest("a", "b")));
        Assert.Same(ex, thrown);
    }

    [Fact]
    public void CreateDirectory_Throws_The_Configured_Exception_Instance()
    {
        var ex = new InvalidOperationException("mkdir-boom");
        var fake = new FakeFileService { CreateDirectoryException = ex };

        var thrown = Assert.Throws<InvalidOperationException>(() => fake.CreateDirectory("any"));
        Assert.Same(ex, thrown);
    }

    // =====================================================================
    // Recording takes precedence observably: inputs are recorded *before*
    // the configured fault is thrown.
    // =====================================================================

    [Fact]
    public void Methods_Record_Their_Inputs_Even_When_Configured_To_Throw()
    {
        var browse = new FakeFileService { BrowseException = new InvalidOperationException() };
        Assert.Throws<InvalidOperationException>(() => browse.Browse("bp"));
        Assert.Equal("bp", browse.BrowsePath);

        var search = new FakeFileService { SearchException = new InvalidOperationException() };
        Assert.Throws<InvalidOperationException>(() => search.Search("q", "p"));
        Assert.Equal("q", search.SearchQuery);
        Assert.Equal("p", search.SearchPath);

        var resolve = new FakeFileService { ResolveException = new InvalidOperationException() };
        Assert.Throws<InvalidOperationException>(() => resolve.ResolveFullPath("rp"));
        Assert.Equal("rp", resolve.ResolvePath);

        var upload = new FakeFileService { UploadException = new InvalidOperationException() };
        var file = FormFileFactory.CreateFormFile("u.txt", "x");
        Assert.Throws<InvalidOperationException>(() =>
        {
            _ = upload.UploadAsync("ud", file);
        });
        Assert.Equal("ud", upload.UploadDirPath);
        Assert.Same(file, upload.UploadFile);

        var delete = new FakeFileService { DeleteException = new InvalidOperationException() };
        Assert.Throws<InvalidOperationException>(() => delete.Delete("dp"));
        Assert.Equal("dp", delete.DeletePath);

        var move = new FakeFileService { MoveException = new InvalidOperationException() };
        var moveReq = new MoveRequest("s", "d");
        Assert.Throws<InvalidOperationException>(() => move.Move(moveReq));
        Assert.Same(moveReq, move.MoveRequest);

        var copy = new FakeFileService { CopyException = new InvalidOperationException() };
        var copyReq = new CopyRequest("s", "d");
        Assert.Throws<InvalidOperationException>(() => copy.Copy(copyReq));
        Assert.Same(copyReq, copy.CopyRequest);

        var createDirectory = new FakeFileService { CreateDirectoryException = new InvalidOperationException() };
        Assert.Throws<InvalidOperationException>(() => createDirectory.CreateDirectory("cdp"));
        Assert.Equal("cdp", createDirectory.CreateDirectoryPath);
    }

    // =====================================================================
    // Instances are independent (guards against accidental `static` fields).
    // =====================================================================

    [Fact]
    public void Instances_Do_Not_Share_State()
    {
        var a = new FakeFileService
        {
            BrowseResult = new BrowseResultDto("a", null, Array.Empty<FileEntryDto>(), 0, 0, 0L),
            DeleteException = new InvalidOperationException(),
        };
        var b = new FakeFileService();

        Assert.NotSame(a.BrowseResult, b.BrowseResult);
        Assert.Null(b.DeleteException);

        b.Browse("from-b");

        Assert.Equal("from-b", b.BrowsePath);
        Assert.Null(a.BrowsePath);
        Assert.Null(b.DeleteException);
    }

    // =====================================================================
    // Helpers
    // =====================================================================

    private static void AssertMethod(string name, Type returnType, params Type[] parameterTypes)
    {
        var method = typeof(FakeFileService).GetMethod(name);
        Assert.NotNull(method);
        Assert.Equal(returnType, method!.ReturnType);
        var actualParameters = method.GetParameters().Select(p => p.ParameterType).ToArray();
        Assert.Equal(parameterTypes, actualParameters);
    }

}

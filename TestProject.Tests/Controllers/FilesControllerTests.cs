using System.Reflection;
using System.Text;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Infrastructure;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using TestProject.Controllers;
using TestProject.Models;
using TestProject.Services;
using Xunit;

namespace TestProject.Tests.Controllers;

/// <summary>
/// Behavioral tests for <see cref="FilesController"/>. Each test drives the
/// controller with a configurable <see cref="FakeFileService"/> and asserts
/// on the returned <see cref="IActionResult"/>: the happy paths verify that
/// the service is invoked with the normalized inputs and that the response
/// payload has the documented shape, while the error paths verify that the
/// five catch-and-translate exception types yield a 400 with the message.
///
/// The controller is exercised directly (not through the ASP.NET Core
/// pipeline) so model-binding attributes like <c>[FromQuery]</c> are not
/// applied; arguments are passed as ordinary method parameters.
/// </summary>
public class FilesControllerTests
{
    /// <summary>
    /// The five exception types the controller must catch and translate into
    /// a <c>BadRequest</c>. Note <see cref="DirectoryNotFoundException"/> and
    /// <see cref="FileNotFoundException"/> are <see cref="IOException"/>
    /// subtypes, but are enumerated explicitly to match the documented
    /// catch list.
    /// </summary>
    public static IEnumerable<object[]> CaughtExceptions()
    {
        yield return new object[] { new ArgumentException("arg-message") };
        yield return new object[] { new UnauthorizedAccessException("unauth-message") };
        yield return new object[] { new DirectoryNotFoundException("dir-message") };
        yield return new object[] { new FileNotFoundException("file-message") };
        yield return new object[] { new IOException("io-message") };
    }

    private static FilesController CreateController(FakeFileService service)
    {
        return new FilesController(service, NullLogger<FilesController>.Instance);
    }

    private static IFormFile CreateFormFile(string fileName, string content)
    {
        var bytes = Encoding.UTF8.GetBytes(content);
        var stream = new MemoryStream(bytes);
        return new FormFile(stream, 0, bytes.Length, "file", fileName);
    }

    private static object? GetProperty(object instance, string name)
    {
        var property = instance.GetType().GetProperty(name);
        Assert.NotNull(property);
        return property!.GetValue(instance);
    }

    // =====================================================================
    // Browse
    // =====================================================================

    [Fact]
    public void Browse_ReturnsOk200_WithServiceResult()
    {
        var dto = new BrowseResultDto("docs", "", Array.Empty<FileEntryDto>(), 0, 0, 0L);
        var fake = new FakeFileService { BrowseResult = dto };
        var controller = CreateController(fake);

        var actionResult = controller.Browse("docs");

        var ok = Assert.IsType<OkObjectResult>(actionResult.Result);
        Assert.Equal(StatusCodes.Status200OK, ok.StatusCode);
        Assert.Same(dto, ok.Value);
    }

    [Fact]
    public void Browse_PassesProvidedPathToService()
    {
        var fake = new FakeFileService();
        var controller = CreateController(fake);

        controller.Browse("docs/sub");

        Assert.Equal("docs/sub", fake.BrowsePath);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    public void Browse_PassesEmptyString_WhenPathIsNullOrEmpty(string? path)
    {
        var fake = new FakeFileService();
        var controller = CreateController(fake);

        controller.Browse(path);

        Assert.Equal(string.Empty, fake.BrowsePath);
    }

    [Theory]
    [MemberData(nameof(CaughtExceptions))]
    public void Browse_WhenServiceThrows_ReturnsBadRequest400_WithErrorMessage(Exception ex)
    {
        var fake = new FakeFileService { BrowseException = ex };
        var controller = CreateController(fake);

        var actionResult = controller.Browse("any");

        var badRequest = Assert.IsType<BadRequestObjectResult>(actionResult.Result);
        Assert.Equal(StatusCodes.Status400BadRequest, badRequest.StatusCode);
        Assert.Equal(ex.Message, GetProperty(badRequest.Value!, "error"));
    }

    // =====================================================================
    // Search
    // =====================================================================

    [Fact]
    public void Search_ReturnsOk200_WithServiceResult()
    {
        var dto = new SearchResultDto("report", "docs", Array.Empty<FileEntryDto>());
        var fake = new FakeFileService { SearchResult = dto };
        var controller = CreateController(fake);

        var actionResult = controller.Search("report", "docs");

        var ok = Assert.IsType<OkObjectResult>(actionResult.Result);
        Assert.Equal(StatusCodes.Status200OK, ok.StatusCode);
        Assert.Same(dto, ok.Value);
    }

    [Fact]
    public void Search_PassesQueryAndPathToService()
    {
        var fake = new FakeFileService();
        var controller = CreateController(fake);

        controller.Search("report", "docs");

        Assert.Equal("report", fake.SearchQuery);
        Assert.Equal("docs", fake.SearchPath);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    public void Search_PassesEmptyQuery_WhenQueryIsNullOrEmpty(string? query)
    {
        var fake = new FakeFileService();
        var controller = CreateController(fake);

        controller.Search(query!, "docs");

        Assert.Equal(string.Empty, fake.SearchQuery);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    public void Search_PassesEmptyPath_WhenPathIsNullOrEmpty(string? path)
    {
        var fake = new FakeFileService();
        var controller = CreateController(fake);

        controller.Search("report", path);

        Assert.Equal(string.Empty, fake.SearchPath);
    }

    [Theory]
    [MemberData(nameof(CaughtExceptions))]
    public void Search_WhenServiceThrows_ReturnsBadRequest400_WithErrorMessage(Exception ex)
    {
        var fake = new FakeFileService { SearchException = ex };
        var controller = CreateController(fake);

        var actionResult = controller.Search("q", "p");

        var badRequest = Assert.IsType<BadRequestObjectResult>(actionResult.Result);
        Assert.Equal(StatusCodes.Status400BadRequest, badRequest.StatusCode);
        Assert.Equal(ex.Message, GetProperty(badRequest.Value!, "error"));
    }

    // =====================================================================
    // Upload
    // =====================================================================

    [Fact]
    public async Task Upload_InvokesService_WithDirectoryAndFile()
    {
        var fake = new FakeFileService();
        var controller = CreateController(fake);
        var file = CreateFormFile("upload.txt", "payload");

        await controller.Upload("docs", file);

        Assert.Equal("docs", fake.UploadDirPath);
        Assert.Same(file, fake.UploadFile);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    public async Task Upload_PassesEmptyString_WhenPathIsNullOrEmpty(string? path)
    {
        var fake = new FakeFileService();
        var controller = CreateController(fake);
        var file = CreateFormFile("upload.txt", "payload");

        await controller.Upload(path, file);

        Assert.Equal(string.Empty, fake.UploadDirPath);
    }

    [Fact]
    public async Task Upload_ReturnsOk200_WithFileName_WhenPathIsEmpty()
    {
        var fake = new FakeFileService();
        var controller = CreateController(fake);
        var file = CreateFormFile("upload.txt", "payload");

        var result = await controller.Upload(string.Empty, file);

        var ok = Assert.IsType<OkObjectResult>(result);
        Assert.Equal(StatusCodes.Status200OK, ok.StatusCode);
        Assert.Equal("upload.txt", GetProperty(ok.Value!, "path"));
    }

    [Fact]
    public async Task Upload_ReturnsOk200_WithFileName_WhenPathIsNull()
    {
        var fake = new FakeFileService();
        var controller = CreateController(fake);
        var file = CreateFormFile("upload.txt", "payload");

        var result = await controller.Upload(null, file);

        var ok = Assert.IsType<OkObjectResult>(result);
        Assert.Equal("upload.txt", GetProperty(ok.Value!, "path"));
    }

    [Fact]
    public async Task Upload_ReturnsOk200_WithJoinedPath_WhenPathProvided()
    {
        var fake = new FakeFileService();
        var controller = CreateController(fake);
        var file = CreateFormFile("report.txt", "payload");

        var result = await controller.Upload("docs", file);

        var ok = Assert.IsType<OkObjectResult>(result);
        Assert.Equal("docs/report.txt", GetProperty(ok.Value!, "path"));
    }

    [Theory]
    [MemberData(nameof(CaughtExceptions))]
    public async Task Upload_WhenServiceThrows_ReturnsBadRequest400_WithErrorMessage(Exception ex)
    {
        var fake = new FakeFileService { UploadException = ex };
        var controller = CreateController(fake);
        var file = CreateFormFile("upload.txt", "payload");

        var result = await controller.Upload("docs", file);

        var badRequest = Assert.IsType<BadRequestObjectResult>(result);
        Assert.Equal(StatusCodes.Status400BadRequest, badRequest.StatusCode);
        Assert.Equal(ex.Message, GetProperty(badRequest.Value!, "error"));
    }

    // =====================================================================
    // Download
    // =====================================================================

    [Fact]
    public void Download_ReturnsPhysicalFileResult_WithResolvedPathAndContentType()
    {
        var resolved = Path.Combine(Path.GetTempPath(), "report.txt");
        var fake = new FakeFileService { ResolvedPath = resolved };
        var controller = CreateController(fake);

        var result = controller.Download("report.txt");

        var physical = Assert.IsType<PhysicalFileResult>(result);
        Assert.Equal(resolved, physical.FileName);
        // .txt is mapped to text/plain by the FileExtensionContentTypeProvider.
        Assert.Equal("text/plain", physical.ContentType);
        Assert.Equal("report.txt", physical.FileDownloadName);
    }

    [Fact]
    public void Download_PassesPathToResolveFullPath()
    {
        var fake = new FakeFileService { ResolvedPath = Path.Combine(Path.GetTempPath(), "x") };
        var controller = CreateController(fake);

        controller.Download("some/file.bin");

        Assert.Equal("some/file.bin", fake.ResolvePath);
    }

    [Fact]
    public void Download_UsesOctetStream_WhenContentTypeUnknown()
    {
        // An extension that is not in the well-known content-type map must
        // fall back to application/octet-stream.
        var resolved = Path.Combine(Path.GetTempPath(), "blob.zzzznotmapped");
        var fake = new FakeFileService { ResolvedPath = resolved };
        var controller = CreateController(fake);

        var result = controller.Download("blob.zzzznotmapped");

        var physical = Assert.IsType<PhysicalFileResult>(result);
        Assert.Equal("application/octet-stream", physical.ContentType);
        Assert.Equal(resolved, physical.FileName);
        Assert.Equal("blob.zzzznotmapped", physical.FileDownloadName);
    }

    [Theory]
    [MemberData(nameof(CaughtExceptions))]
    public void Download_WhenResolveThrows_ReturnsBadRequest400_WithErrorMessage(Exception ex)
    {
        var fake = new FakeFileService { ResolveException = ex };
        var controller = CreateController(fake);

        var result = controller.Download("any");

        var badRequest = Assert.IsType<BadRequestObjectResult>(result);
        Assert.Equal(StatusCodes.Status400BadRequest, badRequest.StatusCode);
        Assert.Equal(ex.Message, GetProperty(badRequest.Value!, "error"));
    }

    // =====================================================================
    // Delete
    // =====================================================================

    [Fact]
    public void Delete_ReturnsOk200_WithSuccessTrue()
    {
        var fake = new FakeFileService();
        var controller = CreateController(fake);

        var result = controller.Delete("file.txt");

        var ok = Assert.IsType<OkObjectResult>(result);
        Assert.Equal(StatusCodes.Status200OK, ok.StatusCode);
        Assert.Equal(true, GetProperty(ok.Value!, "success"));
    }

    [Fact]
    public void Delete_PassesPathToService()
    {
        var fake = new FakeFileService();
        var controller = CreateController(fake);

        controller.Delete("docs/file.txt");

        Assert.Equal("docs/file.txt", fake.DeletePath);
    }

    [Theory]
    [MemberData(nameof(CaughtExceptions))]
    public void Delete_WhenServiceThrows_ReturnsBadRequest400_WithErrorMessage(Exception ex)
    {
        var fake = new FakeFileService { DeleteException = ex };
        var controller = CreateController(fake);

        var result = controller.Delete("any");

        var badRequest = Assert.IsType<BadRequestObjectResult>(result);
        Assert.Equal(StatusCodes.Status400BadRequest, badRequest.StatusCode);
        Assert.Equal(ex.Message, GetProperty(badRequest.Value!, "error"));
    }

    // =====================================================================
    // Move
    // =====================================================================

    [Fact]
    public void Move_ReturnsOk200_WithSuccessTrue()
    {
        var fake = new FakeFileService();
        var controller = CreateController(fake);

        var result = controller.Move(new MoveRequest("a.txt", "b.txt"));

        var ok = Assert.IsType<OkObjectResult>(result);
        Assert.Equal(StatusCodes.Status200OK, ok.StatusCode);
        Assert.Equal(true, GetProperty(ok.Value!, "success"));
    }

    [Fact]
    public void Move_ForwardsRequestObjectToService()
    {
        var fake = new FakeFileService();
        var controller = CreateController(fake);
        var request = new MoveRequest("src/a.txt", "dst/a.txt");

        controller.Move(request);

        Assert.Equal(request, fake.MoveRequest);
    }

    [Theory]
    [MemberData(nameof(CaughtExceptions))]
    public void Move_WhenServiceThrows_ReturnsBadRequest400_WithErrorMessage(Exception ex)
    {
        var fake = new FakeFileService { MoveException = ex };
        var controller = CreateController(fake);

        var result = controller.Move(new MoveRequest("a", "b"));

        var badRequest = Assert.IsType<BadRequestObjectResult>(result);
        Assert.Equal(StatusCodes.Status400BadRequest, badRequest.StatusCode);
        Assert.Equal(ex.Message, GetProperty(badRequest.Value!, "error"));
    }

    // =====================================================================
    // Copy
    // =====================================================================

    [Fact]
    public void Copy_ReturnsOk200_WithSuccessTrue()
    {
        var fake = new FakeFileService();
        var controller = CreateController(fake);

        var result = controller.Copy(new CopyRequest("a.txt", "b.txt"));

        var ok = Assert.IsType<OkObjectResult>(result);
        Assert.Equal(StatusCodes.Status200OK, ok.StatusCode);
        Assert.Equal(true, GetProperty(ok.Value!, "success"));
    }

    [Fact]
    public void Copy_ForwardsRequestObjectToService()
    {
        var fake = new FakeFileService();
        var controller = CreateController(fake);
        var request = new CopyRequest("src/a.txt", "backup/a.txt");

        controller.Copy(request);

        Assert.Equal(request, fake.CopyRequest);
    }

    [Theory]
    [MemberData(nameof(CaughtExceptions))]
    public void Copy_WhenServiceThrows_ReturnsBadRequest400_WithErrorMessage(Exception ex)
    {
        var fake = new FakeFileService { CopyException = ex };
        var controller = CreateController(fake);

        var result = controller.Copy(new CopyRequest("a", "b"));

        var badRequest = Assert.IsType<BadRequestObjectResult>(result);
        Assert.Equal(StatusCodes.Status400BadRequest, badRequest.StatusCode);
        Assert.Equal(ex.Message, GetProperty(badRequest.Value!, "error"));
    }

    // =====================================================================
    // A non-translated exception must propagate (not be swallowed as 400).
    // =====================================================================

    [Fact]
    public void Controller_DoesNotSwallowUnhandledExceptions()
    {
        var fake = new FakeFileService { DeleteException = new InvalidOperationException("boom") };
        var controller = CreateController(fake);

        Assert.Throws<InvalidOperationException>(() => controller.Delete("any"));
    }
}

/// <summary>
/// Recording double for <see cref="IFileService"/>. Each method stashes the
/// arguments it was called with and either returns a configurable value or
/// throws a configurable exception, giving each test full control over the
/// service's behavior while keeping the double trivially inspectable.
/// </summary>
internal sealed class FakeFileService : IFileService
{
    // ----- recorded inputs -----
    public string? BrowsePath;
    public string? SearchQuery;
    public string? SearchPath;
    public string? ResolvePath;
    public string? UploadDirPath;
    public IFormFile? UploadFile;
    public string? DeletePath;
    public MoveRequest? MoveRequest;
    public CopyRequest? CopyRequest;

    // ----- configurable outputs / faults -----
    public BrowseResultDto BrowseResult = new(string.Empty, null, Array.Empty<FileEntryDto>(), 0, 0, 0L);
    public SearchResultDto SearchResult = new(string.Empty, string.Empty, Array.Empty<FileEntryDto>());
    public string ResolvedPath = string.Empty;
    public Exception? BrowseException;
    public Exception? SearchException;
    public Exception? ResolveException;
    public Exception? UploadException;
    public Exception? DeleteException;
    public Exception? MoveException;
    public Exception? CopyException;

    public BrowseResultDto Browse(string relativePath)
    {
        BrowsePath = relativePath;
        if (BrowseException is not null) throw BrowseException;
        return BrowseResult;
    }

    public SearchResultDto Search(string query, string relativePath)
    {
        SearchQuery = query;
        SearchPath = relativePath;
        if (SearchException is not null) throw SearchException;
        return SearchResult;
    }

    public string ResolveFullPath(string relativePath)
    {
        ResolvePath = relativePath;
        if (ResolveException is not null) throw ResolveException;
        return ResolvedPath;
    }

    public Task UploadAsync(string relativeDirPath, IFormFile file)
    {
        UploadDirPath = relativeDirPath;
        UploadFile = file;
        if (UploadException is not null) throw UploadException;
        return Task.CompletedTask;
    }

    public void Delete(string relativePath)
    {
        DeletePath = relativePath;
        if (DeleteException is not null) throw DeleteException;
    }

    public void Move(MoveRequest request)
    {
        MoveRequest = request;
        if (MoveException is not null) throw MoveException;
    }

    public void Copy(CopyRequest request)
    {
        CopyRequest = request;
        if (CopyException is not null) throw CopyException;
    }
}

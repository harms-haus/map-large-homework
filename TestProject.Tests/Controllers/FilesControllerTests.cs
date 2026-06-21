using System.Reflection;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Infrastructure;
using TestProject.Controllers;
using TestProject.Models;
using TestProject.Services;
using TestProject.Tests.TestHelpers;
using Xunit;

namespace TestProject.Tests.Controllers;

/// <summary>
/// Behavioral tests for <see cref="FilesController"/>. Each test drives the
/// controller with a configurable <see cref="FakeFileService"/> and asserts
/// on the returned <see cref="IActionResult"/>: the happy paths verify that
/// the service is invoked with the normalized inputs and that the response
/// payload has the documented shape, while the error paths verify that the
/// translated exception types yield their mapped HTTP status
/// (400/403/404/409/500) with the message.
///
/// The controller is exercised directly (not through the ASP.NET Core
/// pipeline) so model-binding attributes like <c>[FromQuery]</c> are not
/// applied; arguments are passed as ordinary method parameters.
/// </summary>
public class FilesControllerTests
{
    /// <summary>
    /// The exception types the controller translates, paired with the status
    /// each maps to. Subtypes precede the generic <see cref="IOException"/>
    /// catch-all.
    /// </summary>
    public static IEnumerable<object[]> TranslatedCases()
    {
        // 400 — bad input (ArgumentException and its subtypes; PathTooLong).
        yield return new object[] { new ArgumentException("arg-message"), StatusCodes.Status400BadRequest };
        yield return new object[] { new ArgumentNullException("p", "argnull-message"), StatusCodes.Status400BadRequest };
        yield return new object[] { new ArgumentOutOfRangeException("p", "argoor-message"), StatusCodes.Status400BadRequest };
        yield return new object[] { new PathTooLongException("pathtoolong-message"), StatusCodes.Status400BadRequest };

        // 403 — forbidden.
        yield return new object[] { new UnauthorizedAccessException("unauth-message"), StatusCodes.Status403Forbidden };

        // 404 — IOException subtypes carved out before the generic IOException arm.
        yield return new object[] { new FileNotFoundException("file-message"), StatusCodes.Status404NotFound };
        yield return new object[] { new DirectoryNotFoundException("dir-message"), StatusCodes.Status404NotFound };

        // 409 — collision.
        yield return new object[] { new ConflictException("conflict-message"), StatusCodes.Status409Conflict };

        // 500 — the catch-all IOException arm. EndOfStream/FileLoad are
        // IOException subtypes not carved out above.
        yield return new object[] { new IOException("io-message"), StatusCodes.Status500InternalServerError };
        yield return new object[] { new EndOfStreamException("endofstream-message"), StatusCodes.Status500InternalServerError };
        yield return new object[] { new FileLoadException("fileload-message"), StatusCodes.Status500InternalServerError };
    }

    private static FilesController CreateController(FakeFileService service)
    {
        return new FilesController(service);
    }

    private static object? GetProperty(object instance, string name)
    {
        var property = instance.GetType().GetProperty(name);
        Assert.NotNull(property);
        return property!.GetValue(instance);
    }

    /// <summary>Casts to <see cref="ObjectResult"/>. Every status the
    /// controller returns (400/403/404/409/500) derives from it, so status and
    /// the <c>{ error }</c> body assert uniformly. Uses <c>as</c> rather than
    /// <see cref="Assert.IsType{T}"/> to accept the derived result types.</summary>
    private static ObjectResult AsObjectResult(IActionResult result)
    {
        var objectResult = result as ObjectResult;
        Assert.NotNull(objectResult);
        return objectResult!;
    }

    /// <summary>
    /// Asserts that <paramref name="value"/> exposes exactly one public
    /// property, named <paramref name="expectedName"/>, and returns it for
    /// further type/value assertions. Used to pin the *exact* payload shape
    /// of the Ok/BadRequest anonymous bodies against added, renamed, dropped,
    /// or retyped fields.
    /// </summary>
    private static PropertyInfo AssertSingleProperty(object value, string expectedName)
    {
        var property = Assert.Single(value.GetType().GetProperties());
        Assert.Equal(expectedName, property.Name);
        return property;
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
    [MemberData(nameof(TranslatedCases))]
    public void Browse_WhenServiceThrows_ReturnsTranslatedStatus_WithErrorMessage(Exception ex, int expectedStatus)
    {
        var fake = new FakeFileService { BrowseException = ex };
        var controller = CreateController(fake);

        var actionResult = controller.Browse("any");

        var objectResult = AsObjectResult(actionResult.Result);
        Assert.Equal(expectedStatus, objectResult.StatusCode);
        Assert.Equal(ex.Message, GetProperty(objectResult.Value!, "error"));
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
    [MemberData(nameof(TranslatedCases))]
    public void Search_WhenServiceThrows_ReturnsTranslatedStatus_WithErrorMessage(Exception ex, int expectedStatus)
    {
        var fake = new FakeFileService { SearchException = ex };
        var controller = CreateController(fake);

        var actionResult = controller.Search("q", "p");

        var objectResult = AsObjectResult(actionResult.Result);
        Assert.Equal(expectedStatus, objectResult.StatusCode);
        Assert.Equal(ex.Message, GetProperty(objectResult.Value!, "error"));
    }

    // =====================================================================
    // Upload
    // =====================================================================

    [Fact]
    public async Task Upload_InvokesService_WithDirectoryAndFile()
    {
        var fake = new FakeFileService();
        var controller = CreateController(fake);
        var file = FormFileFactory.CreateFormFile("upload.txt", "payload");

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
        var file = FormFileFactory.CreateFormFile("upload.txt", "payload");

        await controller.Upload(path, file);

        Assert.Equal(string.Empty, fake.UploadDirPath);
    }

    // The happy-path "Upload returns 200 echoing the service value" contract is
    // pinned by the parameterized Upload_ResponsePath_EchoesServiceReturnValue_
    // VerbatimWithoutNormalization test below (it asserts Status200OK + verbatim
    // echo across clean and non-canonical service return values). Per-test
    // variants for empty/null/provided *query* paths add no coverage here because
    // after the refactor the query path no longer influences the response at all —
    // it is forwarded to the service verbatim (pinned by
    // Upload_PassesEmptyString_WhenPathIsNullOrEmpty and
    // Upload_PassesRawPathToService_EvenWhenNonCanonical).

    [Theory]
    [MemberData(nameof(TranslatedCases))]
    public async Task Upload_WhenServiceThrows_ReturnsTranslatedStatus_WithErrorMessage(Exception ex, int expectedStatus)
    {
        var fake = new FakeFileService { UploadException = ex };
        var controller = CreateController(fake);
        var file = FormFileFactory.CreateFormFile("upload.txt", "payload");

        var result = await controller.Upload("docs", file);

        var objectResult = AsObjectResult(result);
        Assert.Equal(expectedStatus, objectResult.StatusCode);
        Assert.Equal(ex.Message, GetProperty(objectResult.Value!, "error"));
    }

    // =====================================================================
    // Upload response path sourcing
    //
    // The Upload endpoint's response `path` is the value returned by
    // IFileService.UploadAsync — the service is the single source of truth for
    // the stored file's normalized relative path. The controller must echo
    // that value VERBATIM: it must not re-normalize, strip, backslash-convert,
    // or otherwise mutate the service's return value (the previous
    // controller-side NormalizeRelativePath helper has been removed). These
    // tests pin the echo contract; the normalization itself is now pinned at
    // the service layer in FileServiceTests.
    // =====================================================================

    [Theory]
    [InlineData("docs/report.txt")]
    [InlineData("a/b/c/report.txt")]
    [InlineData("report.txt")]
    [InlineData("docs\\sub\\report.txt")]   // value the OLD controller would have converted to forward slashes
    [InlineData("/docs/report.txt")]        // value the OLD controller would have leading-trimmed
    [InlineData("docs//report.txt")]        // value the OLD controller would have collapsed
    [InlineData("../escape/report.txt")]    // value the OLD controller would have dot-stripped
    [InlineData("")]                        // the service may legitimately return an empty path
    public async Task Upload_ResponsePath_EchoesServiceReturnValue_VerbatimWithoutNormalization(string storedPath)
    {
        // Whatever the service returns must reach the response body unchanged.
        // This proves the controller performs NO path normalization of its own;
        // the service return value is the single source of truth. Had the
        // controller kept a NormalizeRelativePath step, the backslash / leading
        // slash / repeated slash / ".." cases below would be rewritten and this
        // assertion would fail.
        var fake = new FakeFileService { UploadedPath = storedPath };
        var controller = CreateController(fake);
        var file = FormFileFactory.CreateFormFile("report.txt", "payload");

        var result = await controller.Upload("any/dir", file);

        var ok = Assert.IsType<OkObjectResult>(result);
        Assert.Equal(StatusCodes.Status200OK, ok.StatusCode);
        Assert.Equal(storedPath, GetProperty(ok.Value!, "path"));
    }

    [Theory]
    [InlineData("docs\\sub")]
    [InlineData("/docs/")]
    [InlineData("./docs")]
    [InlineData("docs/../sub")]
    [InlineData("//docs//sub//")]
    public async Task Upload_PassesRawPathToService_EvenWhenNonCanonical(string path)
    {
        // The service call must NOT be normalized at the controller layer: it
        // still receives the raw query value so its own SafeResolve can sandbox
        // the path. (The response path is sourced from the service's return
        // value, never reconstructed/normalized by the controller.)
        var fake = new FakeFileService();
        var controller = CreateController(fake);
        var file = FormFileFactory.CreateFormFile("report.txt", "payload");

        await controller.Upload(path, file);

        Assert.Equal(path, fake.UploadDirPath);
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

    [Theory]
    [MemberData(nameof(TranslatedCases))]
    public void Download_WhenResolveThrows_ReturnsTranslatedStatus_WithErrorMessage(Exception ex, int expectedStatus)
    {
        var fake = new FakeFileService { ResolveException = ex };
        var controller = CreateController(fake);

        var result = controller.Download("any");

        var objectResult = AsObjectResult(result);
        Assert.Equal(expectedStatus, objectResult.StatusCode);
        Assert.Equal(ex.Message, GetProperty(objectResult.Value!, "error"));
    }

    // The Download endpoint derives the response content type from the
    // extension of the *resolved* full path via a FileExtensionContentTypeProvider.
    // The provider's mapping is immutable and the controller must not alter it,
    // so the following characterization tests pin down the exact content-type
    // resolution (known extensions, case-insensitivity, the octet-stream
    // fallback and determinism across calls).

    [Theory]
    [InlineData(".txt", "text/plain")]
    [InlineData(".html", "text/html")]
    [InlineData(".css", "text/css")]
    [InlineData(".json", "application/json")]
    [InlineData(".png", "image/png")]
    [InlineData(".jpg", "image/jpeg")]
    [InlineData(".gif", "image/gif")]
    [InlineData(".pdf", "application/pdf")]
    [InlineData(".svg", "image/svg+xml")]
    [InlineData(".csv", "text/csv")]
    public void Download_ReturnsExpectedContentType_ForKnownExtensions(
        string extension, string expectedContentType)
    {
        // The content type is derived from the extension of the *resolved*
        // path, not the inbound relative path.
        var resolved = Path.Combine(Path.GetTempPath(), "file" + extension);
        var fake = new FakeFileService { ResolvedPath = resolved };
        var controller = CreateController(fake);

        var result = controller.Download("file" + extension);

        var physical = Assert.IsType<PhysicalFileResult>(result);
        Assert.Equal(expectedContentType, physical.ContentType);
    }

    [Theory]
    [InlineData(".TXT", "text/plain")]
    [InlineData(".PDF", "application/pdf")]
    [InlineData(".PnG", "image/png")]
    public void Download_ResolvesContentTypeCaseInsensitively(
        string extension, string expectedContentType)
    {
        // FileExtensionContentTypeProvider matches extensions
        // case-insensitively by default; the controller must preserve that.
        var resolved = Path.Combine(Path.GetTempPath(), "FILE" + extension);
        var fake = new FakeFileService { ResolvedPath = resolved };
        var controller = CreateController(fake);

        var result = controller.Download("FILE" + extension);

        var physical = Assert.IsType<PhysicalFileResult>(result);
        Assert.Equal(expectedContentType, physical.ContentType);
    }

    [Theory]
    [InlineData(".zzzznotmapped")]
    [InlineData(".unknownext")]
    [InlineData(".xyz123abc")]
    public void Download_UsesOctetStream_ForVariousUnknownExtensions(string extension)
    {
        // Any extension absent from the default map must fall back to the
        // documented application/octet-stream default.
        var resolved = Path.Combine(Path.GetTempPath(), "blob" + extension);
        var fake = new FakeFileService { ResolvedPath = resolved };
        var controller = CreateController(fake);

        var result = controller.Download("blob" + extension);

        var physical = Assert.IsType<PhysicalFileResult>(result);
        Assert.Equal("application/octet-stream", physical.ContentType);
    }

    [Fact]
    public void Download_UsesOctetStream_WhenFileHasNoExtension()
    {
        // A file name with no extension is absent from the content-type map, so
        // it must fall back to application/octet-stream. This is the one
        // fallback edge case not covered by the unknown-extension theories
        // above (all of which pass a file *with* an extension). Pins the
        // fallback value that the refactor extracts to DefaultContentType.
        var resolved = Path.Combine(Path.GetTempPath(), "README");
        var fake = new FakeFileService { ResolvedPath = resolved };
        var controller = CreateController(fake);

        var result = controller.Download("README");

        var physical = Assert.IsType<PhysicalFileResult>(result);
        Assert.Equal("application/octet-stream", physical.ContentType);
        Assert.Equal(resolved, physical.FileName);
        Assert.Equal("README", physical.FileDownloadName);
    }

    [Fact]
    public void Download_ReturnsConsistentContentType_AcrossRepeatedCalls()
    {
        // A cached/shared provider must yield identical results on every call;
        // repeated resolution of the same extension must not drift (guards
        // against any accidental introduction of shared mutable state).
        var resolved = Path.Combine(Path.GetTempPath(), "report.pdf");
        var fake = new FakeFileService { ResolvedPath = resolved };
        var controller = CreateController(fake);

        var first = Assert.IsType<PhysicalFileResult>(controller.Download("report.pdf"));
        var second = Assert.IsType<PhysicalFileResult>(controller.Download("report.pdf"));

        Assert.Equal("application/pdf", first.ContentType);
        Assert.Equal(first.ContentType, second.ContentType);
    }

    [Fact]
    public void Download_ReturnsConsistentContentType_AcrossControllerInstances()
    {
        // Content-type derivation must depend only on the file extension, not
        // on which controller instance serves the request.
        var resolved = Path.Combine(Path.GetTempPath(), "image.png");
        var controllerA = CreateController(new FakeFileService { ResolvedPath = resolved });
        var controllerB = CreateController(new FakeFileService { ResolvedPath = resolved });

        var fromA = Assert.IsType<PhysicalFileResult>(controllerA.Download("image.png"));
        var fromB = Assert.IsType<PhysicalFileResult>(controllerB.Download("image.png"));

        Assert.Equal("image/png", fromA.ContentType);
        Assert.Equal(fromA.ContentType, fromB.ContentType);
    }

    [Fact]
    public void Download_DerivesContentTypeFromExtensionInResolvedPath_AndSetsLeafFileName()
    {
        // When the resolved full path contains subdirectories, the content
        // type is still derived from the leaf extension and the download name
        // is the leaf file name only (Path.GetFileName of the full path).
        var resolved = Path.Combine(Path.GetTempPath(), "sub", "dir", "data.json");
        var fake = new FakeFileService { ResolvedPath = resolved };
        var controller = CreateController(fake);

        var result = controller.Download("sub/dir/data.json");

        var physical = Assert.IsType<PhysicalFileResult>(result);
        Assert.Equal("application/json", physical.ContentType);
        Assert.Equal(resolved, physical.FileName);
        Assert.Equal("data.json", physical.FileDownloadName);
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
    [MemberData(nameof(TranslatedCases))]
    public void Delete_WhenServiceThrows_ReturnsTranslatedStatus_WithErrorMessage(Exception ex, int expectedStatus)
    {
        var fake = new FakeFileService { DeleteException = ex };
        var controller = CreateController(fake);

        var result = controller.Delete("any");

        var objectResult = AsObjectResult(result);
        Assert.Equal(expectedStatus, objectResult.StatusCode);
        Assert.Equal(ex.Message, GetProperty(objectResult.Value!, "error"));
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
    [MemberData(nameof(TranslatedCases))]
    public void Move_WhenServiceThrows_ReturnsTranslatedStatus_WithErrorMessage(Exception ex, int expectedStatus)
    {
        var fake = new FakeFileService { MoveException = ex };
        var controller = CreateController(fake);

        var result = controller.Move(new MoveRequest("a", "b"));

        var objectResult = AsObjectResult(result);
        Assert.Equal(expectedStatus, objectResult.StatusCode);
        Assert.Equal(ex.Message, GetProperty(objectResult.Value!, "error"));
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
    [MemberData(nameof(TranslatedCases))]
    public void Copy_WhenServiceThrows_ReturnsTranslatedStatus_WithErrorMessage(Exception ex, int expectedStatus)
    {
        var fake = new FakeFileService { CopyException = ex };
        var controller = CreateController(fake);

        var result = controller.Copy(new CopyRequest("a", "b"));

        var objectResult = AsObjectResult(result);
        Assert.Equal(expectedStatus, objectResult.StatusCode);
        Assert.Equal(ex.Message, GetProperty(objectResult.Value!, "error"));
    }

    // =====================================================================
    // Create directory
    // =====================================================================

    [Fact]
    public void CreateDirectory_ReturnsOk200_WithSuccessTrue()
    {
        var fake = new FakeFileService();
        var controller = CreateController(fake);

        var result = controller.CreateDirectory("docs/new");

        var ok = Assert.IsType<OkObjectResult>(result);
        Assert.Equal(StatusCodes.Status200OK, ok.StatusCode);
        Assert.Equal(true, GetProperty(ok.Value!, "success"));
    }

    [Fact]
    public void CreateDirectory_PassesPathToService()
    {
        var fake = new FakeFileService();
        var controller = CreateController(fake);

        controller.CreateDirectory("docs/sub/new");

        Assert.Equal("docs/sub/new", fake.CreateDirectoryPath);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    public void CreateDirectory_PassesEmptyString_WhenPathIsNullOrEmpty(string? path)
    {
        // A missing/empty path must reach the service as the empty string
        // (the home root itself), never as null — the service is not nullable.
        var fake = new FakeFileService();
        var controller = CreateController(fake);

        controller.CreateDirectory(path);

        Assert.Equal(string.Empty, fake.CreateDirectoryPath);
    }

    [Theory]
    [InlineData("docs\\sub")]
    [InlineData("/docs/")]
    [InlineData("./docs")]
    [InlineData("docs/../sub")]
    [InlineData("//docs//sub//")]
    public void CreateDirectory_PassesRawPathToService_EvenWhenNonCanonical(string path)
    {
        // The service call must NOT be normalized at the controller layer: it
        // still receives the raw query value so its own SafeResolve can sandbox
        // the path. (CreateDirectory returns only { success }, so there is no
        // response-path normalization to pin here, unlike Upload.)
        var fake = new FakeFileService();
        var controller = CreateController(fake);

        controller.CreateDirectory(path);

        Assert.Equal(path, fake.CreateDirectoryPath);
    }

    [Theory]
    [MemberData(nameof(TranslatedCases))]
    public void CreateDirectory_WhenServiceThrows_ReturnsTranslatedStatus_WithErrorMessage(Exception ex, int expectedStatus)
    {
        var fake = new FakeFileService { CreateDirectoryException = ex };
        var controller = CreateController(fake);

        var result = controller.CreateDirectory("any");

        var objectResult = AsObjectResult(result);
        Assert.Equal(expectedStatus, objectResult.StatusCode);
        Assert.Equal(ex.Message, GetProperty(objectResult.Value!, "error"));
    }

    // =====================================================================
    // Non-translated exceptions must propagate from EVERY endpoint.
    //
    // The shared Execute/ExecuteAsync helper must not widen the catch list —
    // a stray `catch (Exception ex)` or `when (...)` filter, or catching a
    // base type too eagerly, would silently turn every fault into a translated response.
    // Only Delete is covered above; the tests below pin the same "unhandled
    // exception bubbles out" guarantee for the remaining six endpoints.
    //
    // The Upload case is async on purpose: the async helper must await the
    // body rather than unwrap via `.Result`/`.Wait()`, which would surface
    // the throw as `AggregateException` instead of the
    // `InvalidOperationException` the assertion expects.
    // =====================================================================

    [Fact]
    public void Browse_DoesNotSwallowUnhandledExceptions()
    {
        var fake = new FakeFileService { BrowseException = new InvalidOperationException("boom") };
        var controller = CreateController(fake);

        Assert.Throws<InvalidOperationException>(() => controller.Browse("any"));
    }

    [Fact]
    public void Search_DoesNotSwallowUnhandledExceptions()
    {
        var fake = new FakeFileService { SearchException = new InvalidOperationException("boom") };
        var controller = CreateController(fake);

        Assert.Throws<InvalidOperationException>(() => controller.Search("q", "p"));
    }

    [Fact]
    public async Task Upload_DoesNotSwallowUnhandledExceptions()
    {
        var fake = new FakeFileService { UploadException = new InvalidOperationException("boom") };
        var controller = CreateController(fake);
        var file = FormFileFactory.CreateFormFile("upload.txt", "payload");

        await Assert.ThrowsAsync<InvalidOperationException>(() => controller.Upload("docs", file));
    }

    [Fact]
    public void Download_DoesNotSwallowUnhandledExceptions()
    {
        var fake = new FakeFileService { ResolveException = new InvalidOperationException("boom") };
        var controller = CreateController(fake);

        Assert.Throws<InvalidOperationException>(() => controller.Download("any"));
    }

    [Fact]
    public void Move_DoesNotSwallowUnhandledExceptions()
    {
        var fake = new FakeFileService { MoveException = new InvalidOperationException("boom") };
        var controller = CreateController(fake);

        Assert.Throws<InvalidOperationException>(() => controller.Move(new MoveRequest("a", "b")));
    }

    [Fact]
    public void Copy_DoesNotSwallowUnhandledExceptions()
    {
        var fake = new FakeFileService { CopyException = new InvalidOperationException("boom") };
        var controller = CreateController(fake);

        Assert.Throws<InvalidOperationException>(() => controller.Copy(new CopyRequest("a", "b")));
    }

    [Fact]
    public void CreateDirectory_DoesNotSwallowUnhandledExceptions()
    {
        var fake = new FakeFileService { CreateDirectoryException = new InvalidOperationException("boom") };
        var controller = CreateController(fake);

        Assert.Throws<InvalidOperationException>(() => controller.CreateDirectory("any"));
    }

    // =====================================================================
    // Error payload shape: each translated exception must yield a 400 whose
    // body is *exactly* `{ error: <message> }` — a single property, no more.
    // The per-endpoint tests above read `GetProperty(value, "error")` to
    // check the value, but never assert that `error` is the *only* field.
    // These pin the exact shape.
    // =====================================================================

    [Fact]
    public void BadRequest_PayloadHasExactlyOneStringPropertyNamedError()
    {
        var fake = new FakeFileService { DeleteException = new ArgumentException("arg-message") };
        var controller = CreateController(fake);

        var result = controller.Delete("any");

        var badRequest = Assert.IsType<BadRequestObjectResult>(result);
        Assert.NotNull(badRequest.Value);
        var property = AssertSingleProperty(badRequest.Value!, "error");
        Assert.Equal(typeof(string), property.PropertyType);
        Assert.Equal("arg-message", property.GetValue(badRequest.Value));
    }

    [Theory]
    [InlineData("simple message")]
    [InlineData("")]
    [InlineData("message with 'quotes' and \"double quotes\"")]
    [InlineData("multi\nline\nmessage")]
    [InlineData("Unicode: café ☕ 日本語")]
    [InlineData("<script>alert('xss')</script>")]
    [InlineData("path with /slashes/ and\\backslashes")]
    public void BadRequest_PreservesExceptionMessageVerbatim(string message)
    {
        // The message is copied into the { error } body verbatim; the
        // serializer handles encoding downstream. Built identically in every
        // status arm — asserted against the 400 path.
        var fake = new FakeFileService { DeleteException = new ArgumentException(message) };
        var controller = CreateController(fake);

        var result = controller.Delete("any");

        var badRequest = Assert.IsType<BadRequestObjectResult>(result);
        Assert.Equal(message, GetProperty(badRequest.Value!, "error"));
    }

    // =====================================================================
    // Exception-translation consolidation contract.
    //
    // Execute (sync) and ExecuteAsync (async) share one TranslateException.
    // The tests below pin: inheritance matching for non-BCL derived types, the
    // catch-list boundary (no widening), and sync/async parity.
    // =====================================================================

    [Theory]
    [MemberData(nameof(CustomTranslatedSubclasses))]
    public void Translate_CatchesNonBclSubclasses_ByInheritance(Exception ex, int expectedStatus)
    {
        // Matching is by inheritance, not exact runtime type.
        var fake = new FakeFileService { DeleteException = ex };
        var controller = CreateController(fake);

        var objectResult = AsObjectResult(controller.Delete("any"));

        Assert.Equal(expectedStatus, objectResult.StatusCode);
        Assert.Equal(ex.Message, GetProperty(objectResult.Value!, "error"));
    }

    public static IEnumerable<object[]> CustomTranslatedSubclasses()
    {
        // CustomIOException falls through to the generic IOException arm → 500;
        // CustomArgumentException inherits the ArgumentException arm → 400.
        yield return new object[] { new CustomIOException("custom-io"), StatusCodes.Status500InternalServerError };
        yield return new object[] { new CustomArgumentException("custom-arg"), StatusCodes.Status400BadRequest };
    }

    [Theory]
    [MemberData(nameof(NonTranslatedExceptions))]
    public void Translate_PropagatesExceptionsOutsideTheTranslatedRoots(Exception ex)
    {
        // Widening the catch list would silently translate these into responses
        // and hide real faults. Each surfaces as the exact instance thrown,
        // unwrapped (no TargetInvocation/Aggregate wrapping).
        var fake = new FakeFileService { DeleteException = ex };
        var controller = CreateController(fake);

        var thrown = Record.Exception(() => controller.Delete("any"));

        Assert.Same(ex, thrown);
    }

    public static IEnumerable<object[]> NonTranslatedExceptions()
    {
        // Siblings of the translated roots under SystemException, plus other
        // common runtime faults and a plain Exception subclass — none of these
        // is assignable to ArgumentException, UnauthorizedAccessException or
        // IOException, so all must propagate.
        yield return new object[] { new NotImplementedException("not-impl") };
        yield return new object[] { new TimeoutException("timeout") };
        yield return new object[] { new NullReferenceException("nre") };
        yield return new object[] { new FormatException("fmt") };
        yield return new object[] { new KeyNotFoundException("key") };
        yield return new object[] { new DivideByZeroException("dbz") };
        yield return new object[] { new IndexOutOfRangeException("ior") };
        yield return new object[] { new NotSupportedException("nse") };
        yield return new object[] { new CustomException("custom-untranslated") };
    }

    [Theory]
    [MemberData(nameof(TranslatedRoots))]
    public async Task SyncAndAsyncHelpers_TranslateTheSameExceptionIdentically(Exception ex, int expectedStatus)
    {
        // The sync and async paths share TranslateException; both must agree
        // on status and message for every root and a representative subtype.
        var syncController = CreateController(new FakeFileService { DeleteException = ex });
        var asyncController = CreateController(new FakeFileService { UploadException = ex });

        var syncResult = AsObjectResult(syncController.Delete("any"));
        var asyncResult = AsObjectResult(await asyncController.Upload(
            "any", FormFileFactory.CreateFormFile("f.txt", "x")));

        Assert.Equal(expectedStatus, syncResult.StatusCode);
        Assert.Equal(expectedStatus, asyncResult.StatusCode);
        Assert.Equal(ex.Message, GetProperty(syncResult.Value!, "error"));
        Assert.Equal(ex.Message, GetProperty(asyncResult.Value!, "error"));
    }

    public static IEnumerable<object[]> TranslatedRoots()
    {
        // One root plus a representative subtype each, paired with its status.
        yield return new object[] { new ArgumentException("arg"), StatusCodes.Status400BadRequest };
        yield return new object[] { new UnauthorizedAccessException("unauth"), StatusCodes.Status403Forbidden };
        yield return new object[] { new IOException("io"), StatusCodes.Status500InternalServerError };
        yield return new object[] { new ArgumentNullException("p", "argnull"), StatusCodes.Status400BadRequest };
        yield return new object[] { new PathTooLongException("ptl"), StatusCodes.Status400BadRequest };
    }

    // =====================================================================
    // Success-payload shape for the Ok bodies.
    //
    // Delete/Move/Copy return Ok(new { success = true }) and Upload returns
    // Ok(new { path = ... }). The happy-path tests read individual properties
    // but never assert that the property set is *exactly* { success } or
    // { path }. These pin the exact single-field shape and types.
    // =====================================================================

    [Fact]
    public void Delete_SuccessPayload_HasExactlyOneBooleanPropertyNamedSuccess()
    {
        var fake = new FakeFileService();
        var controller = CreateController(fake);

        var result = controller.Delete("any");

        var ok = Assert.IsType<OkObjectResult>(result);
        var property = AssertSingleProperty(ok.Value!, "success");
        Assert.Equal(typeof(bool), property.PropertyType);
        Assert.Equal(true, property.GetValue(ok.Value));
    }

    [Fact]
    public void Move_SuccessPayload_HasExactlyOneBooleanPropertyNamedSuccess()
    {
        var fake = new FakeFileService();
        var controller = CreateController(fake);

        var result = controller.Move(new MoveRequest("a", "b"));

        var ok = Assert.IsType<OkObjectResult>(result);
        var property = AssertSingleProperty(ok.Value!, "success");
        Assert.Equal(typeof(bool), property.PropertyType);
        Assert.Equal(true, property.GetValue(ok.Value));
    }

    [Fact]
    public void Copy_SuccessPayload_HasExactlyOneBooleanPropertyNamedSuccess()
    {
        var fake = new FakeFileService();
        var controller = CreateController(fake);

        var result = controller.Copy(new CopyRequest("a", "b"));

        var ok = Assert.IsType<OkObjectResult>(result);
        var property = AssertSingleProperty(ok.Value!, "success");
        Assert.Equal(typeof(bool), property.PropertyType);
        Assert.Equal(true, property.GetValue(ok.Value));
    }

    [Fact]
    public void CreateDirectory_SuccessPayload_HasExactlyOneBooleanPropertyNamedSuccess()
    {
        var fake = new FakeFileService();
        var controller = CreateController(fake);

        var result = controller.CreateDirectory("docs/new");

        var ok = Assert.IsType<OkObjectResult>(result);
        var property = AssertSingleProperty(ok.Value!, "success");
        Assert.Equal(typeof(bool), property.PropertyType);
        Assert.Equal(true, property.GetValue(ok.Value));
    }

    [Fact]
    public async Task Upload_PathPayload_HasExactlyOneStringPropertyNamedPath()
    {
        // The path value is whatever the service returned, echoed unchanged.
        var fake = new FakeFileService { UploadedPath = "docs/report.txt" };
        var controller = CreateController(fake);
        var file = FormFileFactory.CreateFormFile("report.txt", "payload");

        var result = await controller.Upload("docs", file);

        var ok = Assert.IsType<OkObjectResult>(result);
        var property = AssertSingleProperty(ok.Value!, "path");
        Assert.Equal(typeof(string), property.PropertyType);
        Assert.Equal("docs/report.txt", property.GetValue(ok.Value));
    }

    // =====================================================================
    // The Execute/ExecuteAsync helpers must run the endpoint body exactly
    // once. A helper that retried or double-invoked the delegate would
    // silently double every service side effect while producing an identical
    // response — invisible to tests that only inspect the final result. These
    // pin single-invocation by counting calls on a dedicated double.
    // =====================================================================

    [Fact]
    public void Browse_InvokesServiceExactlyOnce()
    {
        var service = new CountingFileService();
        var controller = new FilesController(service);

        controller.Browse("docs");

        Assert.Equal(1, service.BrowseCalls);
    }

    [Fact]
    public void Search_InvokesServiceExactlyOnce()
    {
        var service = new CountingFileService();
        var controller = new FilesController(service);

        controller.Search("q", "docs");

        Assert.Equal(1, service.SearchCalls);
    }

    [Fact]
    public async Task Upload_InvokesServiceExactlyOnce()
    {
        var service = new CountingFileService();
        var controller = new FilesController(service);
        var file = FormFileFactory.CreateFormFile("upload.txt", "payload");

        await controller.Upload("docs", file);

        Assert.Equal(1, service.UploadCalls);
    }

    [Fact]
    public void Download_InvokesResolveExactlyOnce()
    {
        var service = new CountingFileService();
        var controller = new FilesController(service);

        controller.Download("report.txt");

        Assert.Equal(1, service.ResolveCalls);
    }

    [Fact]
    public void Delete_InvokesServiceExactlyOnce()
    {
        var service = new CountingFileService();
        var controller = new FilesController(service);

        controller.Delete("any");

        Assert.Equal(1, service.DeleteCalls);
    }

    [Fact]
    public void Move_InvokesServiceExactlyOnce()
    {
        var service = new CountingFileService();
        var controller = new FilesController(service);

        controller.Move(new MoveRequest("a", "b"));

        Assert.Equal(1, service.MoveCalls);
    }

    [Fact]
    public void Copy_InvokesServiceExactlyOnce()
    {
        var service = new CountingFileService();
        var controller = new FilesController(service);

        controller.Copy(new CopyRequest("a", "b"));

        Assert.Equal(1, service.CopyCalls);
    }

    [Fact]
    public void CreateDirectory_InvokesServiceExactlyOnce()
    {
        var service = new CountingFileService();
        var controller = new FilesController(service);

        controller.CreateDirectory("docs/new");

        Assert.Equal(1, service.CreateDirectoryCalls);
    }

    /// <summary>
    /// Minimal <see cref="IFileService"/> double that counts how many times
    /// each method is invoked, used to assert the endpoint bodies run exactly
    /// once after the Execute/ExecuteAsync extraction (guards against a helper
    /// that accidentally retries or double-invokes its delegate).
    /// </summary>
    private sealed class CountingFileService : IFileService
    {
        public int BrowseCalls;
        public int SearchCalls;
        public int ResolveCalls;
        public int UploadCalls;
        public int DeleteCalls;
        public int MoveCalls;
        public int CopyCalls;
        public int CreateDirectoryCalls;

        public BrowseResultDto Browse(string relativePath)
        {
            BrowseCalls++;
            return new BrowseResultDto(string.Empty, null, Array.Empty<FileEntryDto>(), 0, 0, 0L);
        }

        public SearchResultDto Search(string query, string relativePath)
        {
            SearchCalls++;
            return new SearchResultDto(string.Empty, string.Empty, Array.Empty<FileEntryDto>());
        }

        public string ResolveFullPath(string relativePath)
        {
            ResolveCalls++;
            return Path.Combine(Path.GetTempPath(), "resolved.txt");
        }

        public Task<string> UploadAsync(string relativeDirPath, IFormFile file)
        {
            UploadCalls++;
            return Task.FromResult(string.Empty);
        }

        public void Delete(string relativePath) => DeleteCalls++;
        public void Move(MoveRequest request) => MoveCalls++;
        public void Copy(CopyRequest request) => CopyCalls++;
        public void CreateDirectory(string relativePath) => CreateDirectoryCalls++;
    }

    // =====================================================================
    // Non-BCL exception subclasses used to prove the translation branches match
    // by inheritance (is-a) rather than by exact runtime type. CustomIOException
    // / CustomArgumentException MUST be caught (they derive from a translated
    // root); CustomException MUST propagate (it derives from plain Exception).
    // =====================================================================

    private sealed class CustomIOException : IOException
    {
        public CustomIOException(string message) : base(message) { }
    }

    private sealed class CustomArgumentException : ArgumentException
    {
        public CustomArgumentException(string message) : base(message) { }
    }

    private sealed class CustomException : Exception
    {
        public CustomException(string message) : base(message) { }
    }
}

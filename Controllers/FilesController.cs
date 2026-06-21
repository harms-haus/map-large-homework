using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.StaticFiles;
using TestProject.Models;
using TestProject.Services;

namespace TestProject.Controllers;

/// <summary>
/// HTTP API for <see cref="IFileService"/>. All endpoints are rooted under
/// <c>/api/files</c>; file-system faults are translated to semantically
/// honest HTTP status codes by <see cref="TranslateException"/>.
/// </summary>
[ApiController]
[Route("api/[controller]")]
public class FilesController : ControllerBase
{
    private readonly IFileService _service;
    private static readonly FileExtensionContentTypeProvider ContentTypeProvider = new();

    /// <summary>Fallback MIME type used when the file extension cannot be resolved.</summary>
    private const string DefaultContentType = "application/octet-stream";

    public FilesController(IFileService service)
    {
        _service = service;
    }

    /// <summary>Lists children of <paramref name="path"/> (root when empty),
    /// directories first then files, each sorted by name.</summary>
    [HttpGet("browse")]
    public ActionResult<BrowseResultDto> Browse([FromQuery] string? path)
        => Execute(() => Ok(_service.Browse(path ?? string.Empty)));

    /// <summary>Recursively searches under <paramref name="path"/> (root when
    /// empty) for names containing <paramref name="query"/> (case-insensitive).</summary>
    [HttpGet("search")]
    public ActionResult<SearchResultDto> Search([FromQuery] string query, [FromQuery] string? path)
        => Execute(() => Ok(_service.Search(query ?? string.Empty, path ?? string.Empty)));

    /// <summary>Uploads <paramref name="file"/> into <paramref name="path"/>
    /// (root when empty), creating the directory if needed. Returns the stored
    /// file's normalized relative path.</summary>
    [HttpPost("upload")]
    public async Task<IActionResult> Upload([FromQuery] string? path, [FromForm] IFormFile file)
        => await ExecuteAsync(async () =>
        {
            var storedPath = await _service.UploadAsync(path ?? string.Empty, file);
            return Ok(new { path = storedPath });
        });

    /// <summary>Streams the file at <paramref name="path"/>, deriving the
    /// content type from the extension (defaulting to
    /// <see cref="DefaultContentType"/>).</summary>
    [HttpGet("download")]
    public IActionResult Download([FromQuery] string path)
        => Execute(() =>
        {
            var full = _service.ResolveFullPath(path);
            var contentType = ContentTypeProvider.TryGetContentType(full, out var ct)
                ? ct
                : DefaultContentType;
            return PhysicalFile(full, contentType, Path.GetFileName(full));
        });

    /// <summary>Deletes the file or directory (recursively) at <paramref name="path"/>.</summary>
    [HttpDelete("delete")]
    public IActionResult Delete([FromQuery] string path)
        => Execute(() =>
        {
            _service.Delete(path);
            return Ok(new { success = true });
        });

    /// <summary>Moves the entry at <see cref="MoveRequest.SourcePath"/> to
    /// <see cref="MoveRequest.DestinationPath"/>.</summary>
    [HttpPost("move")]
    public IActionResult Move([FromBody] MoveRequest request)
        => Execute(() =>
        {
            _service.Move(request);
            return Ok(new { success = true });
        });

    /// <summary>Copies the entry at <see cref="CopyRequest.SourcePath"/> to
    /// <see cref="CopyRequest.DestinationPath"/>.</summary>
    [HttpPost("copy")]
    public IActionResult Copy([FromBody] CopyRequest request)
        => Execute(() =>
        {
            _service.Copy(request);
            return Ok(new { success = true });
        });

    /// <summary>Creates the directory at <paramref name="path"/> (including
    /// parents); idempotent — an existing directory is left as-is.</summary>
    [HttpPost("mkdir")]
    public IActionResult CreateDirectory([FromQuery] string? path)
        => Execute(() =>
        {
            _service.CreateDirectory(path ?? string.Empty);
            return Ok(new { success = true });
        });

    // Helpers

    /// <summary>
    /// Runs <paramref name="body"/> and translates file-system faults via
    /// <see cref="TranslateException"/> into the appropriate HTTP status;
    /// other exceptions propagate.
    /// Returns <see cref="ActionResult"/> so one helper backs both the
    /// <c>ActionResult&lt;T&gt;</c> and <see cref="IActionResult"/> endpoints
    /// (ActionResult converts implicitly to <c>ActionResult&lt;T&gt;</c>;
    /// the reverse does not).
    /// </summary>
    private ActionResult Execute(Func<ActionResult> body)
    {
        try
        {
            return body();
        }
        catch (Exception ex)
        {
            return TranslateException(ex);
        }
    }

    /// <summary>Async variant of <see cref="Execute"/> for endpoints that
    /// await service calls. The body is awaited (not unwrapped via
    /// <c>.Result</c>/<c>.Wait()</c>) so its original exception surfaces rather
    /// than an <see cref="AggregateException"/>.</summary>
    private async Task<ActionResult> ExecuteAsync(Func<Task<ActionResult>> body)
    {
        try
        {
            return await body();
        }
        catch (Exception ex)
        {
            return TranslateException(ex);
        }
    }

    /// <summary>Maps file-system faults to HTTP status codes, each carrying
    /// <c>{ error = ex.Message }</c>. Subtype arms precede the generic
    /// <see cref="IOException"/> catch-all. Anything unmatched is re-thrown.</summary>
    private ActionResult TranslateException(Exception ex) => ex switch
    {
        ConflictException
            => Conflict(new { error = ex.Message }),
        UnauthorizedAccessException
            => StatusCode(StatusCodes.Status403Forbidden, new { error = ex.Message }),
        FileNotFoundException or DirectoryNotFoundException
            => NotFound(new { error = ex.Message }),
        ArgumentException or PathTooLongException
            => BadRequest(new { error = ex.Message }),
        IOException
            => StatusCode(StatusCodes.Status500InternalServerError, new { error = ex.Message }),
        _ => throw ex
    };

}

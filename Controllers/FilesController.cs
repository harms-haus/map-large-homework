using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.StaticFiles;
using TestProject.Models;
using TestProject.Services;

namespace TestProject.Controllers;

/// <summary>
/// HTTP API surface for the path-safe file system operations exposed by
/// <see cref="IFileService"/>. Every endpoint is rooted under
/// <c>/api/files</c> and delegates its work to <see cref="Execute"/> (or
/// <see cref="ExecuteAsync"/> for the async <see cref="Upload"/> endpoint),
/// which translates the well-known file system faults
/// (<see cref="ArgumentException"/>, <see cref="UnauthorizedAccessException"/>
/// and <see cref="IOException"/>) into a <c>400 Bad Request</c> carrying the
/// exception message, leaving any other exception type to propagate.
/// </summary>
[ApiController]
[Route("api/[controller]")]
public class FilesController : ControllerBase
{
    private readonly IFileService _service;
    private static readonly FileExtensionContentTypeProvider ContentTypeProvider = new();

    /// <summary>Fallback MIME type used when the file extension cannot be resolved.</summary>
    private const string DefaultContentType = "application/octet-stream";

    /// <summary>
    /// Creates a new <see cref="FilesController"/> bound to the supplied
    /// <paramref name="service"/>.
    /// </summary>
    public FilesController(IFileService service)
    {
        _service = service;
    }

    // =====================================================================
    // Browse
    // =====================================================================

    /// <summary>
    /// Lists the immediate children of the directory at <paramref name="path"/>
    /// (the root when omitted or empty), returning directories first then
    /// files, each group sorted by name.
    /// </summary>
    [HttpGet("browse")]
    public ActionResult<BrowseResultDto> Browse([FromQuery] string? path)
        => Execute(() => Ok(_service.Browse(path ?? string.Empty)));

    // =====================================================================
    // Search
    // =====================================================================

    /// <summary>
    /// Recursively searches under <paramref name="path"/> (the root when
    /// omitted or empty) for entries whose name contains <paramref name="query"/>
    /// (case-insensitive).
    /// </summary>
    [HttpGet("search")]
    public ActionResult<SearchResultDto> Search([FromQuery] string query, [FromQuery] string? path)
        => Execute(() => Ok(_service.Search(query ?? string.Empty, path ?? string.Empty)));

    // =====================================================================
    // Upload
    // =====================================================================

    /// <summary>
    /// Writes the uploaded <paramref name="file"/> into the directory at
    /// <paramref name="path"/> (the root when omitted or empty), creating it
    /// if necessary. The response reports the stored file's normalized
    /// relative path, sourced directly from the service.
    /// </summary>
    [HttpPost("upload")]
    public async Task<IActionResult> Upload([FromQuery] string? path, [FromForm] IFormFile file)
        => await ExecuteAsync(async () =>
        {
            var storedPath = await _service.UploadAsync(path ?? string.Empty, file);
            return Ok(new { path = storedPath });
        });

    // =====================================================================
    // Download
    // =====================================================================

    /// <summary>
    /// Streams the file at <paramref name="path"/> as a physical file
    /// response, deriving the content type from the extension (defaulting to
    /// <see cref="DefaultContentType"/> when unknown).
    /// </summary>
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

    // =====================================================================
    // Delete
    // =====================================================================

    /// <summary>
    /// Deletes the file or directory (recursively) at <paramref name="path"/>.
    /// </summary>
    [HttpDelete("delete")]
    public IActionResult Delete([FromQuery] string path)
        => Execute(() =>
        {
            _service.Delete(path);
            return Ok(new { success = true });
        });

    // =====================================================================
    // Move
    // =====================================================================

    /// <summary>
    /// Moves the file or directory at <paramref name="request"/>'s
    /// <see cref="MoveRequest.SourcePath"/> to its
    /// <see cref="MoveRequest.DestinationPath"/>.
    /// </summary>
    [HttpPost("move")]
    public IActionResult Move([FromBody] MoveRequest request)
        => Execute(() =>
        {
            _service.Move(request);
            return Ok(new { success = true });
        });

    // =====================================================================
    // Copy
    // =====================================================================

    /// <summary>
    /// Copies the file or directory at <paramref name="request"/>'s
    /// <see cref="CopyRequest.SourcePath"/> to its
    /// <see cref="CopyRequest.DestinationPath"/>.
    /// </summary>
    [HttpPost("copy")]
    public IActionResult Copy([FromBody] CopyRequest request)
        => Execute(() =>
        {
            _service.Copy(request);
            return Ok(new { success = true });
        });

    // =====================================================================
    // Create directory
    // =====================================================================

    /// <summary>
    /// Creates the directory at <paramref name="path"/> (including any missing
    /// parents), creating the home root itself when omitted or empty. The
    /// operation is idempotent: an existing directory is left as-is.
    /// </summary>
    [HttpPost("mkdir")]
    public IActionResult CreateDirectory([FromQuery] string? path)
        => Execute(() =>
        {
            _service.CreateDirectory(path ?? string.Empty);
            return Ok(new { success = true });
        });

    // =====================================================================
    // Helpers
    // =====================================================================

    /// <summary>
    /// Runs <paramref name="body"/> and translates the well-known file system
    /// faults via <see cref="TranslateException"/> into a
    /// <c>400 Bad Request</c> carrying the exception message. Any other
    /// exception type propagates unchanged.
    /// </summary>
    /// <remarks>
    /// The return type is <see cref="ActionResult"/> (rather than
    /// <see cref="IActionResult"/>) so the same helper can back both the
    /// <see cref="Browse"/>/<see cref="Search"/> endpoints, whose return type
    /// is <c>ActionResult&lt;T&gt;</c>, and the plain
    /// <see cref="IActionResult"/> endpoints; <see cref="ActionResult"/>
    /// implements <see cref="IActionResult"/> and converts implicitly to
    /// <c>ActionResult&lt;T&gt;</c>, while <see cref="IActionResult"/> does not.
    /// </remarks>
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

    /// <summary>
    /// Async variant of <see cref="Execute"/> for endpoints that must await
    /// service calls (currently <see cref="Upload"/>). Shares the same
    /// <see cref="TranslateException"/> translation; non-translated exceptions
    /// propagate. The body is awaited (never unwrapped via
    /// <c>.Result</c>/<c>.Wait()</c>) so a faulting body surfaces its original
    /// exception rather than an <see cref="AggregateException"/>.
    /// </summary>
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

    /// <summary>
    /// Translates the well-known file system faults —
    /// <see cref="ArgumentException"/>, <see cref="UnauthorizedAccessException"/>
    /// and <see cref="IOException"/> — into a <c>400 Bad Request</c> carrying
    /// the exception message. The branch matching is by inheritance (is-a),
    /// so <see cref="DirectoryNotFoundException"/> and
    /// <see cref="FileNotFoundException"/> (both <see cref="IOException"/>
    /// subtypes) are handled by the single <see cref="IOException"/> branch
    /// without needing to be enumerated explicitly. Any exception that is not
    /// assignable to one of these three roots is re-thrown unchanged so it can
    /// propagate to the caller.
    /// </summary>
    /// <remarks>
    /// Shared by <see cref="Execute"/> and <see cref="ExecuteAsync"/> so the
    /// sync and async endpoints translate exceptions identically.
    /// </remarks>
    private ActionResult TranslateException(Exception ex) => ex switch
    {
        ArgumentException or UnauthorizedAccessException or IOException
            => BadRequest(new { error = ex.Message }),
        _ => throw ex
    };

}

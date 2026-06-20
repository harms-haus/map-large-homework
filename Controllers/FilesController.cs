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
/// (<see cref="ArgumentException"/>, <see cref="UnauthorizedAccessException"/>,
/// <see cref="DirectoryNotFoundException"/>, <see cref="FileNotFoundException"/>
/// and <see cref="IOException"/>) into a <c>400 Bad Request</c> carrying the
/// exception message, leaving any other exception type to propagate.
/// </summary>
[ApiController]
[Route("api/[controller]")]
public class FilesController : ControllerBase
{
    private readonly IFileService _service;
    private static readonly FileExtensionContentTypeProvider ContentTypeProvider = new();

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
    /// if necessary. The response reports the joined relative path of the
    /// stored file.
    /// </summary>
    [HttpPost("upload")]
    public async Task<IActionResult> Upload([FromQuery] string? path, [FromForm] IFormFile file)
        => await ExecuteAsync(async () =>
        {
            await _service.UploadAsync(path ?? string.Empty, file);
            var dir = NormalizeRelativePath(path ?? string.Empty);
            var resultPath = string.IsNullOrEmpty(dir) ? file.FileName : $"{dir}/{file.FileName}";
            return Ok(new { path = resultPath });
        });

    // =====================================================================
    // Download
    // =====================================================================

    /// <summary>
    /// Streams the file at <paramref name="path"/> as a physical file
    /// response, deriving the content type from the extension (defaulting to
    /// <c>application/octet-stream</c> when unknown).
    /// </summary>
    [HttpGet("download")]
    public IActionResult Download([FromQuery] string path)
        => Execute(() =>
        {
            var full = _service.ResolveFullPath(path);
            var contentType = ContentTypeProvider.TryGetContentType(full, out var ct)
                ? ct
                : "application/octet-stream";
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
    // Helpers
    // =====================================================================

    /// <summary>
    /// Runs <paramref name="body"/> and translates the well-known file system
    /// faults (<see cref="ArgumentException"/>,
    /// <see cref="UnauthorizedAccessException"/>,
    /// <see cref="DirectoryNotFoundException"/>, <see cref="FileNotFoundException"/>
    /// and <see cref="IOException"/>) into a <c>400 Bad Request</c> carrying
    /// the exception message. Any other exception type propagates unchanged.
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
        catch (ArgumentException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
        catch (UnauthorizedAccessException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
        catch (DirectoryNotFoundException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
        catch (FileNotFoundException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
        catch (IOException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    /// <summary>
    /// Async variant of <see cref="Execute"/> for endpoints that must await
    /// service calls (currently <see cref="Upload"/>). Same catch list and
    /// translation; non-translated exceptions propagate. The body is awaited
    /// (never unwrapped via <c>.Result</c>/<c>.Wait()</c>) so a faulting body
    /// surfaces its original exception rather than an
    /// <see cref="AggregateException"/>.
    /// </summary>
    private async Task<ActionResult> ExecuteAsync(Func<Task<ActionResult>> body)
    {
        try
        {
            return await body();
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
        catch (UnauthorizedAccessException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
        catch (DirectoryNotFoundException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
        catch (FileNotFoundException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
        catch (IOException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    /// <summary>
    /// Normalizes a raw directory path for use in the response: replaces
    /// backslashes with forward slashes, collapses repeated slashes, and
    /// removes <c>.</c> and <c>..</c> segments. Returns empty string when
    /// the path is null, empty, or collapses to nothing.
    /// </summary>
    private static string NormalizeRelativePath(string raw)
    {
        if (string.IsNullOrEmpty(raw))
            return string.Empty;

        return string.Join("/",
            raw.Replace('\\', '/')
               .Split('/')
               .Where(s => s.Length > 0 && s != "." && s != ".."));
    }
}

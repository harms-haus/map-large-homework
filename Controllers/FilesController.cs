using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.StaticFiles;
using TestProject.Models;
using TestProject.Services;

namespace TestProject.Controllers;

/// <summary>
/// HTTP API surface for the path-safe file system operations exposed by
/// <see cref="IFileService"/>. Every endpoint is rooted under
/// <c>/api/files</c> and translates the well-known file system faults
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
    private readonly ILogger<FilesController> _logger;

    /// <summary>
    /// Creates a new <see cref="FilesController"/> bound to the supplied
    /// <paramref name="service"/> and <paramref name="logger"/>.
    /// </summary>
    public FilesController(IFileService service, ILogger<FilesController> logger)
    {
        _service = service;
        _logger = logger;
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
    {
        try
        {
            return Ok(_service.Browse(path ?? string.Empty));
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
    {
        try
        {
            return Ok(_service.Search(query ?? string.Empty, path ?? string.Empty));
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
    {
        try
        {
            await _service.UploadAsync(path ?? string.Empty, file);
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

        return Ok(new { path = string.IsNullOrEmpty(path) ? file.FileName : $"{path}/{file.FileName}" });
    }

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
    {
        string full;
        try
        {
            full = _service.ResolveFullPath(path);
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

        var contentType = new FileExtensionContentTypeProvider().TryGetContentType(full, out var ct)
            ? ct
            : "application/octet-stream";

        return PhysicalFile(full, contentType, Path.GetFileName(full));
    }

    // =====================================================================
    // Delete
    // =====================================================================

    /// <summary>
    /// Deletes the file or directory (recursively) at <paramref name="path"/>.
    /// </summary>
    [HttpDelete("delete")]
    public IActionResult Delete([FromQuery] string path)
    {
        try
        {
            _service.Delete(path);
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

        return Ok(new { success = true });
    }

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
    {
        try
        {
            _service.Move(request);
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

        return Ok(new { success = true });
    }

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
    {
        try
        {
            _service.Copy(request);
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

        return Ok(new { success = true });
    }
}

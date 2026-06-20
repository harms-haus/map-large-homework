using System.Text;
using Microsoft.AspNetCore.Http;

namespace TestProject.Tests.TestHelpers;

/// <summary>
/// Factory for creating <see cref="IFormFile"/> instances from in-memory
/// string content for use in test arrangements. This consolidates three
/// byte-identical private copies that were previously duplicated across
/// test classes into a single reusable utility.
/// </summary>
public static class FormFileFactory
{
    /// <summary>
    /// Creates an <see cref="IFormFile"/> whose content is the UTF-8 encoding
    /// of <paramref name="content"/>. The <see cref="IFormFile.FileName"/> is
    /// set to <paramref name="fileName"/>, the form field name is the literal
    /// <c>"file"</c>, and headers are left unpopulated (the
    /// <see cref="IFormFile.ContentDisposition"/> getter will throw).
    /// </summary>
    /// <param name="fileName">The file name exposed by the uploaded file.</param>
    /// <param name="content">The textual content, encoded as UTF-8 bytes.</param>
    /// <returns>A new <see cref="IFormFile"/> backed by a <see cref="MemoryStream"/>.</returns>
    public static IFormFile CreateFormFile(string fileName, string content)
    {
        var bytes = Encoding.UTF8.GetBytes(content);
        var stream = new MemoryStream(bytes);
        return new FormFile(stream, 0, bytes.Length, "file", fileName);
    }
}

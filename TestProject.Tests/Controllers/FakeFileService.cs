using Microsoft.AspNetCore.Http;
using TestProject.Models;
using TestProject.Services;

namespace TestProject.Tests.Controllers;

/// <summary>
/// Recording double for <see cref="IFileService"/>. Each method stashes the
/// arguments it was called with and either returns a configurable value or
/// throws a configurable exception, giving each test full control over the
/// service's behavior while keeping the double trivially inspectable.
/// </summary>
public sealed class FakeFileService : IFileService
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

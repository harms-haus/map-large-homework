using System;
using System.Collections.Generic;
using TestProject.Models;
using Xunit;

namespace TestProject.Tests.Models;

/// <summary>
/// Tests for the file system API contract DTOs/models defined in
/// <c>TestProject.Models</c>. These types are pure data carriers (records)
/// with no logic, so the tests assert on their shape, default semantics,
/// value equality and the exact property contract.
/// </summary>
public class FileSystemModelsTests
{
    // ---------------------------------------------------------------------
    // FileEntryDto
    // ---------------------------------------------------------------------

    [Fact]
    public void FileEntryDto_Constructor_AssignsAllPositionalProperties()
    {
        var lastModified = new DateTime(2026, 1, 2, 3, 4, 5, DateTimeKind.Utc);

        var entry = new FileEntryDto("report.txt", "docs/report.txt", false, 1024L, lastModified);

        Assert.Equal("report.txt", entry.Name);
        Assert.Equal("docs/report.txt", entry.Path);
        Assert.False(entry.IsDirectory);
        Assert.Equal(1024L, entry.Size);
        Assert.Equal(lastModified, entry.LastModified);
    }

    [Fact]
    public void FileEntryDto_Size_PropertyIsLong()
    {
        var sizeProperty = typeof(FileEntryDto).GetProperty(nameof(FileEntryDto.Size));

        Assert.NotNull(sizeProperty);
        Assert.Equal(typeof(long), sizeProperty!.PropertyType);
    }

    [Fact]
    public void FileEntryDto_LastModified_PropertyIsDateTime()
    {
        var property = typeof(FileEntryDto).GetProperty(nameof(FileEntryDto.LastModified));

        Assert.NotNull(property);
        Assert.Equal(typeof(DateTime), property!.PropertyType);
    }

    [Fact]
    public void FileEntryDto_DirectoryEntry_TypicallyUsesZeroSize()
    {
        // Contract note: Size is 0 for directories. The DTO itself does not
        // enforce this, but the convention is documented and exercised here.
        var entry = new FileEntryDto("docs", "docs", true, 0L, DateTime.UtcNow);

        Assert.True(entry.IsDirectory);
        Assert.Equal(0L, entry.Size);
    }

    [Fact]
    public void FileEntryDto_IsSealed()
    {
        Assert.True(typeof(FileEntryDto).IsSealed);
    }

    [Fact]
    public void FileEntryDto_ValueEquality_InstancesWithSameValues_AreEqual()
    {
        var ts = new DateTime(2026, 6, 19, 12, 0, 0, DateTimeKind.Utc);

        var a = new FileEntryDto("a.txt", "a.txt", false, 10L, ts);
        var b = new FileEntryDto("a.txt", "a.txt", false, 10L, ts);

        Assert.Equal(a, b);
        Assert.True(a == b);
        Assert.False(a != b);
        Assert.Equal(a.GetHashCode(), b.GetHashCode());
    }

    [Fact]
    public void FileEntryDto_ValueEquality_DifferingValues_AreNotEqual()
    {
        var ts = DateTime.UtcNow;

        var a = new FileEntryDto("a.txt", "a.txt", false, 10L, ts);
        var b = new FileEntryDto("a.txt", "a.txt", false, 11L, ts);

        Assert.NotEqual(a, b);
    }

    // ---------------------------------------------------------------------
    // BrowseResultDto
    // ---------------------------------------------------------------------

    [Fact]
    public void BrowseResultDto_Constructor_AssignsAllPositionalProperties()
    {
        var entries = new[]
        {
            new FileEntryDto("sub", "sub", true, 0L, DateTime.UtcNow),
            new FileEntryDto("file.txt", "file.txt", false, 5L, DateTime.UtcNow)
        };

        var result = new BrowseResultDto("docs", "root", entries, 1, 1, 5L);

        Assert.Equal("docs", result.Path);
        Assert.Equal("root", result.Parent);
        Assert.Same(entries, result.Entries);
        Assert.Equal(1, result.FolderCount);
        Assert.Equal(1, result.FileCount);
        Assert.Equal(5L, result.TotalSize);
    }

    [Fact]
    public void BrowseResultDto_Parent_IsNullable_AndAcceptsNull()
    {
        var property = typeof(BrowseResultDto).GetProperty(nameof(BrowseResultDto.Parent));
        Assert.NotNull(property);
        // string? collapses to string at runtime; verify it is the string type.
        Assert.Equal(typeof(string), property!.PropertyType);

        var result = new BrowseResultDto("", null, Array.Empty<FileEntryDto>(), 0, 0, 0L);

        Assert.Null(result.Parent);
    }

    [Fact]
    public void BrowseResultDto_Entries_IsReadOnlyListOfFileEntryDto()
    {
        var property = typeof(BrowseResultDto).GetProperty(nameof(BrowseResultDto.Entries));

        Assert.NotNull(property);
        Assert.Equal(typeof(IReadOnlyList<FileEntryDto>), property!.PropertyType);
    }

    [Fact]
    public void BrowseResultDto_Entries_AcceptsArray()
    {
        FileEntryDto[] entries = { new("a", "a", true, 0L, DateTime.UtcNow) };

        var result = new BrowseResultDto("p", null, entries, 1, 0, 0L);

        Assert.Single(result.Entries);
        Assert.Equal("a", result.Entries[0].Name);
    }

    [Fact]
    public void BrowseResultDto_Entries_AcceptsList()
    {
        var entries = new List<FileEntryDto>
        {
            new("a", "a", true, 0L, DateTime.UtcNow),
            new("b", "b", false, 1L, DateTime.UtcNow)
        };

        var result = new BrowseResultDto("p", null, entries, 1, 1, 1L);

        Assert.Equal(2, result.Entries.Count);
    }

    [Fact]
    public void BrowseResultDto_TotalSize_IsLong()
    {
        var property = typeof(BrowseResultDto).GetProperty(nameof(BrowseResultDto.TotalSize));

        Assert.NotNull(property);
        Assert.Equal(typeof(long), property!.PropertyType);
    }

    [Fact]
    public void BrowseResultDto_FolderAndFileCounts_AreInt()
    {
        Assert.Equal(typeof(int), typeof(BrowseResultDto).GetProperty(nameof(BrowseResultDto.FolderCount))!.PropertyType);
        Assert.Equal(typeof(int), typeof(BrowseResultDto).GetProperty(nameof(BrowseResultDto.FileCount))!.PropertyType);
    }

    [Fact]
    public void BrowseResultDto_IsSealed()
    {
        Assert.True(typeof(BrowseResultDto).IsSealed);
    }

    [Fact]
    public void BrowseResultDto_ValueEquality()
    {
        var ts = DateTime.UtcNow;
        var entries = new FileEntryDto[] { new("a", "a", true, 0L, ts) };

        var a = new BrowseResultDto("docs", null, entries, 1, 0, 0L);
        var b = new BrowseResultDto("docs", null, entries, 1, 0, 0L);

        Assert.Equal(a, b);
        Assert.True(a == b);
    }

    // ---------------------------------------------------------------------
    // SearchResultDto
    // ---------------------------------------------------------------------

    [Fact]
    public void SearchResultDto_Constructor_AssignsAllPositionalProperties()
    {
        var results = new[]
        {
            new FileEntryDto("a.txt", "a.txt", false, 1L, DateTime.UtcNow)
        };

        var result = new SearchResultDto("report", "docs", results);

        Assert.Equal("report", result.Query);
        Assert.Equal("docs", result.Path);
        Assert.Same(results, result.Results);
    }

    [Fact]
    public void SearchResultDto_Results_IsReadOnlyListOfFileEntryDto()
    {
        var property = typeof(SearchResultDto).GetProperty(nameof(SearchResultDto.Results));

        Assert.NotNull(property);
        Assert.Equal(typeof(IReadOnlyList<FileEntryDto>), property!.PropertyType);
    }

    [Fact]
    public void SearchResultDto_Results_AcceptsArray()
    {
        FileEntryDto[] results = { new("a", "a", false, 1L, DateTime.UtcNow) };

        var result = new SearchResultDto("q", "p", results);

        Assert.Single(result.Results);
    }

    [Fact]
    public void SearchResultDto_IsSealed()
    {
        Assert.True(typeof(SearchResultDto).IsSealed);
    }

    [Fact]
    public void SearchResultDto_ValueEquality()
    {
        var results = new FileEntryDto[] { new("a", "a", false, 1L, DateTime.UtcNow) };

        var a = new SearchResultDto("q", "p", results);
        var b = new SearchResultDto("q", "p", results);

        Assert.Equal(a, b);
        Assert.True(a == b);
    }

    // ---------------------------------------------------------------------
    // MoveRequest / CopyRequest
    // ---------------------------------------------------------------------

    [Fact]
    public void MoveRequest_Constructor_AssignsSourceAndDestinationPath()
    {
        var request = new MoveRequest("docs/a.txt", "archive/a.txt");

        Assert.Equal("docs/a.txt", request.SourcePath);
        Assert.Equal("archive/a.txt", request.DestinationPath);
    }

    [Fact]
    public void MoveRequest_IsSealed()
    {
        Assert.True(typeof(MoveRequest).IsSealed);
    }

    [Fact]
    public void MoveRequest_ValueEquality()
    {
        var a = new MoveRequest("from", "to");
        var b = new MoveRequest("from", "to");

        Assert.Equal(a, b);
        Assert.True(a == b);
    }

    [Fact]
    public void CopyRequest_Constructor_AssignsSourceAndDestinationPath()
    {
        var request = new CopyRequest("docs/a.txt", "backup/a.txt");

        Assert.Equal("docs/a.txt", request.SourcePath);
        Assert.Equal("backup/a.txt", request.DestinationPath);
    }

    [Fact]
    public void CopyRequest_IsSealed()
    {
        Assert.True(typeof(CopyRequest).IsSealed);
    }

    [Fact]
    public void CopyRequest_ValueEquality()
    {
        var a = new CopyRequest("from", "to");
        var b = new CopyRequest("from", "to");

        Assert.Equal(a, b);
        Assert.True(a == b);
    }

    [Fact]
    public void AllModelTypes_ResideInTestProjectModelsNamespace()
    {
        Assert.Equal("TestProject.Models", typeof(FileEntryDto).Namespace);
        Assert.Equal("TestProject.Models", typeof(BrowseResultDto).Namespace);
        Assert.Equal("TestProject.Models", typeof(SearchResultDto).Namespace);
        Assert.Equal("TestProject.Models", typeof(MoveRequest).Namespace);
        Assert.Equal("TestProject.Models", typeof(CopyRequest).Namespace);
    }
}

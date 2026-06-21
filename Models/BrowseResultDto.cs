using System;
using System.Collections.Generic;

namespace TestProject.Models;

/// <summary>
/// Represents the result of browsing a directory, including its contents and summary counts.
/// </summary>
public sealed record BrowseResultDto(string Path, string? Parent, IReadOnlyList<FileEntryDto> Entries, int FolderCount, int FileCount, long TotalSize);

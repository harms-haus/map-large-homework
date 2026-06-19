using System.Collections.Generic;

namespace TestProject.Models;

public sealed record FileEntryDto(string Name, string Path, bool IsDirectory, long Size, System.DateTime LastModified);

public sealed record BrowseResultDto(string Path, string? Parent, IReadOnlyList<FileEntryDto> Entries, int FolderCount, int FileCount, long TotalSize);

public sealed record SearchResultDto(string Query, string Path, IReadOnlyList<FileEntryDto> Results);

public sealed record MoveRequest(string SourcePath, string DestinationPath);

public sealed record CopyRequest(string SourcePath, string DestinationPath);

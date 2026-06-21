using System.Collections.Generic;

namespace TestProject.Models;

/// <summary>
/// Represents the result of a search query, containing matching file entries.
/// </summary>
public sealed record SearchResultDto(string Query, string Path, IReadOnlyList<FileEntryDto> Results);

using System;

namespace TestProject.Models;

/// <summary>
/// Represents a single file or directory entry returned from browsing or searching.
/// </summary>
public sealed record FileEntryDto(string Name, string Path, bool IsDirectory, long Size, DateTime LastModified, int ItemCount);

namespace TestProject.Models;

/// <summary>
/// Represents a request to copy a file or directory from one location to another.
/// </summary>
public sealed record CopyRequest(string SourcePath, string DestinationPath);

namespace TestProject.Models;

/// <summary>
/// Represents a request to move a file or directory from one location to another.
/// </summary>
public sealed record MoveRequest(string SourcePath, string DestinationPath);
